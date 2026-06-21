/**
 * Top-level mock for the Recode desktop app.
 *
 * Codex-style layout: single sidebar (project folders + threads) | main pane
 * (header + transcript + composer) | bottom status bar.
 *
 * Phase 1: state-only mock, no real ACP/CLI wiring.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Download,
  FileCode2,
  FileText,
  HelpCircle,
  ListChecks,
  Settings2,
  X,
} from 'lucide-react'
import { motion, MotionConfig } from 'motion/react'
import { ChatHeader } from './components/ChatHeader'
import { Composer, type SlashCommandOption } from './components/Composer'
import { ProjectThreadPicker } from './components/ProjectThreadPicker'
import type { CommandPaletteItem } from './components/CommandPalette'
import { DotmSquare18 } from './components/ui/dotm-square-18'
import { cn } from './lib/cn'
import { initialProjects, initialThreads, type PickerEntry } from './mock-data'
import {
  createDesktopBridge,
  isDesktopRuntime,
  type DesktopBridge,
} from './lib/desktop-bridge'
import type {
  ChatMessage,
  Project,
  ReasoningLevel,
  ThemeMode,
  Thread,
} from './types'
import type {
  DesktopConfigOption,
  DesktopMessage,
  DesktopPermissionRequest,
  DesktopQuestionRequest,
  DesktopSessionUpdate,
  RecodeRuntimeMode,
  SessionMode,
} from './desktop-rpc'

const THEME_STORAGE_KEY = 'recode-theme'
const GPU_ACCELERATION_DISABLED_STORAGE_KEY = 'recode-gpu-acceleration-disabled'
const SLASH_COMMANDS: SlashCommandOption[] = [
  { command: '/help', name: 'Help', description: 'Open desktop help' },
  { command: '/status', name: 'Status', description: 'Show workspace and thread status' },
  { command: '/config', name: 'Config', description: 'Show active configuration' },
  { command: '/todo', name: 'Todo', description: 'Show the current task plan' },
  { command: '/export', name: 'Export', description: 'Export this thread as HTML or Markdown' },
  { command: '/compact', name: 'Compact', description: 'Add a compacted context marker' },
]

type SlashPanel = 'help' | 'status' | 'config' | 'todo' | 'export'

const ProjectModal = lazy(() =>
  import('./components/ProjectModal').then((module) => ({
    default: module.ProjectModal,
  })),
)
const Sidebar = lazy(() =>
  import('./components/Sidebar').then((module) => ({
    default: module.Sidebar,
  })),
)
const Transcript = lazy(() =>
  import('./components/Transcript').then((module) => ({
    default: module.Transcript,
  })),
)
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((module) => ({
    default: module.SettingsModal,
  })),
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((module) => ({
    default: module.CommandPalette,
  })),
)
const ShortcutsOverlay = lazy(() =>
  import('./components/ShortcutsOverlay').then((module) => ({
    default: module.ShortcutsOverlay,
  })),
)

/** Convert an incoming desktop message into the React chat message shape. */
function toChatMessage(message: DesktopMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    toolCallId: message.toolCallId,
    toolKind: message.toolKind,
    toolStatus: message.toolStatus,
    toolInput: message.toolInput,
    toolContent: message.toolContent,
  }
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark'
    ? 'dark'
    : 'light'
}

function readStoredGpuAccelerationDisabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(GPU_ACCELERATION_DISABLED_STORAGE_KEY) === 'true'
}

function createMockMessages(): Record<string, ChatMessage[]> {
  return {
    'thread-1': [
      {
        id: 'm-1',
        role: 'user',
        body: 'Document the shot-scraper CLI usage in SKILL.md.',
      },
      {
        id: 'm-2',
        role: 'assistant',
        body: 'I’ll inspect shot-scraper’s entry points, capture the supported commands and flags, then write a concise SKILL.md with grouped examples.',
      },
    ],
  }
}

