/**
 * Bash execution policy selection.
 */

import { validateCommand } from "./bash-sandbox.ts";
import {
  spawnDirect,
  type SpawnOptions
} from "./bwrap-sandbox.ts";

/**
 * Bash execution isolation mode.
 */
export type BashExecutionIsolation = "unsandboxed";

/**
 * Resolved Bash execution policy.
 */
export interface BashExecutionPolicy {
  readonly isolation: BashExecutionIsolation;
  readonly validate: (command: string, workspaceRoot: string) => string | null;
  readonly spawn: (
    command: string,
    workspaceRoot: string,
    options: SpawnOptions
  ) => Bun.Subprocess<"ignore", "pipe", "pipe">;
}

/**
 * Resolve the active Bash execution policy.
 */
export async function resolveBashExecutionPolicy(): Promise<BashExecutionPolicy> {
  // Bash is intentionally unsandboxed. Approval prompts and validation are UX
  // guardrails only; they are not an isolation boundary.
  return {
    isolation: "unsandboxed",
    validate(command, workspaceRoot) {
      return validateCommandForUnsandboxedExecution(command, workspaceRoot);
    },
    spawn: spawnDirect
  };
}

/**
 * Validate a command before unsandboxed direct execution.
 */
export function validateCommandForUnsandboxedExecution(command: string, workspaceRoot: string): string | null {
  const validationError = validateCommand(command, workspaceRoot);
  if (validationError !== null) {
    return validationError;
  }

  if (usesUnsupportedShellExpansion(command)) {
    return "Shell expansions and command substitution are not allowed by Recode's Bash guardrails.";
  }

  return null;
}

function usesUnsupportedShellExpansion(command: string): boolean {
  return command.includes("$(")
    || command.includes("${")
    || command.includes("`");
}
