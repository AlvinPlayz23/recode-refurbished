import type { RPCSchema } from 'electrobun/view'

export type SessionMode = 'build' | 'plan'
export type RecodeRuntimeMode = 'dev' | 'prod'

export interface DesktopProject {
  id: string
  name: string
  path: string
}

export interface DesktopThread {
  id: string
  projectId: string
  title: string
  model: string
  mode: SessionMode
  status: 'idle' | 'running' | 'requires_action' | 'error'
  age: string
}

export interface DesktopConfigOptionValue {
  value: string
  name: string
  description?: string
}

export interface DesktopConfigOption {
  id: 'mode' | 'model'
  name: string
  currentValue: string
  options: DesktopConfigOptionValue[]
}

export interface DesktopMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  body: string
  toolCallId?: string
  toolKind?: string
  toolStatus?: 'pending' | 'in_progress' | 'completed' | 'failed'
  toolInput?: Record<string, unknown>
  toolContent?: string
}

export interface DesktopPermissionOption {
  optionId: string
  name: string
  kind: string
}

export interface DesktopPermissionRequest {
  id: string
  threadId: string
  title: string
  kind: string
  options: DesktopPermissionOption[]
}

export interface DesktopQuestionOption {
  label: string
  description: string
}

export interface DesktopQuestionPrompt {
  id: string
  header: string
  question: string
  multiSelect: boolean
  allowCustomText: boolean
  options: DesktopQuestionOption[]
}

export interface DesktopQuestionRequest {
  id: string
  threadId: string
  questions: DesktopQuestionPrompt[]
}

export interface DesktopQuestionAnswer {
  questionId: string
  selectedOptionLabels: string[]
  customText: string
}

export interface DesktopSnapshot {
  projects: DesktopProject[]
  threads: DesktopThread[]
  messages: Record<string, DesktopMessage[]>
  settings: DesktopSettings
}

export interface DesktopSettings {
  runtimeMode: RecodeRuntimeMode
  recodeRepoRoot?: string
  detectedRepoRoot?: string
  gpuAccelerationDisabled?: boolean
}

export interface DesktopSessionCreated {
  project: DesktopProject
  thread: DesktopThread
  configOptions: DesktopConfigOption[]
}

export interface DesktopSessionActivated {
  thread: DesktopThread
  configOptions: DesktopConfigOption[]
}

export interface DesktopSessionUpdate {
  thread: DesktopThread
  message?: DesktopMessage
  appendToMessageId?: string
  replaceMessageId?: string
  configOptions?: DesktopConfigOption[]
}

export interface DesktopErrorUpdate {
  threadId?: string
  message: string
}

export interface DesktopDirectoryEntry {
  name: string
  path: string
}

export interface DesktopDirectoryListing {
  path: string
  parentPath?: string
  entries: DesktopDirectoryEntry[]
}

export type RecodeDesktopRPC = {
  bun: RPCSchema<{
    requests: {
      getSnapshot: {
        params: Record<string, never>
        response: DesktopSnapshot
      }
      getThreadMessages: {
        params: {
          threadId: string
        }
        response: {
          messages: DesktopMessage[]
        }
      }
      setRuntimeMode: {
        params: {
          runtimeMode: RecodeRuntimeMode
        }
        response: DesktopSettings
      }
      setRecodeRepoRoot: {
        params: {
          path: string
        }
        response: DesktopSettings
      }
      setGpuAccelerationDisabled: {
        params: {
          disabled: boolean
        }
        response: DesktopSettings
      }
      listDirectory: {
        params: {
          path?: string
        }
        response: DesktopDirectoryListing
      }
      addWorkspace: {
        params: {
          workspacePath: string
        }
        response: DesktopProject
      }
      createSession: {
        params: {
          workspacePath: string
          title?: string
          mode?: SessionMode
          model?: string
        }
        response: DesktopSessionCreated
      }
      activateSession: {
        params: {
          threadId: string
        }
        response: DesktopSessionActivated
      }
      sendPrompt: {
        params: {
          threadId: string
          text: string
        }
        response: { messageId: string }
      }
      cancelSession: {
        params: {
          threadId: string
        }
        response: { thread: DesktopThread }
      }
      setConfigOption: {
        params: {
          threadId: string
          configId: 'mode' | 'model'
          value: string
        }
        response: { configOptions: DesktopConfigOption[] }
      }
      answerPermission: {
        params: {
          requestId: string
          optionId: string
        }
        response: Record<string, never>
      }
      answerQuestion: {
        params:
          | {
              requestId: string
              dismissed: true
            }
          | {
              requestId: string
              dismissed: false
              answers: DesktopQuestionAnswer[]
            }
        response: Record<string, never>
      }
      closeSession: {
        params: {
          threadId: string
        }
        response: Record<string, never>
      }
    }
    messages: Record<string, never>
  }>
  webview: RPCSchema<{
    requests: Record<string, never>
    messages: {
      sessionUpdate: DesktopSessionUpdate
      permissionRequest: DesktopPermissionRequest
      questionRequest: DesktopQuestionRequest
      sessionError: DesktopErrorUpdate
    }
  }>
}