export function App() {
  const [desktopRuntime] = useState(isDesktopRuntime)
  const [projects, setProjects] = useState<Project[]>(() =>
    desktopRuntime ? [] : initialProjects,
  )
  const [threads, setThreads] = useState<Thread[]>(() =>
    desktopRuntime ? [] : initialThreads,
  )
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    desktopRuntime ? null : (initialThreads[0]?.id ?? null),
  )
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    new Set(),
  )
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(() =>
    desktopRuntime ? {} : createMockMessages(),
  )

  const [model, setModel] = useState('Recode default')
  const [mode, setMode] = useState<SessionMode>('build')
  const [reasoning, setReasoning] = useState<ReasoningLevel>('Med')
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme)
  const [gpuAccelerationDisabled, setGpuAccelerationDisabled] = useState(
    readStoredGpuAccelerationDisabled,
  )
  const [runtimeMode, setRuntimeMode] = useState<RecodeRuntimeMode>('dev')
  const [recodeRepoRoot, setRecodeRepoRoot] = useState<string | undefined>()
  const [detectedRepoRoot, setDetectedRepoRoot] = useState<string | undefined>()
  const [bridge, setBridge] = useState<DesktopBridge | null>(null)
  const [configOptions, setConfigOptions] = useState<DesktopConfigOption[]>([])
  const configOptionsByThread = useRef<Map<string, DesktopConfigOption[]>>(new Map())
  const [configOptionsLoading, setConfigOptionsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [permissionRequest, setPermissionRequest] =
    useState<DesktopPermissionRequest | null>(null)
  const [questionRequest, setQuestionRequest] =
    useState<DesktopQuestionRequest | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [folderPickerMode, setFolderPickerMode] = useState<'workspace' | 'recode-repo'>('workspace')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [slashPanel, setSlashPanel] = useState<SlashPanel | null>(null)
  const [composerFocusKey, setComposerFocusKey] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.animations = gpuAccelerationDisabled ? 'paused' : 'running'
    window.localStorage.setItem(
      GPU_ACCELERATION_DISABLED_STORAGE_KEY,
      String(gpuAccelerationDisabled),
    )
  }, [gpuAccelerationDisabled])

  useEffect(() => {
    const desktopBridge = createDesktopBridge({
      onSessionUpdate: applyDesktopSessionUpdate,
      onPermissionRequest: setPermissionRequest,
      onQuestionRequest: setQuestionRequest,
      onSessionError: (error) => {
        const targetThreadId = error.threadId ?? activeThreadId
        if (!targetThreadId) return
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === targetThreadId ? { ...thread, status: 'error' } : thread,
          ),
        )
        setMessages((prev) => ({
          ...prev,
          [targetThreadId]: [
            ...(prev[targetThreadId] ?? []),
            {
              id: `error-${Date.now()}`,
              role: 'system',
              body: error.message,
            },
          ],
        }))
      },
    })

    setBridge(desktopBridge)
    void desktopBridge?.rpc.request.getSnapshot({}).then((snapshot) => {
      setProjects(snapshot.projects)
      setThreads(snapshot.threads)
      setActiveThreadId(null)
      setMessages({})
      setRuntimeMode(snapshot.settings.runtimeMode)
      setRecodeRepoRoot(snapshot.settings.recodeRepoRoot)
      setDetectedRepoRoot(snapshot.settings.detectedRepoRoot)
      setGpuAccelerationDisabled(snapshot.settings.gpuAccelerationDisabled === true)
    })
  }, [])

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null
      const editable = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable === true

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen((open) => !open)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        handleNewThread()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        setComposerFocusKey((value) => value + 1)
        return
      }

      if (event.key === 'Tab' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        handleToggleMode()
        return
      }

      // `?` opens the keyboard shortcut cheatsheet — only when the user isn't
      // typing into a text field.
      if (!editable && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '?') {
        event.preventDefault()
        setShortcutsOpen((open) => !open)
        return
      }

      if (event.key === 'Escape' && !editable) {
        setCommandPaletteOpen(false)
        setShortcutsOpen(false)
        setSettingsOpen(false)
        setModalOpen(false)
        setSlashPanel(null)
        setWorkspaceError(null)
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  })

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )

  const activeProject = useMemo(
    () =>
      activeThread
        ? (projects.find((p) => p.id === activeThread.projectId) ?? null)
        : null,
    [projects, activeThread],
  )

  const commandItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'new-thread',
        title: 'New thread',
        detail: 'Create a thread in the current workspace',
        section: 'Action',
        keywords: 'ctrl n',
        run: handleNewThread,
      },
      {
        id: 'open-workspace',
        title: 'Open workspace',
        detail: 'Add a folder to the sidebar',
        section: 'Action',
        run: handleNewFolder,
      },
      {
        id: 'focus-composer',
        title: 'Focus composer',
        detail: 'Jump to the prompt input',
        section: 'Action',
        keywords: 'ctrl l prompt input',
        run: () => setComposerFocusKey((value) => value + 1),
      },
      {
        id: 'toggle-sidebar',
        title: sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
        section: 'View',
        run: () => setSidebarOpen((open) => !open),
      },
      {
        id: 'settings',
        title: 'Open settings',
        detail: runtimeMode === 'dev' ? 'Runtime mode: dev' : 'Runtime mode: prod',
        section: 'View',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'mode-build',
        title: 'Switch to Build mode',
        section: 'Mode',
        run: () => handleChangeMode('build'),
      },
      {
        id: 'mode-plan',
        title: 'Switch to Plan mode',
        section: 'Mode',
        run: () => handleChangeMode('plan'),
      },
    ]

    for (const project of projects) {
      items.push({
        id: `workspace-${project.id}`,
        title: project.name,
        detail: project.path,
        section: 'Workspace',
        run: () => {
          const firstThread = threads.find((thread) => thread.projectId === project.id)
          if (firstThread) setActiveThreadId(firstThread.id)
          else createThreadInProject(project.id)
          expandProject(project.id)
        },
      })
    }

    for (const thread of threads) {
      const project = projects.find((item) => item.id === thread.projectId)
      items.push({
        id: `thread-${thread.id}`,
        title: thread.title,
        detail: project ? `${project.name} · ${thread.model}` : thread.model,
        section: 'Thread',
        keywords: thread.status,
        run: () => {
          setActiveThreadId(thread.id)
          expandProject(thread.projectId)
        },
      })
    }

    return items
  }, [projects, runtimeMode, sidebarOpen, threads])

  useEffect(() => {
    const selectedThread = activeThreadId
      ? (threads.find((thread) => thread.id === activeThreadId) ?? null)
      : null

    if (!selectedThread) {
      setModel('Recode default')
      setMode('build')
      setConfigOptions([])
      setConfigOptionsLoading(false)
      return
    }
    setModel(selectedThread.model)
    setMode(selectedThread.mode ?? 'build')

    const cachedConfigOptions = configOptionsByThread.current.get(selectedThread.id)
    if (cachedConfigOptions !== undefined) {
      setConfigOptions(cachedConfigOptions)
      setConfigOptionsLoading(false)
    } else {
      setConfigOptions([])
    }

    if (!bridge) return

    let cancelled = false
    setConfigOptionsLoading(true)
    void bridge.rpc.request
      .activateSession({ threadId: selectedThread.id })
      .then((result) => {
        if (cancelled) return
        configOptionsByThread.current.set(result.thread.id, result.configOptions)
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === result.thread.id ? { ...thread, ...result.thread } : thread,
          ),
        )
        setConfigOptions(result.configOptions)
        setModel(result.thread.model)
        setMode(result.thread.mode ?? 'build')
      })
      .catch((error: unknown) => {
        if (!cancelled) showWorkspaceError(error)
      })
      .finally(() => {
        if (!cancelled) setConfigOptionsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeThreadId, bridge])

  useEffect(() => {
    if (!activeThreadId) {
      setMessagesLoading(false)
      return
    }
    if (Object.prototype.hasOwnProperty.call(messages, activeThreadId)) {
      setMessagesLoading(false)
      return
    }
    if (!bridge) {
      setMessages((prev) => ({ ...prev, [activeThreadId]: [] }))
      setMessagesLoading(false)
      return
    }

    let cancelled = false
    setMessagesLoading(true)
    void bridge.rpc.request
      .getThreadMessages({ threadId: activeThreadId })
      .then((result) => {
        if (cancelled) return
        setMessages((prev) => ({
          ...prev,
          [activeThreadId]: result.messages.map(toChatMessage),
        }))
      })
      .catch((error: unknown) => {
        if (!cancelled) showWorkspaceError(error)
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeThreadId, bridge, messages])

  function toggleProjectCollapsed(id: string) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleNewThread() {
    const targetProject = activeProject ?? projects[0]
    if (!targetProject) {
      setModalOpen(true)
      return
    }
    createThreadInProject(targetProject.id)
  }

  /**
   * Used by the hero workspace picker. If the current thread is an empty
   * untitled scratch, keep the "move" behavior for local mock threads. In the
   * desktop runtime, a thread is backed by a workspace-bound session, so we
   * must create a real session in the newly selected workspace instead of only
   * changing the UI project id.
   */
  function switchHeroProject(projectId: string) {
    const current = activeThread
    const currentMessages = current ? messages[current.id] : undefined
    if (current && currentMessages !== undefined && currentMessages.length === 0) {
      if (bridge) {
        const project = projects.find((item) => item.id === projectId)
        if (!project) return
        void bridge.rpc.request
          .createSession({
            workspacePath: project.path,
            title: 'Untitled',
            mode,
            ...(model.includes('/') ? { model } : {}),
          })
          .then((created) => {
            void bridge.rpc.request.closeSession({ threadId: current.id })
            setProjects((prev) =>
              prev.some((item) => item.id === created.project.id)
                ? prev
                : [...prev, created.project],
            )
            setThreads((prev) => [
              created.thread,
              ...prev.filter((thread) => thread.id !== current.id && thread.id !== created.thread.id),
            ])
            setMessages((prev) => {
              const next = { ...prev, [created.thread.id]: [] }
              delete next[current.id]
              return next
            })
            setActiveThreadId(created.thread.id)
            configOptionsByThread.current.delete(current.id)
            configOptionsByThread.current.set(created.thread.id, created.configOptions)
            setConfigOptions(created.configOptions)
            setModel(created.thread.model)
            setMode(created.thread.mode ?? 'build')
            expandProject(created.project.id)
          })
          .catch((error: unknown) => showWorkspaceError(error))
        return
      }

      setThreads((prev) =>
        prev.map((t) => (t.id === current.id ? { ...t, projectId } : t)),
      )
      setCollapsedProjects((prev) => {
        if (!prev.has(projectId)) return prev
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
      return
    }
    createThreadInProject(projectId)
  }

  function createThreadInProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId)
    if (bridge && project) {
      void bridge.rpc.request
        .createSession({
          workspacePath: project.path,
          title: 'Untitled',
          mode,
          ...(model.includes('/') ? { model } : {}),
        })
        .then((created) => {
          setProjects((prev) =>
            prev.some((item) => item.id === created.project.id)
              ? prev
              : [...prev, created.project],
          )
          setThreads((prev) => [created.thread, ...prev])
          setMessages((prev) => ({ ...prev, [created.thread.id]: [] }))
          setActiveThreadId(created.thread.id)
          configOptionsByThread.current.set(created.thread.id, created.configOptions)
          setConfigOptions(created.configOptions)
          setModel(created.thread.model)
          setMode(created.thread.mode ?? 'build')
          expandProject(created.project.id)
        })
      return
    }

    const id = `thread-${Date.now()}`
    const t: Thread = {
      id,
      projectId,
      title: 'Untitled',
      model,
      mode,
      age: 'now',
    }
    setThreads((prev) => [t, ...prev])
    setMessages((prev) => ({ ...prev, [id]: [] }))
    setActiveThreadId(id)
    // ensure the project folder is expanded so the new thread is visible
    expandProject(projectId)
  }

  function expandProject(projectId: string) {
    setCollapsedProjects((prev) => {
      if (!prev.has(projectId)) return prev
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
  }

  function handleNewFolder() {
    setFolderPickerMode('workspace')
    setModalOpen(true)
  }

  function handleCloseThread(threadId: string) {
    void bridge?.rpc.request.closeSession({ threadId }).catch((error: unknown) => {
      showWorkspaceError(error)
    })
    setThreads((prev) => {
      const next = prev.filter((thread) => thread.id !== threadId)
      if (activeThreadId === threadId) {
        setActiveThreadId(next[0]?.id ?? null)
      }
      return next
    })
    setMessages((prev) => {
      const next = { ...prev }
      delete next[threadId]
      return next
    })
  }

  function handlePickProject(entry: PickerEntry) {
    void createWorkspaceSession(entry.path, entry)
  }

  function handleChooseRecodeRepo() {
    setFolderPickerMode('recode-repo')
    setSettingsOpen(false)
    setModalOpen(true)
  }

  function handleSelectDirectory(path: string) {
    if (folderPickerMode === 'recode-repo') {
      void bridge?.rpc.request
        .setRecodeRepoRoot({ path })
        .then((settings) => {
          setRuntimeMode(settings.runtimeMode)
          setRecodeRepoRoot(settings.recodeRepoRoot)
          setDetectedRepoRoot(settings.detectedRepoRoot)
          setModalOpen(false)
          setSettingsOpen(true)
        })
        .catch((error: unknown) => showWorkspaceError(error))
      return
    }

    void createWorkspaceSession(path)
  }

  async function createWorkspaceSession(
    workspacePath: string,
    fallbackProject?: Project,
  ) {
    try {
      setModalOpen(false)
      if (bridge) {
        const project = await bridge.rpc.request.addWorkspace({ workspacePath })
        setProjects((prev) =>
          prev.some((item) => item.path === project.path)
            ? prev
            : [...prev, project],
        )
        expandProject(project.id)

        const created = await bridge.rpc.request.createSession({
          workspacePath,
          title: 'Untitled',
          mode,
          ...(model.includes('/') ? { model } : {}),
        })
        setProjects((prev) =>
          prev.some((item) => item.path === created.project.path)
            ? prev
            : [...prev, created.project],
        )
        setThreads((prev) => [
          created.thread,
          ...prev.filter((thread) => thread.id !== created.thread.id),
        ])
        setMessages((prev) => ({ ...prev, [created.thread.id]: [] }))
        setActiveThreadId(created.thread.id)
        configOptionsByThread.current.set(created.thread.id, created.configOptions)
        setConfigOptions(created.configOptions)
        setModel(created.thread.model)
        setMode(created.thread.mode ?? 'build')
        expandProject(created.project.id)
        return
      }

      const project =
        fallbackProject ?? {
          id: `project-${Date.now()}`,
          name: workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath,
          path: workspacePath,
        }
      setProjects((prev) =>
        prev.some((item) => item.path === project.path) ? prev : [...prev, project],
      )
      createThreadInProject(project.id)
    } catch (error) {
      showWorkspaceError(error)
    }
  }

  function showWorkspaceError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const targetThreadId = activeThreadId ?? threads[0]?.id
    if (!targetThreadId) {
      setWorkspaceError(message)
      return
    }
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === targetThreadId ? { ...thread, status: 'error' } : thread,
      ),
    )
    setMessages((prev) => ({
      ...prev,
      [targetThreadId]: [
        ...(prev[targetThreadId] ?? []),
        {
          id: `workspace-error-${Date.now()}`,
          role: 'system',
          body: `Workspace error: ${message}`,
        },
      ],
    }))
  }

  function handleReconnectThread(threadId: string) {
    if (!bridge) return
    setConfigOptionsLoading(true)
    void bridge.rpc.request
      .activateSession({ threadId })
      .then((result) => {
        configOptionsByThread.current.set(result.thread.id, result.configOptions)
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === result.thread.id
              ? { ...thread, ...result.thread, status: result.thread.status ?? 'idle' }
              : thread,
          ),
        )
        if (result.thread.id === activeThreadId) {
          setConfigOptions(result.configOptions)
          setModel(result.thread.model)
          setMode(result.thread.mode ?? 'build')
        }
        setWorkspaceError(null)
      })
      .catch((error: unknown) => showWorkspaceError(error))
      .finally(() => setConfigOptionsLoading(false))
  }

  function handleSubmit(text: string) {
    if (!activeThread) {
      // start a fresh thread in the first available project, otherwise prompt for one.
      const targetProject = projects[0]
      if (!targetProject) {
        setModalOpen(true)
        return
      }
      if (bridge) {
        void bridge.rpc.request
          .createSession({
            workspacePath: targetProject.path,
            title: text.slice(0, 60),
            mode,
            ...(model.includes('/') ? { model } : {}),
          })
          .then((created) => {
            setProjects((prev) =>
              prev.some((item) => item.id === created.project.id)
                ? prev
                : [...prev, created.project],
            )
            setThreads((prev) => [
              { ...created.thread, status: 'running' },
              ...prev.filter((thread) => thread.id !== created.thread.id),
            ])
            setMessages((prev) => ({ ...prev, [created.thread.id]: [] }))
            setActiveThreadId(created.thread.id)
            configOptionsByThread.current.set(created.thread.id, created.configOptions)
            setConfigOptions(created.configOptions)
            setModel(created.thread.model)
            setMode(created.thread.mode ?? 'build')
            expandProject(created.project.id)
            void bridge.rpc.request.sendPrompt({ threadId: created.thread.id, text })
          })
          .catch((error: unknown) => showWorkspaceError(error))
        return
      }

      const id = `thread-${Date.now()}`
      const newThread: Thread = {
        id,
        projectId: targetProject.id,
        title: text.slice(0, 60),
        model,
        mode,
        age: 'now',
      }
      setThreads((prev) => [newThread, ...prev])
      setActiveThreadId(id)
      pushMessages(id, text)
      return
    }
    if (bridge) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeThread.id ? { ...thread, status: 'running' } : thread,
        ),
      )
      void bridge.rpc.request.sendPrompt({ threadId: activeThread.id, text })
      return
    }
    pushMessages(activeThread.id, text)
  }

  function handleCancelGeneration() {
    if (!activeThread || !bridge) return
    void bridge.rpc.request
      .cancelSession({ threadId: activeThread.id })
      .then((result) => {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === result.thread.id ? { ...thread, ...result.thread } : thread,
          ),
        )
      })
      .catch((error: unknown) => showWorkspaceError(error))
  }

  function handleChangeModel(nextModel: string) {
    setModel(nextModel)
    if (bridge && activeThread) {
      void bridge.rpc.request
        .setConfigOption({
          threadId: activeThread.id,
          configId: 'model',
          value: nextModel,
        })
        .then((result) => {
          configOptionsByThread.current.set(activeThread.id, result.configOptions)
          setConfigOptions(result.configOptions)
        })
    }
  }

  function handleChangeMode(nextMode: SessionMode) {
    setMode(nextMode)
    if (activeThread) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeThread.id ? { ...thread, mode: nextMode } : thread,
        ),
      )
    }
    if (bridge && activeThread) {
      void bridge.rpc.request
        .setConfigOption({
          threadId: activeThread.id,
          configId: 'mode',
          value: nextMode,
        })
        .then((result) => {
          configOptionsByThread.current.set(activeThread.id, result.configOptions)
          setConfigOptions(result.configOptions)
        })
    }
  }

  function handleToggleMode() {
    handleChangeMode(mode === 'plan' ? 'build' : 'plan')
  }

  function handleChangeRuntimeMode(nextMode: RecodeRuntimeMode) {
    setRuntimeMode(nextMode)
    void bridge?.rpc.request
      .setRuntimeMode({ runtimeMode: nextMode })
      .then((settings) => {
        setRuntimeMode(settings.runtimeMode)
        setRecodeRepoRoot(settings.recodeRepoRoot)
        setDetectedRepoRoot(settings.detectedRepoRoot)
      })
      .catch((error: unknown) => showWorkspaceError(error))
  }

  function handleChangeGpuAccelerationDisabled(disabled: boolean) {
    setGpuAccelerationDisabled(disabled)
    void bridge?.rpc.request
      .setGpuAccelerationDisabled({ disabled })
      .then((settings) => {
        setGpuAccelerationDisabled(settings.gpuAccelerationDisabled === true)
      })
      .catch((error: unknown) => showWorkspaceError(error))
  }

  function applyDesktopSessionUpdate(update: DesktopSessionUpdate) {
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === update.thread.id ? { ...thread, ...update.thread } : thread,
      ),
    )
    if (update.configOptions) {
      configOptionsByThread.current.set(update.thread.id, update.configOptions)
      if (update.thread.id === activeThreadId) {
        setConfigOptions(update.configOptions)
      }
    }
    if (update.message && !update.appendToMessageId && !update.replaceMessageId) {
      const incoming = toChatMessage(update.message)
      setMessages((prev) => ({
        ...prev,
        [update.message!.threadId]: [
          ...(prev[update.message!.threadId] ?? []),
          incoming,
        ],
      }))
    }
    if (update.appendToMessageId) {
      setMessages((prev) => ({
        ...prev,
        [update.thread.id]: (prev[update.thread.id] ?? []).map((message) =>
          message.id === update.appendToMessageId
            ? { ...message, body: `${message.body}${update.message?.body ?? ''}` }
            : message,
        ),
      }))
    }
    if (update.replaceMessageId && update.message) {
      const replacement = toChatMessage(update.message)
      setMessages((prev) => ({
        ...prev,
        [update.thread.id]: (prev[update.thread.id] ?? []).map((message) =>
          message.id === update.replaceMessageId ? replacement : message,
        ),
      }))
    }
  }

  function pushMessages(threadId: string, userText: string) {
    setMessages((prev) => {
      const list = prev[threadId] ?? []
      const userMsg: ChatMessage = {
        id: `m-${Date.now()}`,
        role: 'user',
        body: userText,
      }
      const reply: ChatMessage = {
        id: `m-${Date.now() + 1}`,
        role: 'assistant',
        body: `(mock reply, ${model}, reasoning=${reasoning})`,
      }
      return { ...prev, [threadId]: [...list, userMsg, reply] }
    })
  }

  function handleSlashCommand(command: string) {
    switch (command) {
      case '/help':
        setSlashPanel('help')
        return
      case '/status':
        setSlashPanel('status')
        return
      case '/config':
        setSlashPanel('config')
        return
      case '/todo':
        setSlashPanel('todo')
        return
      case '/export':
        setSlashPanel('export')
        return
      case '/compact':
        handleCompactThread()
        return
    }
  }

  function handleCompactThread() {
    if (!activeThread) return
    const compactMessage: ChatMessage = {
      id: `compact-${Date.now()}`,
      role: 'system',
      uiKind: 'compact',
      body: 'Earlier context was compacted into a focused summary marker for this desktop thread.',
    }
    setMessages((prev) => ({
      ...prev,
      [activeThread.id]: [...(prev[activeThread.id] ?? []), compactMessage],
    }))
  }

  function exportThread(format: 'html' | 'md') {
    if (!activeThread) return
    const threadMessages = messages[activeThread.id] ?? []
    const filenameBase = activeThread.title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'recode-thread'
    const content = format === 'html'
      ? renderThreadHtml(activeThread.title, threadMessages)
      : renderThreadMarkdown(activeThread.title, threadMessages)
    const blob = new Blob([content], { type: format === 'html' ? 'text/html' : 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${filenameBase}.${format === 'html' ? 'html' : 'md'}`
    anchor.click()
    URL.revokeObjectURL(url)
    setSlashPanel(null)
  }

  return (
    <MotionConfig reducedMotion={gpuAccelerationDisabled ? 'always' : 'never'}>
    <div className="h-screen flex bg-rc-bg overflow-hidden">
      <div
        className={`h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
          sidebarOpen ? 'w-[260px]' : 'w-0'
        }`}
      >
        <Suspense fallback={<SidebarLoading />}>
          <Sidebar
            projects={projects}
            threads={threads}
            activeThreadId={activeThreadId}
            collapsedProjects={collapsedProjects}
            onToggleProject={toggleProjectCollapsed}
            onSelectThread={setActiveThreadId}
            onNewThread={handleNewThread}
            onNewFolder={handleNewFolder}
            onNewThreadInProject={createThreadInProject}
            onCloseThread={handleCloseThread}
            onCollapse={() => setSidebarOpen(false)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setCommandPaletteOpen(true)}
          />
        </Suspense>
      </div>

        <main className="flex-1 flex flex-col min-w-0 bg-rc-bg">
          {(() => {
            const loadedThreadMessages = activeThread ? messages[activeThread.id] : undefined
            const threadMessages = loadedThreadMessages ?? []
            const messagesLoaded = !activeThread || loadedThreadMessages !== undefined
            const showHero = messagesLoaded && threadMessages.length === 0
            const isAgentWorking =
              activeThread?.status === 'running'
              || activeThread?.status === 'requires_action'
            const composer = (
              <>
                {isAgentWorking && <AgentWorkingIndicator />}
                <Composer
                  model={model}
                  mode={mode}
                  reasoning={reasoning}
                  modelOptions={configOptions.find((item) => item.id === 'model')?.options}
                  slashCommands={SLASH_COMMANDS}
                  modelMenuEmptyLabel={
                    configOptionsLoading
                      ? 'Loading models...'
                      : 'Select a workspace to load models'
                  }
                  onChangeModel={handleChangeModel}
                  onChangeMode={handleChangeMode}
                  onChangeReasoning={setReasoning}
                  onSlashCommand={handleSlashCommand}
                  onSubmit={handleSubmit}
                  onCancel={handleCancelGeneration}
                  focusKey={composerFocusKey}
                  isGenerating={isAgentWorking}
                />
              </>
            )
            return (
              <>
                <ChatHeader
                  project={activeProject}
                  thread={activeThread}
                  fresh={showHero}
                  sidebarHidden={!sidebarOpen}
                  onShowSidebar={() => setSidebarOpen(true)}
                />
                {showHero ? (
                  <div
                    key="hero"
                    className="flex-1 flex flex-col items-center justify-center px-6 hero-fade-in"
                  >
                    <div className="w-full max-w-[760px]">
                      <h1 className="text-center text-[24px] font-medium text-rc-text mb-1 tracking-tight">
                        What are we building?
                      </h1>
                      <p className="text-center text-[12.5px] text-rc-muted mb-6">
                        {activeProject ? (
                          <>
                            Working in{' '}
                            <ProjectThreadPicker
                              projects={projects}
                              activeProjectId={activeProject.id}
                              onSelectProject={switchHeroProject}
                            />
                          </>
                        ) : (
                          'Pick a workspace from the sidebar to begin.'
                        )}
                      </p>
                      {composer}
                    </div>
                  </div>
                ) : (
                  <>
                    {activeThread?.status === 'error' && (
                      <div className="mx-auto mt-3 w-full max-w-[760px] px-8">
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                          <span className="text-[12.5px] text-rc-text">
                            This thread hit a workspace error.
                          </span>
                          <button
                            onClick={() => handleReconnectThread(activeThread.id)}
                            className="shrink-0 rounded-md border border-rc-border px-2.5 py-1 text-[12px] text-rc-text hover:bg-rc-hover"
                          >
                            Reconnect
                          </button>
                        </div>
                      </div>
                    )}
                    {messagesLoading && !messagesLoaded ? (
                      <TranscriptLoading />
                    ) : (
                      <Suspense fallback={<TranscriptLoading />}>
                        <Transcript
                          thread={activeThread}
                          messages={threadMessages}
                          isGenerating={isAgentWorking}
                        />
                      </Suspense>
                    )}
                    <div key="docked" className="composer-fade-in">{composer}</div>
                  </>
                )}
              </>
            )
          })()}
        </main>

      <Suspense fallback={null}>
        {(modalOpen || settingsOpen || commandPaletteOpen || shortcutsOpen) && (
          <>
            <ProjectModal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              onSelect={handlePickProject}
              onOpenDirectory={
                bridge
                  ? (path) => bridge.rpc.request.listDirectory({ path })
                  : undefined
              }
              onSelectDirectory={handleSelectDirectory}
              showMockProjects={!desktopRuntime && !bridge}
              title={folderPickerMode === 'recode-repo' ? 'Choose Recode repo' : 'Open workspace'}
              description={
                folderPickerMode === 'recode-repo'
                  ? 'Pick the folder that contains Recode package.json and src/index.ts.'
                  : 'Pick a folder for Recode to operate inside.'
              }
              useLabel={folderPickerMode === 'recode-repo' ? 'Use repo' : 'Use folder'}
            />

            <SettingsModal
              open={settingsOpen}
              theme={theme}
              gpuAccelerationDisabled={gpuAccelerationDisabled}
              runtimeMode={runtimeMode}
              recodeRepoRoot={recodeRepoRoot}
              detectedRepoRoot={detectedRepoRoot}
              onClose={() => setSettingsOpen(false)}
              onChangeTheme={setTheme}
              onChangeGpuAccelerationDisabled={handleChangeGpuAccelerationDisabled}
              onChangeRuntimeMode={handleChangeRuntimeMode}
              onChooseRecodeRepo={handleChooseRecodeRepo}
            />

            <CommandPalette
              open={commandPaletteOpen}
              items={commandItems}
              onClose={() => setCommandPaletteOpen(false)}
            />

            <ShortcutsOverlay
              open={shortcutsOpen}
              onClose={() => setShortcutsOpen(false)}
            />
          </>
        )}
      </Suspense>

      {slashPanel && (
        <SlashCommandPanel
          panel={slashPanel}
          activeProject={activeProject}
          activeThread={activeThread}
          messages={activeThread ? (messages[activeThread.id] ?? []) : []}
          model={model}
          mode={mode}
          reasoning={reasoning}
          runtimeMode={runtimeMode}
          theme={theme}
          recodeRepoRoot={recodeRepoRoot}
          detectedRepoRoot={detectedRepoRoot}
          gpuAccelerationDisabled={gpuAccelerationDisabled}
          configOptions={configOptions}
          onClose={() => setSlashPanel(null)}
          onExport={exportThread}
        />
      )}

      {permissionRequest && (
        <div
          role="dialog"
          aria-label="Tool approval requested"
          className="fixed bottom-5 right-5 z-[120] w-[380px] rounded-xl border border-rc-border bg-rc-elevated shadow-2xl overflow-hidden"
          style={{ boxShadow: 'var(--rc-composer-shadow)' }}
        >
          <div className="px-4 py-3 border-b border-rc-border-soft flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-warning/15 flex items-center justify-center text-[color:var(--warning)]">
              <span className="text-[13px] font-semibold">!</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="display text-[12.5px] font-semibold text-rc-text">
                Tool approval
              </div>
              <div className="text-[10.5px] text-rc-faint mono uppercase tracking-wider">
                Awaiting decision
              </div>
            </div>
          </div>
          <div className="px-4 py-3 text-[12.5px] text-rc-muted leading-relaxed">
            {permissionRequest.title}
          </div>
          <div className="px-4 pb-3 flex justify-end gap-2">
            {permissionRequest.options.map((option) => (
              <button
                key={option.optionId}
                type="button"
                onClick={() => {
                  void bridge?.rpc.request.answerPermission({
                    requestId: permissionRequest.id,
                    optionId: option.optionId,
                  })
                  setPermissionRequest(null)
                }}
                className="px-3 py-1.5 rounded-md border border-rc-border bg-rc-card text-[12px] text-rc-text hover:bg-rc-hover transition-colors focus-ring"
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {questionRequest && (
        <QuestionPromptModal
          request={questionRequest}
          onDismiss={() => {
            void bridge?.rpc.request.answerQuestion({
              requestId: questionRequest.id,
              dismissed: true,
            })
            setQuestionRequest(null)
          }}
          onSubmit={(answers) => {
            void bridge?.rpc.request.answerQuestion({
              requestId: questionRequest.id,
              dismissed: false,
              answers,
            })
            setQuestionRequest(null)
          }}
        />
      )}

      {workspaceError && (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-[120] w-[380px] rounded-xl border border-destructive/30 bg-rc-elevated shadow-2xl overflow-hidden"
          style={{ boxShadow: 'var(--rc-composer-shadow)' }}
        >
          <div className="px-4 py-3 border-b border-rc-border-soft flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-destructive/15 flex items-center justify-center text-[color:var(--destructive)]">
              <span className="text-[13px] font-semibold">×</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="display text-[12.5px] font-semibold text-rc-text">
                Workspace error
              </div>
              <div className="text-[10.5px] text-rc-faint mono uppercase tracking-wider">
                Something went wrong
              </div>
            </div>
          </div>
          <div className="px-4 py-3 text-[12.5px] text-rc-muted leading-relaxed break-words">
            {workspaceError}
          </div>
          <div className="px-4 pb-3 flex justify-end gap-2">
            {activeThread && (
              <button
                type="button"
                onClick={() => handleReconnectThread(activeThread.id)}
                className="px-3 py-1.5 rounded-md border border-rc-border bg-rc-card text-[12px] text-rc-text hover:bg-rc-hover transition-colors focus-ring"
              >
                Reconnect
              </button>
            )}
            <button
              type="button"
              onClick={() => setWorkspaceError(null)}
              className="px-3 py-1.5 rounded-md border border-rc-border bg-rc-card text-[12px] text-rc-text hover:bg-rc-hover transition-colors focus-ring"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
    </MotionConfig>
  )
}

function AgentWorkingIndicator() {
  return (
    <div className="px-6 pt-1">
      <div className="mx-auto flex max-w-[760px] items-center gap-2 px-1.5 text-[12px] font-medium text-rc-muted">
        <DotmSquare18
          size={18}
          dotSize={2.6}
          speed={1.25}
          pattern="full"
          color="var(--rc-accent)"
          ariaLabel="Agent working"
        />
        <span>Working...</span>
      </div>
    </div>
  )
}

function TranscriptLoading() {
  return (
    <div className="flex-1 px-8 py-8">
      <div className="mx-auto h-6 max-w-[760px] rounded-md bg-rc-hover" />
    </div>
  )
}

function SidebarLoading() {
  return (
    <aside className="h-full w-[260px] shrink-0 border-r border-rc-border bg-rc-sidebar p-3">
      <div className="mb-4 h-6 rounded-md bg-rc-hover" />
      <div className="space-y-2">
        <div className="h-7 rounded-md bg-rc-hover" />
        <div className="h-7 rounded-md bg-rc-hover" />
        <div className="h-7 rounded-md bg-rc-hover" />
      </div>
    </aside>
  )
}

function QuestionPromptModal({
  request,
  onDismiss,
  onSubmit,
}: {
  request: DesktopQuestionRequest
  onDismiss: () => void
  onSubmit: (answers: { questionId: string; selectedOptionLabels: string[]; customText: string }[]) => void
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [customText, setCustomText] = useState<Record<string, string>>({})
  const [activeIndex, setActiveIndex] = useState(0)

  const activeQuestion = request.questions[activeIndex]

  function toggle(questionId: string, label: string, multiSelect: boolean) {
    setSelected((prev) => {
      const current = prev[questionId] ?? []
      const next = multiSelect
        ? current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label]
        : [label]
      return { ...prev, [questionId]: next }
    })
  }

  function handleSubmit() {
    onSubmit(request.questions.map((question) => ({
      questionId: question.id,
      selectedOptionLabels: selected[question.id] ?? [],
      customText: customText[question.id] ?? '',
    })))
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center px-6 pt-[15vh]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss()
        if (event.key === 'ArrowLeft') setActiveIndex((i) => Math.max(0, i - 1))
        if (event.key === 'ArrowRight')
          setActiveIndex((i) => Math.min(request.questions.length - 1, i + 1))
      }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onDismiss} />
      <div
        className="relative w-full max-w-[600px] rounded-lg border-2 bg-rc-elevated shadow-2xl overflow-hidden"
        style={{ borderColor: 'var(--rc-accent)' }}
      >
        <div className="px-4 py-2.5 border-b border-rc-border-soft flex items-center justify-between bg-rc-bg">
          <div className="flex items-center gap-2">
            <span className="text-rc-accent mono text-[13px]">◆</span>
            <span className="text-[13px] font-semibold text-rc-accent mono">Questions</span>
          </div>
          <span className="text-[11px] text-rc-faint mono">
            {`Question ${activeIndex + 1} of ${request.questions.length} · ←/→ switch · ESC dismiss`}
          </span>
        </div>

        {activeQuestion && (
          <div className="p-4 max-h-[60vh] overflow-y-auto">
            <div className="text-[13px] font-semibold text-rc-text mb-1">
              {activeQuestion.header}
            </div>
            <div className="text-[12.5px] text-rc-muted leading-relaxed mb-1">
              {activeQuestion.question}
            </div>
            <div className="text-[11px] text-rc-faint italic mb-3">
              {activeQuestion.multiSelect
                ? 'Select any answers that apply.'
                : 'Select one answer.'}
            </div>

            <div
              className="rounded-md border border-rc-border-soft p-2 space-y-2"
              style={{ background: 'var(--rc-bg)' }}
            >
              {activeQuestion.options.map((option) => {
                const active = (selected[activeQuestion.id] ?? []).includes(option.label)
                return (
                  <button
                    key={option.label}
                    onClick={() => toggle(activeQuestion.id, option.label, activeQuestion.multiSelect)}
                    className={'question-option' + (active ? ' is-selected' : '')}
                  >
                    <span className={'question-marker' + (active ? ' is-checked' : '')}>
                      {activeQuestion.multiSelect
                        ? active ? '[x]' : '[ ]'
                        : active ? '(•)' : '( )'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-rc-text">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="block text-[11.5px] text-rc-muted leading-relaxed mt-0.5">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>

            {activeQuestion.allowCustomText && (
              <div className="mt-3 rounded-md border border-rc-border-soft p-2 bg-rc-bg">
                <div className="flex items-center gap-2">
                  <span className="text-rc-accent mono text-[12px]">✎</span>
                  <span className="text-[11px] text-rc-faint">Custom answer</span>
                </div>
                <textarea
                  value={customText[activeQuestion.id] ?? ''}
                  onChange={(event) =>
                    setCustomText((prev) => ({ ...prev, [activeQuestion.id]: event.target.value }))
                  }
                  placeholder="Optional custom answer..."
                  className="mt-1.5 w-full min-h-16 rounded border border-rc-border bg-rc-card px-2 py-1.5 text-[12.5px] text-rc-text outline-none placeholder-rc-faint mono"
                />
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-2.5 border-t border-rc-border-soft flex items-center justify-between bg-rc-bg">
          <div className="flex gap-1">
            {request.questions.map((_, index) => (
              <button
                key={index}
                onClick={() => setActiveIndex(index)}
                className={'h-1.5 w-5 rounded-full transition-colors ' + (
                  index === activeIndex
                    ? 'bg-rc-accent'
                    : 'bg-rc-border hover:bg-rc-faint'
                )}
                aria-label={`Question ${index + 1}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-[12px] text-rc-muted hover:text-rc-text transition-colors mono"
            >
              ESC dismiss
            </button>
            <button
              onClick={handleSubmit}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] hover:opacity-90 transition-opacity mono"
            >
              ↵ Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SlashCommandPanel({
  panel,
  activeProject,
  activeThread,
  messages,
  model,
  mode,
  reasoning,
  runtimeMode,
  theme,
  recodeRepoRoot,
  detectedRepoRoot,
  gpuAccelerationDisabled,
  configOptions,
  onClose,
  onExport,
}: {
  panel: SlashPanel
  activeProject: Project | null
  activeThread: Thread | null
  messages: ChatMessage[]
  model: string
  mode: SessionMode
  reasoning: ReasoningLevel
  runtimeMode: RecodeRuntimeMode
  theme: ThemeMode
  recodeRepoRoot?: string
  detectedRepoRoot?: string
  gpuAccelerationDisabled: boolean
  configOptions: DesktopConfigOption[]
  onClose: () => void
  onExport: (format: 'html' | 'md') => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = panelTitle(panel)
  const Icon = panelIcon(panel)
  const todos = extractLatestTodos(messages)

  return (
    <div className="fixed inset-0 z-[135] flex items-start justify-center px-6 pt-[14vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
        className="relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-rc-border bg-rc-elevated/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 border-b border-rc-border-soft px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rc-accent-soft text-rc-accent">
            <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="display text-[14px] font-semibold text-rc-text">{title}</div>
            <div className="text-[11.5px] text-rc-muted">/{panel}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-rc-muted transition-colors hover:bg-rc-hover hover:text-rc-text focus-ring"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-4">
          {panel === 'help' && <HelpPanel />}
          {panel === 'status' && (
            <StatusPanel
              activeProject={activeProject}
              activeThread={activeThread}
              messages={messages}
              model={model}
              mode={mode}
              runtimeMode={runtimeMode}
            />
          )}
          {panel === 'config' && (
            <ConfigPanel
              model={model}
              mode={mode}
              reasoning={reasoning}
              runtimeMode={runtimeMode}
              theme={theme}
              recodeRepoRoot={recodeRepoRoot}
              detectedRepoRoot={detectedRepoRoot}
              gpuAccelerationDisabled={gpuAccelerationDisabled}
              configOptions={configOptions}
            />
          )}
          {panel === 'todo' && <TodoPanel todos={todos} />}
          {panel === 'export' && <ExportPanel activeThread={activeThread} onExport={onExport} />}
        </div>
      </motion.div>
    </div>
  )
}

function HelpPanel() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SLASH_COMMANDS.map((command) => (
        <div key={command.command} className="rounded-xl border border-rc-border-soft bg-rc-card p-3">
          <div className="font-mono text-[12.5px] font-semibold text-rc-text">{command.command}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-rc-muted">{command.description}</div>
        </div>
      ))}
    </div>
  )
}

