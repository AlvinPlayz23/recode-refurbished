/**
 * Tool-approval request resolution helpers for the TUI.
 */

import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  selectConfiguredPermissionRules
} from "../../config/recode-config.ts";
import { createPermissionRule } from "../../tools/permission-rules.ts";
import type { PermissionRule, ToolApprovalDecision } from "../../tools/tool.ts";
import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type { ActiveApprovalRequest } from "../tui-app-types.ts";
import {
  appendEntry,
  createEntry,
  type SetUiEntries
} from "../transcript/transcript-entry-state.ts";

/** Dependencies for approval request resolution. */
export interface ApprovalRequestControllerOptions {
  readonly getActiveApprovalRequest: () => ActiveApprovalRequest | undefined;
  readonly setActiveApprovalRequest: (value: ActiveApprovalRequest | undefined) => void;
  readonly getPermissionRules: () => readonly PermissionRule[];
  readonly getRuntimeConfig: () => RuntimeConfig;
  readonly updatePermissionRules: (nextPermissionRules: readonly PermissionRule[]) => void;
  readonly setEntries: SetUiEntries;
  readonly focusPrompt: () => void;
  readonly toErrorMessage: (error: unknown) => string;
}

/** Create a resolver for active tool approval requests. */
export function createApprovalRequestController(options: ApprovalRequestControllerOptions): {
  readonly resolveApprovalRequest: (decision: ToolApprovalDecision) => void;
} {
  return {
    resolveApprovalRequest(decision) {
      const request = options.getActiveApprovalRequest();
      if (request === undefined) {
        return;
      }

      let finalDecision = decision;
      if (decision === "allow-always") {
        const nextRules = [
          ...options.getPermissionRules(),
          createPermissionRule(request.permission, request.pattern, "allow")
        ];

        try {
          const runtimeConfig = options.getRuntimeConfig();
          const config = loadRecodeConfigFile(runtimeConfig.configPath);
          const nextConfig = selectConfiguredPermissionRules(config, nextRules);
          saveRecodeConfigFile(runtimeConfig.configPath, nextConfig);
          options.updatePermissionRules(nextRules);
          appendEntry(
            options.setEntries,
            createEntry("status", "status", `Always allowing ${request.permission}:${request.pattern}`)
          );
        } catch (error) {
          appendEntry(options.setEntries, createEntry("error", "error", options.toErrorMessage(error)));
          finalDecision = "deny";
        }
      }

      options.setActiveApprovalRequest(undefined);
      request.resolve(finalDecision);
      options.focusPrompt();
    }
  };
}
