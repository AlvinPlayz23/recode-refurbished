/**
 * Runtime approval state update helpers for the TUI.
 */

import type { RuntimeConfig } from "../../runtime/runtime-config.ts";
import type { ApprovalMode, PermissionRule, ToolApprovalScope } from "../../tools/tool.ts";

/** Dependencies for approval/runtime state updates. */
export interface ApprovalRuntimeStateOptions {
  readonly getPermissionRules: () => readonly PermissionRule[];
  readonly setApprovalMode: (value: ApprovalMode) => void;
  readonly setApprovalAllowlist: (value: readonly ToolApprovalScope[]) => void;
  readonly setPermissionRules: (value: readonly PermissionRule[]) => void;
  readonly setRuntimeConfig: (setter: (current: RuntimeConfig) => RuntimeConfig) => void;
}

/** Create approval and permission-rule runtime update functions. */
export function createApprovalRuntimeState(options: ApprovalRuntimeStateOptions): {
  readonly updateApprovalSettings: (
    nextApprovalMode: ApprovalMode,
    nextApprovalAllowlist: readonly ToolApprovalScope[]
  ) => void;
  readonly updatePermissionRules: (nextPermissionRules: readonly PermissionRule[]) => void;
} {
  return {
    updateApprovalSettings(nextApprovalMode, nextApprovalAllowlist) {
      options.setApprovalMode(nextApprovalMode);
      options.setApprovalAllowlist(nextApprovalAllowlist);
      options.setRuntimeConfig((current) => ({
        ...current,
        approvalMode: nextApprovalMode,
        approvalAllowlist: nextApprovalAllowlist,
        permissionRules: options.getPermissionRules()
      }));
    },
    updatePermissionRules(nextPermissionRules) {
      options.setPermissionRules(nextPermissionRules);
      options.setRuntimeConfig((current) => ({
        ...current,
        permissionRules: nextPermissionRules
      }));
    }
  };
}