function StatusPanel({
  activeProject,
  activeThread,
  messages,
  model,
  mode,
  runtimeMode,
}: {
  activeProject: Project | null
  activeThread: Thread | null
  messages: ChatMessage[]
  model: string
  mode: SessionMode
  runtimeMode: RecodeRuntimeMode
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-rc-border-soft bg-rc-card p-3">
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-rc-text">
          <Circle className="h-3.5 w-3.5 text-rc-accent" fill="currentColor" strokeWidth={0} />
          {activeThread?.status ?? 'idle'}
        </div>
        <InfoGrid
          items={[
            ['Workspace', activeProject?.path ?? 'No workspace selected'],
            ['Thread', activeThread?.title ?? 'No thread selected'],
            ['Mode', mode],
            ['Model', model],
            ['Runtime', runtimeMode],
            ['Messages', String(messages.length)],
          ]}
        />
      </div>
    </div>
  )
}

function ConfigPanel({
  model,
  mode,
  reasoning,
  runtimeMode,
  theme,
  recodeRepoRoot,
  detectedRepoRoot,
  gpuAccelerationDisabled,
  configOptions,
}: {
  model: string
  mode: SessionMode
  reasoning: ReasoningLevel
  runtimeMode: RecodeRuntimeMode
  theme: ThemeMode
  recodeRepoRoot?: string
  detectedRepoRoot?: string
  gpuAccelerationDisabled: boolean
  configOptions: DesktopConfigOption[]
}) {
  return (
    <div className="space-y-3">
      <InfoGrid
        items={[
          ['Mode', mode],
          ['Model', model],
          ['Reasoning', reasoning],
          ['Runtime', runtimeMode],
          ['Theme', theme],
          ['Animations', gpuAccelerationDisabled ? 'paused' : 'running'],
          ['Recode repo', recodeRepoRoot ?? detectedRepoRoot ?? 'Not selected'],
          ['Config options', `${configOptions.length} loaded`],
        ]}
      />
    </div>
  )
}

