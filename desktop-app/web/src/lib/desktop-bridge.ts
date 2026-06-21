import { Electroview } from 'electrobun/view'
import type {
  DesktopConfigOption,
  DesktopDirectoryListing,
  DesktopErrorUpdate,
  DesktopMessage,
  DesktopProject,
  DesktopPermissionRequest,
  DesktopQuestionRequest,
  DesktopSessionActivated,
  DesktopSessionCreated,
  DesktopSessionUpdate,
  DesktopSettings,
  DesktopSnapshot,
  DesktopThread,
  RecodeDesktopRPC,
  RecodeRuntimeMode,
  SessionMode,
} from '../desktop-rpc'

export interface DesktopBridge {
  rpc: {
    request: {
      getSnapshot: (params: Record<string, never>) => Promise<DesktopSnapshot>
      getThreadMessages: (params: { threadId: string }) => Promise<{ messages: DesktopMessage[] }>
      setRuntimeMode: (params: { runtimeMode: RecodeRuntimeMode }) => Promise<DesktopSettings>
      setRecodeRepoRoot: (params: { path: string }) => Promise<DesktopSettings>
      setGpuAccelerationDisabled: (params: { disabled: boolean }) => Promise<DesktopSettings>
      listDirectory: (params: { path?: string }) => Promise<DesktopDirectoryListing>
      addWorkspace: (params: { workspacePath: string }) => Promise<DesktopProject>
      createSession: (params: {
        workspacePath: string
        title?: string
        mode?: SessionMode
        model?: string
      }) => Promise<DesktopSessionCreated>
      activateSession: (params: { threadId: string }) => Promise<DesktopSessionActivated>
      sendPrompt: (params: {
        threadId: string
        text: string
      }) => Promise<{ messageId: string }>
      cancelSession: (params: { threadId: string }) => Promise<{ thread: DesktopThread }>
      setConfigOption: (params: {
        threadId: string
        configId: 'mode' | 'model'
        value: string
      }) => Promise<{ configOptions: DesktopConfigOption[] }>
      answerPermission: (params: {
        requestId: string
        optionId: string
      }) => Promise<Record<string, never>>
      answerQuestion: (params:
        | {
            requestId: string
            dismissed: true
          }
        | {
            requestId: string
            dismissed: false
            answers: {
              questionId: string
              selectedOptionLabels: string[]
              customText: string
            }[]
          }
      ) => Promise<Record<string, never>>
      closeSession: (params: { threadId: string }) => Promise<Record<string, never>>
    }
  }
}

export interface DesktopBridgeHandlers {
  onSessionUpdate: (update: DesktopSessionUpdate) => void
  onPermissionRequest: (request: DesktopPermissionRequest) => void
  onQuestionRequest: (request: DesktopQuestionRequest) => void
  onSessionError: (error: DesktopErrorUpdate) => void
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__electrobun' in window
}

export function createDesktopBridge(
  handlers: DesktopBridgeHandlers,
): DesktopBridge | null {
  if (!isDesktopRuntime()) {
    return null
  }

  const rpc = Electroview.defineRPC<RecodeDesktopRPC>({
    maxRequestTime: Infinity,
    handlers: {
      requests: {},
      messages: {
        sessionUpdate: handlers.onSessionUpdate,
        permissionRequest: handlers.onPermissionRequest,
        questionRequest: handlers.onQuestionRequest,
        sessionError: handlers.onSessionError,
      },
    },
  })

  new Electroview({ rpc })
  return { rpc: rpc as DesktopBridge['rpc'] }
}
