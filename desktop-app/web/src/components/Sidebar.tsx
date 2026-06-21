/**
 * Sidebar — adopts the ref-src visual language:
 *
 *   ┌───────────────────────────────┐
 *   │  [logo]  Recode      [⇤]      │ header
 *   │                               │
 *   │  [✎] New chat            ⌘N   │
 *   │  [+] New folder          ⌘O   │
 *   │  [⌕] Search              ⌘K   │
 *   │  ───────────────────────────  │
 *   │  [PINNED HERO ROTATOR]        │ (kept)
 *   │  PROJECTS                     │
 *   │   ▸ folder                    │
 *   │     ▸ thread                  │
 *   │  CHATS                        │
 *   │   ▸ orphaned thread           │
 *   │                               │
 *   │  [⚙] Settings                 │ footer (kept here per spec)
 *   └───────────────────────────────┘
 *
 * Implementation notes:
 *  - We keep the pinned-thread hero rotator with shuffle, hover pin/close.
 *  - We keep our existing prop surface and motion behavior.
 *  - The new look uses subtler borders, slightly larger hit-targets, and
 *    a refined typographic rhythm reminiscent of the reference.
 */

import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FolderPlus,
  GitBranch,
  ListFilter,
  MessageCircleMore,
  PanelLeftClose,
  Pin,
  Plus,
  Radio,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react'
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type Transition,
} from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, Thread } from '../types'
import { cn } from '../lib/cn'
import { Kbd, KbdGroup } from './ui/kbd'

interface SidebarProps {
  projects: Project[]
  threads: Thread[]
  activeThreadId: string | null
  collapsedProjects: Set<string>
  onToggleProject: (id: string) => void
  onSelectThread: (id: string) => void
  onNewThread: () => void
  onNewFolder: () => void
  onNewThreadInProject: (projectId: string) => void
  onCloseThread: (threadId: string) => void
  onCollapse: () => void
  onOpenSettings: () => void
  onOpenSearch?: () => void
}

const PIN_STORAGE_KEY = 'recode-pinned-threads'

const springConfig: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 40,
}

function readPinnedFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return new Set()
  }
}