function TodoPanel({ todos }: { todos: { content: string; status: string; priority?: string }[] }) {
  const completed = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.filter((todo) => todo.status === 'in_progress').length
  const pending = todos.filter((todo) => todo.status === 'pending').length
  const progress = todos.length === 0 ? 0 : Math.round((completed / todos.length) * 100)

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-rc-border-soft bg-rc-card py-10 text-center">
        <ListChecks className="mb-3 h-7 w-7 text-rc-faint" strokeWidth={1.6} />
        <div className="display text-[13px] font-medium text-rc-text">No task plan yet</div>
        <div className="mt-1 text-[12px] text-rc-muted">Todo updates will appear here once a task plan exists.</div>
      </div>
    )
  }

  return (
    <div className="tool-artifact tool-artifact-todo">
      <div className="tool-artifact-header">
        <div className="min-w-0 flex items-center gap-2">
          <span className="tool-artifact-icon tool-artifact-icon--todo" aria-hidden="true">
            <ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
          <span className="font-medium text-rc-text text-[12.5px]">Task plan</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10.5px]">
          <span className="tool-artifact-count">
            <span className="tool-artifact-count-value">{completed}</span>
            <span className="tool-artifact-count-divider">/</span>
            <span className="tool-artifact-count-total">{todos.length}</span>
          </span>
          {active > 0 && <span className="tool-artifact-pill tool-artifact-pill--active">{active} active</span>}
          {pending > 0 && <span className="tool-artifact-pill tool-artifact-pill--pending">{pending} pending</span>}
        </div>
      </div>
      <div className="tool-artifact-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="tool-artifact-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="space-y-2">
        {todos.map((todo, index) => (
          <div key={`${todo.content}-${index}`} className="flex items-start gap-2.5">
            <div className="mt-[1px]">{todo.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <Circle className="h-3.5 w-3.5 text-rc-faint" />}</div>
            <div className="min-w-0 leading-snug">
              <div className={cn('text-[12.5px]', todo.status === 'completed' ? 'text-rc-muted line-through decoration-rc-faint' : 'text-rc-text')}>
                {todo.content}
              </div>
              <div className="text-[11px] text-rc-faint">{todo.status}{todo.priority ? ` · ${todo.priority}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExportPanel({ activeThread, onExport }: { activeThread: Thread | null; onExport: (format: 'html' | 'md') => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ExportChoice icon={FileCode2} title="HTML" description="Export a styled browser-readable transcript." disabled={!activeThread} onClick={() => onExport('html')} />
      <ExportChoice icon={FileText} title="Markdown" description="Export a portable plain-text transcript." disabled={!activeThread} onClick={() => onExport('md')} />
    </div>
  )
}

function ExportChoice({ icon: Icon, title, description, disabled, onClick }: { icon: typeof FileText; title: string; description: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="group rounded-xl border border-rc-border-soft bg-rc-card p-4 text-left transition-colors hover:bg-rc-hover disabled:cursor-not-allowed disabled:opacity-50 focus-ring">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-rc-accent-soft text-rc-accent">
        <Icon className="h-4.5 w-4.5" strokeWidth={1.7} />
      </div>
      <div className="display text-[13px] font-semibold text-rc-text">{title}</div>
      <div className="mt-1 text-[12px] leading-relaxed text-rc-muted">{description}</div>
      <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-rc-muted group-hover:text-rc-text">
        <Download className="h-3.5 w-3.5" strokeWidth={1.7} /> Export
      </div>
    </button>
  )
}

function InfoGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 rounded-xl border border-rc-border-soft bg-rc-card px-3 py-2">
          <span className="text-[11.5px] text-rc-muted">{label}</span>
          <span className="max-w-[70%] break-words text-right text-[12px] font-medium text-rc-text">{value}</span>
        </div>
      ))}
    </div>
  )
}

function panelTitle(panel: SlashPanel): string {
  switch (panel) {
    case 'help': return 'Help'
    case 'status': return 'Status'
    case 'config': return 'Config'
    case 'todo': return 'Todo'
    case 'export': return 'Export'
  }
}

function panelIcon(panel: SlashPanel) {
  switch (panel) {
    case 'help': return HelpCircle
    case 'status': return Circle
    case 'config': return Settings2
    case 'todo': return ListChecks
    case 'export': return Download
  }
}

function extractLatestTodos(messages: ChatMessage[]): { content: string; status: string; priority?: string }[] {
  for (const message of [...messages].reverse()) {
    if (message.toolKind !== 'TodoWrite' || !Array.isArray(message.toolInput?.todos)) continue
    return message.toolInput.todos.filter(isRecord).map((todo) => ({
      content: typeof todo.content === 'string' ? todo.content : '',
      status: typeof todo.status === 'string' ? todo.status : 'pending',
      priority: typeof todo.priority === 'string' ? todo.priority : undefined,
    })).filter((todo) => todo.content.length > 0)
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderThreadMarkdown(title: string, messages: ChatMessage[]): string {
  return [`# ${title}`, '', ...messages.map((message) => `## ${message.role}\n\n${message.body}`)].join('\n\n')
}

function renderThreadHtml(title: string, messages: ChatMessage[]): string {
  const body = messages.map((message) => `<section><h2>${escapeHtml(message.role)}</h2><pre>${escapeHtml(message.body)}</pre></section>`).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;line-height:1.5}section{border-top:1px solid #ddd;padding:16px 0}pre{white-space:pre-wrap;font-family:ui-monospace,monospace}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
