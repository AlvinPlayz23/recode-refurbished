/**
 * Live subagent task wiring for the TUI app.
 */

type Accessor<T> = () => T;
type Setter<T> = (value: T | ((previous: T) => T)) => void;
import {
  runSubagentTask,
  resolveSubagentRuntimeConfig,
  type SubagentTaskHandler,
  type SubagentTaskRecord
} from "../../agent/subagent.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type {
  QuestionToolDecision,
  QuestionToolRequest,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolApprovalScope,
  ToolExecutionContext,
  ApprovalMode,
  PermissionRule
} from "../../tools/tool.ts";
import { ToolRegistry } from "../../tools/tool-registry.ts";
import type { SavedConversationRecord } from "../../history/recode-history.ts";
import {
  appendLiveSubagentTextDelta,
  appendLiveSubagentToolCall,
  appendLiveSubagentToolResult,
  applyLiveSubagentTranscriptUpdate,
  completeLiveSubagentTask,
  createLiveSubagentTask,
  createLiveSubagentTasksFromRecords,
  failLiveSubagentTask,
  upsertLiveSubagentTask,
  type ChatView,
  type LiveSubagentTask
} from "../subagent-view.ts";
import {
  pruneBashToolOutputMetadata,
  pruneBashToolOutputTranscript,
} from "../transcript/transcript-entry-state.ts";

/** Dependencies for building the TUI subagent controller. */
export interface TuiSubagentControllerOptions {
  readonly getCurrentConversation: Accessor<SavedConversationRecord | undefined>;
  readonly getSubagentTasks: Accessor<readonly SubagentTaskRecord[]>;
  readonly setSubagentTasks: Setter<readonly SubagentTaskRecord[]>;
  readonly setLiveSubagentTasks: Setter<readonly LiveSubagentTask[]>;
  readonly setActiveChatView: Setter<ChatView>;
  readonly getRuntimeConfig: Accessor<RuntimeConfig>;
  readonly parentSystemPrompt: string;
  readonly parentToolRegistry: ToolRegistry;
  readonly parentToolContext: ToolExecutionContext;
  readonly getApprovalMode: Accessor<ApprovalMode>;
  readonly getApprovalAllowlist: Accessor<readonly ToolApprovalScope[]>;
  readonly getPermissionRules: Accessor<readonly PermissionRule[]>;
  readonly requestToolApproval: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  readonly requestQuestionAnswers: (request: QuestionToolRequest) => Promise<QuestionToolDecision>;
  readonly toErrorMessage: (error: unknown) => string;
  readonly retainBashToolOutput: Accessor<boolean>;
}

/** Runtime controller exposed to the TUI app shell. */
export interface TuiSubagentController {
  readonly restoreSubagentTaskState: (records: readonly SubagentTaskRecord[]) => void;
  readonly runTuiSubagentTask: SubagentTaskHandler;
}

/** Build live subagent restore and execution handlers. */
export function createTuiSubagentController(options: TuiSubagentControllerOptions): TuiSubagentController {
  const restoreSubagentTaskState = (records: readonly SubagentTaskRecord[]) => {
    options.setSubagentTasks(records);
    options.setLiveSubagentTasks(createLiveSubagentTasksFromRecords(records, options.retainBashToolOutput()));
    options.setActiveChatView({ kind: "parent" });
  };

  const runTuiSubagentTask: SubagentTaskHandler = async (request) => {
    const currentConversationId = options.getCurrentConversation()?.id;
    const existingTask = request.taskId === undefined
      ? undefined
      : options.getSubagentTasks().find((task) => task.id === request.taskId);
    const taskId = existingTask?.id ?? request.taskId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const subagentRuntimeConfig = resolveSubagentRuntimeConfig(options.getRuntimeConfig(), request.subagentType);
    options.setLiveSubagentTasks((previous) => upsertLiveSubagentTask(previous, createLiveSubagentTask({
      id: taskId,
      subagentType: request.subagentType,
      description: request.description,
      prompt: request.prompt,
      transcript: existingTask?.transcript ?? [],
      createdAt: existingTask?.createdAt ?? now,
      updatedAt: now,
      providerId: subagentRuntimeConfig.providerId,
      providerName: subagentRuntimeConfig.providerName,
      model: subagentRuntimeConfig.model,
      status: "running"
    })));

    try {
      return await runSubagentTask({
        request: {
          ...request,
          taskId
        },
        parentRuntimeConfig: options.getRuntimeConfig(),
        parentSystemPrompt: options.parentSystemPrompt,
        parentToolRegistry: options.parentToolRegistry,
        parentToolContext: {
          ...options.parentToolContext,
          approvalMode: options.getApprovalMode(),
          approvalAllowlist: options.getApprovalAllowlist(),
          permissionRules: options.getPermissionRules(),
          requestToolApproval: options.requestToolApproval,
          requestQuestionAnswers: options.requestQuestionAnswers,
          ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
        },
        findTask(taskId) {
          return options.getSubagentTasks().find((task) => task.id === taskId);
        },
        saveTask(record) {
          const memoryRecord = options.retainBashToolOutput()
            ? record
            : {
                ...record,
                transcript: pruneBashToolOutputTranscript(record.transcript)
              };
          options.setSubagentTasks((previous) => [
            ...previous.filter((task) => task.id !== memoryRecord.id),
            memoryRecord
          ]);
          options.setLiveSubagentTasks((previous) => completeLiveSubagentTask(
            previous,
            memoryRecord,
            options.retainBashToolOutput()
          ));
        },
        onTextDelta(delta) {
          options.setLiveSubagentTasks((previous) => appendLiveSubagentTextDelta(previous, taskId, delta));
        },
        onToolCall(toolCall) {
          options.setLiveSubagentTasks((previous) => appendLiveSubagentToolCall(previous, taskId, toolCall));
        },
        onToolResult(toolResult) {
          const metadata = options.retainBashToolOutput()
            ? toolResult.metadata
            : pruneBashToolOutputMetadata(toolResult.metadata);
          const memoryToolResult = metadata === toolResult.metadata
            ? toolResult
            : {
                ...toolResult,
                ...(metadata === undefined ? {} : { metadata })
              };
          options.setLiveSubagentTasks((previous) => appendLiveSubagentToolResult(previous, taskId, memoryToolResult));
        },
        onTranscriptUpdate(transcript) {
          const memoryTranscript = options.retainBashToolOutput()
            ? transcript
            : pruneBashToolOutputTranscript(transcript);
          options.setLiveSubagentTasks((previous) => applyLiveSubagentTranscriptUpdate(previous, taskId, memoryTranscript));
        },
        ...(currentConversationId === undefined ? {} : { requestAffinityKey: currentConversationId })
      });
    } catch (error) {
      options.setLiveSubagentTasks((previous) => failLiveSubagentTask(previous, taskId, options.toErrorMessage(error)));
      throw error;
    }
  };

  return {
    restoreSubagentTaskState,
    runTuiSubagentTask
  };
}
