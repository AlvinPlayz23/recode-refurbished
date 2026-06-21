/**
 * Recode CLI entrypoint.
 *
 * @author dev
 */

declare const RECODE_VERSION: string;

import { runAgentLoop } from "./agent/run-agent-loop.ts";
import { runSubagentTask, type SubagentTaskRecord } from "./agent/subagent.ts";
import { parseCliArgs, type ParsedCliArgs } from "./cli/args.ts";
import { runDoctor } from "./cli/doctor.ts";
import { runSetupWizard } from "./cli/setup.ts";
import { resolveCliWorkspace } from "./cli/workspace.ts";
import {
  ConfigurationError,
  ModelResponseError,
  OperationAbortedError,
  ToolExecutionError
} from "./errors/recode-error.ts";
import {
  createConversationRecord,
  resolveHistoryRoot,
  saveConversation
} from "./history/recode-history.ts";
import { createLanguageModel } from "./models/create-model-client.ts";
import { buildSystemPrompt } from "./prompt/agents-md.ts";
import { DEFAULT_SYSTEM_PROMPT } from "./prompt/system-prompt.ts";
import {
  loadRuntimeConfig,
  selectRuntimeProviderModel,
  type RuntimeConfig
} from "./runtime/runtime-config.ts";
import type { ApprovalMode } from "./tools/tool.ts";
import { createTools } from "./tools/create-tools.ts";
import { ToolRegistry } from "./tools/tool-registry.ts";

const version = typeof RECODE_VERSION !== "undefined" ? RECODE_VERSION : "0.1.0";

try {
  const { workspaceRoot, argv } = resolveCliWorkspace(Bun.argv.slice(2), Bun.env, process.cwd());
  const cliArgs = parseCliArgs(argv);

  if (cliArgs.command === "version") {
    console.log(`Recode v${version}`);
    process.exit(0);
  }

  if (cliArgs.command === "help") {
    console.log(`Recode v${version}

Usage:
  recode             Start the TUI
  recode setup       Open the provider and model setup wizard
  recode doctor      Check config, provider, model, history, and model listing
  recode acp-server  Start the local ACP HTTP/WebSocket broker
  recode acp-server --stdio
                     Run ACP over stdio for editor subprocess clients
  recode <prompt>    Run one-shot mode

Options:
  --workspace <dir>  Set the workspace root
  --cwd <dir>        Alias for --workspace
  --provider <id>    Use a configured provider ID for this run
  --model <id>       Use a model ID for this run
  --approval-mode <mode>
                     Use approval, auto-edits, or yolo for this run
  --host <host>      ACP server host, default 127.0.0.1
  --port <port>      ACP server port, default 0
  --token <token>    ACP server bearer token, default generated
  --stdio            Run ACP over stdin/stdout instead of HTTP/WebSocket
  --no-history       Do not save one-shot runs to history
  -h, --help         Show help
  -v, --version      Show version`);
    process.exit(0);
  }

  process.chdir(workspaceRoot);

  if (cliArgs.command === "setup") {
    await runSetupWizard(workspaceRoot);
    process.exit(0);
  }

  if (cliArgs.command === "acp-server") {
    const { runAcpServer, runAcpStdioServer } = await import("./acp/acp-server.ts");
    if (cliArgs.acpStdio) {
      await runAcpStdioServer({
        overrides: {
          ...(cliArgs.providerId === undefined ? {} : { providerId: cliArgs.providerId }),
          ...(cliArgs.modelId === undefined ? {} : { modelId: cliArgs.modelId }),
          ...(cliArgs.approvalMode === undefined ? {} : { approvalMode: cliArgs.approvalMode })
        }
      });
      process.exit(0);
    }

    await runAcpServer({
      ...(cliArgs.acpHost === undefined ? {} : { host: cliArgs.acpHost }),
      ...(cliArgs.acpPort === undefined ? {} : { port: cliArgs.acpPort }),
      ...(cliArgs.acpToken === undefined ? {} : { token: cliArgs.acpToken }),
      overrides: {
        ...(cliArgs.providerId === undefined ? {} : { providerId: cliArgs.providerId }),
        ...(cliArgs.modelId === undefined ? {} : { modelId: cliArgs.modelId }),
        ...(cliArgs.approvalMode === undefined ? {} : { approvalMode: cliArgs.approvalMode })
      }
    });
  }

  const prompt = cliArgs.prompt;
  const runtimeConfig = applyCliRuntimeOverrides(loadRuntimeConfig(workspaceRoot), cliArgs);
  const systemPrompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, workspaceRoot);

  if (cliArgs.command === "doctor") {
    process.exit(await runDoctor(runtimeConfig));
  }

  const languageModel = createLanguageModel(runtimeConfig);
  const toolRegistry = new ToolRegistry(createTools());
  const subagentTasks = new Map<string, SubagentTaskRecord>();

  if (cliArgs.command === "tui") {
    const { runTui } = await import("./tui/run-tui.ts");
    await runTui({
      systemPrompt: systemPrompt,
      runtimeConfig,
      languageModel,
      toolRegistry,
      toolContext: {
        workspaceRoot: runtimeConfig.workspaceRoot,
        approvalMode: runtimeConfig.approvalMode,
        approvalAllowlist: runtimeConfig.approvalAllowlist,
        permissionRules: runtimeConfig.permissionRules
      }
    });
  } else {
    const abortController = new AbortController();
    let ctrlCArmed = false;
    let ctrlCTimer: ReturnType<typeof setTimeout> | undefined;
    let streamedText = "";
    const handleSigint = () => {
      if (ctrlCArmed) {
        process.exit(130);
      }

      ctrlCArmed = true;
      abortController.abort();
      console.error("Try Ctrl+C again to exit.");

      if (ctrlCTimer !== undefined) {
        clearTimeout(ctrlCTimer);
      }

      ctrlCTimer = setTimeout(() => {
        ctrlCArmed = false;
        ctrlCTimer = undefined;
      }, 1800);
    };

    process.on("SIGINT", handleSigint);
    try {
      const result = await runAgentLoop({
        systemPrompt: systemPrompt,
        initialUserPrompt: prompt,
        languageModel,
        toolRegistry,
        abortSignal: abortController.signal,
        onTextDelta(delta) {
          streamedText += delta;
          process.stdout.write(delta);
        },
        toolContext: {
          workspaceRoot: runtimeConfig.workspaceRoot,
          approvalMode: runtimeConfig.approvalMode,
          approvalAllowlist: runtimeConfig.approvalAllowlist,
          permissionRules: runtimeConfig.permissionRules,
          runSubagentTask: async (request) => await runSubagentTask({
            request,
            parentRuntimeConfig: runtimeConfig,
            parentSystemPrompt: systemPrompt,
            parentToolRegistry: toolRegistry,
            parentToolContext: {
              workspaceRoot: runtimeConfig.workspaceRoot,
              approvalMode: runtimeConfig.approvalMode,
              approvalAllowlist: runtimeConfig.approvalAllowlist,
              permissionRules: runtimeConfig.permissionRules,
              ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal })
            },
            findTask(taskId) {
              return subagentTasks.get(taskId);
            },
            saveTask(record) {
              subagentTasks.set(record.id, record);
            }
          })
        }
      });

      const printedText = streamedText.length === 0 ? result.finalText : streamedText;
      if (streamedText.length === 0 && result.finalText.length > 0) {
        process.stdout.write(result.finalText);
      }
      if (printedText.length > 0 && !printedText.endsWith("\n")) {
        process.stdout.write("\n");
      }

      if (cliArgs.persistHistory) {
        const historyRoot = resolveHistoryRoot(runtimeConfig.configPath);
        saveConversation(
          historyRoot,
          createConversationRecord(runtimeConfig, result.transcript, "build"),
          true
        );
      }
    } catch (error) {
      if (error instanceof OperationAbortedError) {
        process.exit(130);
      }

      throw error;
    } finally {
      process.off("SIGINT", handleSigint);
      if (ctrlCTimer !== undefined) {
        clearTimeout(ctrlCTimer);
      }
    }
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("Unknown error");
  }

  process.exit(exitCodeForError(error));
}

