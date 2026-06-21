/**
 * Tool approval policy helpers.
 */

import {
  evaluatePermissionRules,
  getToolPermissionKey,
  getToolPermissionPattern
} from "./permission-rules.ts";
import type { ToolArguments, ToolApprovalRequest, ToolApprovalScope, ToolExecutionContext } from "./tool.ts";

/**
 * Return an approval denial message when a tool cannot run yet.
 */
export async function checkToolApproval(
  toolName: string,
  arguments_: ToolArguments,
  context: ToolExecutionContext
): Promise<string | undefined> {
  const approvalMode = context.approvalMode ?? "approval";
  const scope = getToolApprovalScope(toolName);
  const permission = getToolPermissionKey(toolName, scope);
  const pattern = getToolPermissionPattern(toolName, arguments_);
  const rule = evaluatePermissionRules(permission, pattern, context.permissionRules ?? []);

  if (rule.action === "deny") {
    return `Tool execution denied by permission rule (${permission}:${pattern}).`;
  }

  if (rule.action === "allow") {
    return undefined;
  }

  if (!requiresApproval(approvalMode, scope, context.approvalAllowlist ?? [])) {
    return undefined;
  }

  if (context.requestToolApproval === undefined) {
    return `Approval required for ${toolName}, but no interactive approval handler is available.`;
  }

  const request: ToolApprovalRequest = {
    toolName,
    scope,
    permission,
    pattern,
    arguments: arguments_
  };

  const decision = await context.requestToolApproval(request);
  return decision === "deny" ? "Tool execution denied by user." : undefined;
}

/**
 * Map one tool name into its approval scope.
 */
export function getToolApprovalScope(toolName: string): ToolApprovalScope {
  switch (toolName) {
    case "AskUserQuestion":
    case "TodoWrite":
    case "Task":
      return "read";
    case "Read":
    case "Glob":
    case "Grep":
      return "read";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "Write":
    case "Edit":
    case "ApplyPatch":
      return "edit";
    case "Bash":
      return "bash";
    default:
      return "edit";
  }
}

/**
 * Determine whether one approval scope needs explicit approval.
 */
export function requiresApproval(
  approvalMode: ToolExecutionContext["approvalMode"],
  scope: ToolApprovalScope,
  allowlist: readonly ToolApprovalScope[]
): boolean {
  if (allowlist.includes(scope)) {
    return false;
  }

  switch (approvalMode) {
    case "yolo":
      return false;
    case "auto-edits":
      return scope === "bash" || scope === "web";
    case "approval":
    default:
      return scope === "edit" || scope === "bash" || scope === "web";
  }
}