export function Sidebar({
  projects,
  threads,
  activeThreadId,
  collapsedProjects,
  onToggleProject,
  onSelectThread,
  onNewThread,
  onNewFolder,
  onNewThreadInProject,
  onCloseThread,
  onCollapse,
  onOpenSettings,
  onOpenSearch,
}: SidebarProps) {
  const [pinned, setPinned] = useState<Set<string>>(readPinnedFromStorage)
  const [heroIndex, setHeroIndex] = useState(0)
  const [showFade, setShowFade] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.localStorage.setItem(
      PIN_STORAGE_KEY,
      JSON.stringify(Array.from(pinned)),
    )
  }, [pinned])

  const pinnedThreads = useMemo(
    () => threads.filter((thread) => pinned.has(thread.id)),
    [threads, pinned],
  )

  const orphanThreads = useMemo(() => {
    const projectIds = new Set(projects.map((p) => p.id))
    return threads.filter((t) => !projectIds.has(t.projectId))
  }, [projects, threads])

  useEffect(() => {
    if (pinnedThreads.length === 0) {
      if (heroIndex !== 0) setHeroIndex(0)
      return
    }
    if (heroIndex >= pinnedThreads.length) {
      setHeroIndex(0)
    }
  }, [pinnedThreads, heroIndex])

  const currentHeroThread = pinnedThreads[heroIndex]

  const togglePin = useCallback((threadId: string) => {
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(threadId)) {
        next.delete(threadId)
      } else {
        next.add(threadId)
      }
      return next
    })
  }, [])

  const shuffleHero = useCallback(() => {
    if (pinnedThreads.length <= 1) return
    setHeroIndex((index) => (index + 1) % pinnedThreads.length)
  }, [pinnedThreads.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const checkScroll = () => {
      const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      setShowFade(!isAtBottom && el.scrollHeight > el.clientHeight)
    }
    checkScroll()
    el.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)
    return () => {
      el.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [projects, threads, pinnedThreads.length])

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col select-none border-r border-rc-border bg-rc-sidebar">
      {/* Header — wordmark-ish placeholder + collapse */}
      <div className="flex h-11 items-center justify-between gap-1 px-2.5">
        <div className="flex min-w-0 items-center gap-2 pl-1">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/90 text-background shadow-sm">
            <span className="display text-[12px] font-semibold leading-none">R</span>
          </div>
          <span className="display truncate text-[13.5px] font-semibold tracking-tight text-rc-text">
            Recode
          </span>
        </div>
        <button
          onClick={onCollapse}
          title="Hide sidebar"
          className="flex h-7 w-7 items-center justify-center rounded-md text-rc-faint transition-colors hover:bg-rc-hover hover:text-rc-text"
        >
          <PanelLeftClose className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </button>
      </div>

      {/* NavMain — clean rows with kbd hints, ref-src style */}
      <div className="space-y-0.5 px-2 pt-1 pb-2">
        <NavRow
          icon={<MessageCircleMore className="h-[15px] w-[15px]" strokeWidth={1.5} />}
          label="New chat"
          onClick={onNewThread}
          shortcut={
            <KbdGroup className="ml-auto scale-90 gap-0">
              <Kbd className="size-3 bg-transparent">⌘</Kbd>
              <Kbd className="size-3 bg-transparent uppercase">N</Kbd>
            </KbdGroup>
          }
        />
        <NavRow
          icon={<FolderPlus className="h-[15px] w-[15px]" strokeWidth={1.5} />}
          label="New project"
          onClick={onNewFolder}
        />
        <NavRow
          icon={<Search className="h-[15px] w-[15px]" strokeWidth={1.5} />}
          label="Search"
          onClick={onOpenSearch}
          shortcut={
            <KbdGroup className="ml-auto scale-90 gap-0">
              <Kbd className="size-3 bg-transparent">⌘</Kbd>
              <Kbd className="size-3 bg-transparent uppercase">K</Kbd>
            </KbdGroup>
          }
        />
      </div>

      {/* Pinned hero rotator (kept) */}
      <MotionConfig transition={springConfig}>
        <div className="px-2.5">
          <motion.div layout className="overflow-hidden">
            <AnimatePresence mode="popLayout">
              {pinnedThreads.length > 0 && currentHeroThread && (
                <motion.button
                  key="pinned-hero"
                  layout
                  type="button"
                  initial={{ opacity: 0, scale: 0.92, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -10 }}
                  onClick={() => onSelectThread(currentHeroThread.id)}
                  className="group/hero flex w-full cursor-pointer items-center justify-between rounded-2xl bg-primary p-2 pr-2.5 text-primary-foreground shadow-sm"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/20">
                      <Pin className="h-3.5 w-3.5" fill="currentColor" />
                    </div>
                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={currentHeroThread.id}
                        initial={{ opacity: 0, scale: 0.85, filter: 'blur(6px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.85, filter: 'blur(6px)' }}
                        transition={{ duration: 0.45, type: 'spring', bounce: 0 }}
                        className="truncate text-[13px] font-semibold"
                      >
                        {currentHeroThread.title}
                      </motion.span>
                    </AnimatePresence>
                  </div>

                  {pinnedThreads.length > 1 && (
                    <motion.span
                      whileTap={{ scale: 0.92 }}
                      onClick={(event) => {
                        event.stopPropagation()
                        shuffleHero()
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/20 transition-colors hover:bg-primary-foreground/30"
                    >
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                    </motion.span>
                  )}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Scrollable region: Projects + Chats */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto px-2 pt-2 pb-2"
        >
          {/* PROJECTS section header */}
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-rc-faint">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onNewFolder}
                title="New project"
                className="flex h-6 w-6 items-center justify-center rounded-md text-rc-faint transition-colors hover:bg-rc-hover hover:text-rc-text"
              >
                <FolderPlus className="h-[13px] w-[13px]" strokeWidth={1.5} />
              </button>
              <button
                title="Filter / sort"
                className="flex h-6 w-6 items-center justify-center rounded-md text-rc-faint transition-colors hover:bg-rc-hover hover:text-rc-text"
              >
                <ListFilter className="h-[13px] w-[13px]" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {projects.length === 0 ? (
            <div className="px-2 py-1.5 text-[11.5px] italic text-rc-faint">
              No projects yet
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {projects.map((project) => {
                const isCollapsed = collapsedProjects.has(project.id)
                const projectThreads = threads.filter(
                  (t) => t.projectId === project.id,
                )
                return (
                  <motion.div
                    layout
                    key={project.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mb-0.5"
                  >
                    <div
                      className="group relative flex items-center rounded-lg px-2 py-1.5 hover:bg-rc-hover"
                      title={project.path}
                    >
                      <button
                        onClick={() => onToggleProject(project.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight
                            className="h-3 w-3 shrink-0 text-rc-faint"
                            strokeWidth={2}
                          />
                        ) : (
                          <ChevronDown
                            className="h-3 w-3 shrink-0 text-rc-faint"
                            strokeWidth={2}
                          />
                        )}
                        <span className="truncate text-[12.5px] font-medium text-rc-text">
                          {project.name}
                        </span>
                      </button>

                      <span className="mono ml-2 text-[10px] text-rc-faint transition-opacity duration-150 group-hover:opacity-0">
                        {projectThreads.length}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onNewThreadInProject(project.id)
                        }}
                        title={`New thread in ${project.name}`}
                        className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-rc-muted opacity-0 transition-opacity duration-150 hover:bg-rc-hover-strong hover:text-rc-text group-hover:opacity-100"
                      >
                        <Plus className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </div>

                    <AnimatePresence initial={false}>
                      {!isCollapsed && (
                        <motion.div
                          key="children"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="ml-3 overflow-hidden border-l border-rc-border-soft pl-1"
                        >
                          {projectThreads.length === 0 ? (
                            <div className="px-2 py-1 text-[11px] italic text-rc-faint">
                              No threads
                            </div>
                          ) : (
                            <AnimatePresence initial={false} mode="popLayout">
                              {projectThreads.map((thread) => {
                                const isHero = currentHeroThread?.id === thread.id
                                return (
                                  <ThreadRow
                                    key={thread.id}
                                    thread={thread}
                                    active={thread.id === activeThreadId}
                                    isPinned={pinned.has(thread.id)}
                                    isHero={isHero}
                                    onSelect={() => onSelectThread(thread.id)}
                                    onClose={() => onCloseThread(thread.id)}
                                    onTogglePin={() => togglePin(thread.id)}
                                  />
                                )
                              })}
                            </AnimatePresence>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}

          {/* CHATS section — orphaned threads (no parent project) */}
          {orphanThreads.length > 0 && (
            <>
              <div className="mt-3 flex items-center justify-between px-2 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-rc-faint">
                  Chats
                </span>
              </div>
              <AnimatePresence initial={false} mode="popLayout">
                {orphanThreads.map((thread) => {
                  const isHero = currentHeroThread?.id === thread.id
                  return (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      active={thread.id === activeThreadId}
                      isPinned={pinned.has(thread.id)}
                      isHero={isHero}
                      onSelect={() => onSelectThread(thread.id)}
                      onClose={() => onCloseThread(thread.id)}
                      onTogglePin={() => togglePin(thread.id)}
                    />
                  )
                })}
              </AnimatePresence>
            </>
          )}

          <AnimatePresence>
            {showFade && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none sticky bottom-0 -mt-12 h-12 bg-gradient-to-t from-rc-sidebar via-rc-sidebar/90 to-transparent"
              />
            )}
          </AnimatePresence>
        </div>
      </MotionConfig>

      {/* Footer — Settings stays here per user spec */}
      <div className="border-t border-rc-border-soft px-2 pt-2 pb-3">
        <NavRow
          icon={<Settings className="h-[15px] w-[15px]" strokeWidth={1.5} />}
          label="Settings"
          onClick={onOpenSettings}
        />
      </div>
    </aside>
  )
}

function NavRow({
  icon,
  label,
  onClick,
  shortcut,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  shortcut?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
        'text-rc-text hover:bg-rc-hover',
      )}
    >
      <span className="text-rc-muted">{icon}</span>
      <span className="font-medium">{label}</span>
      {shortcut}
    </button>
  )
}

// Re-uses the original ThreadRow look (pin/close hover, status, age) verbatim.
function ThreadRow({
  thread,
  active,
  isPinned,
  isHero,
  onSelect,
  onClose,
  onTogglePin,
}: {
  thread: Thread
  active: boolean
  isPinned: boolean
  isHero: boolean
  onSelect: () => void
  onClose: () => void
  onTogglePin: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{
        opacity: 1,
        scale: isHero ? [1, 1.02, 1] : 1,
      }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: 'spring',
        stiffness: 420,
        damping: 32,
        scale: { duration: 0.35 },
      }}
      className={cn(
        'thread-row group relative flex items-center gap-1.5 overflow-hidden rounded-lg px-2 py-1.5 text-left transition-colors',
        active ? 'active' : 'text-rc-text hover:bg-rc-hover',
      )}
    >
      {isHero && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.1, times: [0, 0.2, 1] }}
          className="pointer-events-none absolute inset-0 bg-rc-accent-soft"
        />
      )}

      <button
        onClick={onSelect}
        title={thread.title}
        className="relative z-10 flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-rc-hover text-rc-faint transition-colors group-hover:text-rc-muted">
          <SquarePen className="h-2.5 w-2.5" strokeWidth={2} />
        </span>
        <span className="block min-w-0 truncate text-[12.5px] leading-snug">
          {thread.title}
        </span>
      </button>

      <span className="relative z-10 flex shrink-0 items-center gap-1">
        {thread.badge === 'branch' && (
          <GitBranch className="h-3 w-3 text-rc-faint" strokeWidth={1.5} />
        )}
        <ThreadStatusIndicator status={thread.status ?? 'idle'} />

        <span className="mono text-[10.5px] text-rc-faint group-hover:hidden">
          {thread.age}
        </span>

        <button
          onClick={(event) => {
            event.stopPropagation()
            onTogglePin()
          }}
          title={isPinned ? 'Unpin thread' : 'Pin thread'}
          className={cn(
            'hidden h-5 w-5 items-center justify-center rounded-md transition-colors group-hover:flex',
            isPinned
              ? 'text-rc-accent hover:bg-rc-accent-soft'
              : 'text-rc-faint hover:bg-rc-hover-strong hover:text-rc-text',
          )}
        >
          <Pin className="h-3 w-3" fill={isPinned ? 'currentColor' : 'none'} />
        </button>
        {isPinned && (
          <span
            title="Pinned"
            className="inline-flex h-3.5 w-3.5 items-center justify-center text-rc-accent group-hover:hidden"
          >
            <Pin className="h-3 w-3" fill="currentColor" />
          </span>
        )}

        <button
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          title="Close thread"
          className="hidden h-5 w-5 items-center justify-center rounded-md text-rc-faint hover:bg-rc-hover-strong hover:text-rc-text group-hover:flex"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      </span>
    </motion.div>
  )
}

function ThreadStatusIndicator({
  status,
}: {
  status: NonNullable<Thread['status']>
}) {
  if (status === 'running') {
    return (
      <span title="Running" className="thread-status-dot is-running">
        <Radio className="h-2.5 w-2.5" strokeWidth={2.2} />
      </span>
    )
  }

  if (status === 'requires_action') {
    return (
      <span title="Waiting for input" className="thread-status-dot is-waiting" />
    )
  }

  if (status === 'error') {
    return (
      <span title="Error" className="thread-status-dot is-error">
        <AlertCircle className="h-3 w-3" strokeWidth={2} />
      </span>
    )
  }

  return <span title="Idle" className="thread-status-dot is-idle" />
}