function applyCliRuntimeOverrides(
  runtimeConfig: RuntimeConfig,
  cliArgs: Pick<ParsedCliArgs, "providerId" | "modelId" | "approvalMode">
): RuntimeConfig {
  let nextConfig = runtimeConfig;

  if (cliArgs.providerId !== undefined || cliArgs.modelId !== undefined) {
    const providerId = cliArgs.providerId ?? nextConfig.providerId;
    const provider = nextConfig.providers.find((item) => item.id === providerId);
    if (provider === undefined) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const modelId = cliArgs.modelId
      ?? provider.defaultModelId
      ?? provider.models[0]?.id;
    if (modelId === undefined || modelId.trim() === "") {
      throw new Error(`Provider '${providerId}' has no model. Pass --model <id> or run recode setup.`);
    }

    nextConfig = selectRuntimeProviderModel(nextConfig, providerId, modelId);
  }

  if (cliArgs.approvalMode !== undefined) {
    nextConfig = withApprovalMode(nextConfig, cliArgs.approvalMode);
  }

  return nextConfig;
}

function withApprovalMode(runtimeConfig: RuntimeConfig, approvalMode: ApprovalMode): RuntimeConfig {
  return {
    ...runtimeConfig,
    approvalMode
  };
}

function exitCodeForError(error: unknown): number {
  if (error instanceof OperationAbortedError) {
    return 130;
  }

  if (error instanceof ModelResponseError) {
    return 70;
  }

  if (error instanceof ConfigurationError || isConfigurationErrorMessage(error)) {
    return 78;
  }

  if (error instanceof ToolExecutionError || isToolDeniedMessage(error)) {
    return 73;
  }

  if (isUsageErrorMessage(error)) {
    return 64;
  }

  return 1;
}

function isUsageErrorMessage(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith("Unknown option:")
    || error.message.startsWith("Missing value for")
    || error.message.startsWith("Invalid approval mode:");
}

function isConfigurationErrorMessage(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith("Missing provider")
    || error.message.startsWith("Missing model")
    || error.message.startsWith("Missing provider base URL")
    || error.message.startsWith("Unknown provider:")
    || error.message.includes("has no model");
}

function isToolDeniedMessage(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Tool execution denied")
    || error.message.includes("Approval required");
}
