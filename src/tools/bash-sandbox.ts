/**
 * Safety validation for Bash commands.
 *
 * This blocks shell commands at the application layer when they may escape the
 * workspace, attempt privilege escalation, mutate dangerous environment
 * variables, or redirect output outside the workspace.
 *
 * @author dev
 */

import { isAbsolute, relative, resolve } from "node:path";

/** Dangerous environment variables that cannot be changed by export or inline assignment. */
const DANGEROUS_ENV_VARS: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "SHELL",
  "USER",
  "LOGNAME"
]);

/** Regex fragment containing the dangerous environment variable names. */
const DANGEROUS_ENV_PATTERN = [...DANGEROUS_ENV_VARS].join("|");

/**
 * Validate that a shell command stays within the workspace security boundary.
 *
 * @param command Shell command to validate
 * @param workspaceRoot Absolute path to the workspace root
 * @returns `null` when the command is safe, otherwise an error message
 */
export function validateCommand(command: string, workspaceRoot: string): string | null {
  const trimmed = command.trim();

  if (trimmed === "") {
    return null;
  }

  // 0. Reject Windows absolute paths (C:\...) before tokenization because "\" is a separator.
  const windowsPathMatch = trimmed.match(/[A-Za-z]:[\\/]/);
  if (windowsPathMatch !== null) {
    return `Windows absolute paths are not allowed: ${windowsPathMatch[0]}...`;
  }

  // 1. Reject privilege escalation commands (sudo, su).
  if (/\b(sudo|su)\b/.test(trimmed)) {
    return "Privilege escalation commands (sudo, su) are not allowed.";
  }

  // 2. Reject dangerous environment variable mutation: export VAR=... or inline VAR=...
  const envMatch = trimmed.match(
    new RegExp(`\\b(?:export\\s+)?(${DANGEROUS_ENV_PATTERN})=`, "g")
  );
  if (envMatch !== null) {
    const varName = envMatch[0].match(new RegExp(`\\b(${DANGEROUS_ENV_PATTERN})=`))?.[1];
    if (varName !== undefined) {
      return `Manipulating environment variable '${varName}' is not allowed.`;
    }
  }

  // 3. Reject redirects that target paths outside the workspace (> /path, >> /path).
  const redirectMatches = trimmed.matchAll(/>>?\s*([^\s;|&>]+)/g);
  for (const match of redirectMatches) {
    const target = match[1];
    if (target !== undefined && isPathEscape(target, workspaceRoot)) {
      return `Redirect target escapes workspace: ${target}`;
    }
  }

  // 4. Reject path arguments inside command tokens when they escape the workspace.
  const tokens = tokenizeCommand(trimmed);
  for (const token of tokens) {
    if (isPathEscape(token, workspaceRoot)) {
      return `Path argument escapes workspace: ${token}`;
    }
  }

  return null;
}

/**
 * Split a command into tokens.
 *
 * This simplified tokenizer does not handle nested quotes or subshells, but it
 * is sufficient for catching common path arguments.
 */
function tokenizeCommand(command: string): string[] {
  return command
    .split(/[\s;|&<>()$`'"\\]+/)
    .filter((token) => token.length > 0);
}

/**
 * Check whether a path-like token escapes the workspace.
 *
 * Handles three cases:
 * - Windows absolute paths (`C:\...`): always treated as escaping
 * - Unix absolute paths (`/...`): checked against the workspace root
 * - Relative paths containing `..`: resolved first, then checked
 */
function isPathEscape(pathStr: string, workspaceRoot: string): boolean {
  // Unix absolute path
  if (pathStr.startsWith("/")) {
    return !isWithinWorkspace(pathStr, workspaceRoot);
  }

  // Relative path with `..` traversal, excluding meaningless matches such as foo..bar.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(pathStr)) {
    const resolved = resolve(workspaceRoot, pathStr);
    return !isWithinWorkspace(resolved, workspaceRoot);
  }

  return false;
}

/**
 * Check whether a path is within the workspace.
 *
 * This mirrors the logic in `safe-path.ts`: compute the relative path and treat
 * it as escaping if it starts with `..` or resolves to an absolute path.
 */
function isWithinWorkspace(pathStr: string, workspaceRoot: string): boolean {
  const normalizedRoot = resolve(workspaceRoot);
  const resolved = resolve(pathStr);
  const rel = relative(normalizedRoot, resolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
