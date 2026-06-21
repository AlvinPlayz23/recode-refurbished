/**
 * CLI workspace resolution helpers.
 */

import { isAbsolute, resolve } from "node:path";

/**
 * Resolved startup workspace plus the remaining prompt/command arguments.
 */
export interface CliWorkspaceResolution {
  readonly workspaceRoot: string;
  readonly argv: readonly string[];
}

/**
 * Resolve the workspace root for this CLI invocation.
 */
export function resolveCliWorkspace(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  currentCwd: string
): CliWorkspaceResolution {
  const explicitWorkspace = extractWorkspaceOption(argv);
  const callerRoot = resolve(
    readOptionalEnv(env, "INIT_CWD")
    ?? readOptionalEnv(env, "PWD")
    ?? currentCwd
  );
  const workspaceInput = explicitWorkspace.workspacePath
    ?? readOptionalEnv(env, "RECODE_WORKSPACE_ROOT")
    ?? readOptionalEnv(env, "INIT_CWD")
    ?? readOptionalEnv(env, "PWD")
    ?? currentCwd;

  return {
    workspaceRoot: resolveWorkspacePath(workspaceInput, callerRoot),
    argv: explicitWorkspace.argv
  };
}

interface WorkspaceOptionExtraction {
  readonly workspacePath?: string;
  readonly argv: readonly string[];
}

function extractWorkspaceOption(argv: readonly string[]): WorkspaceOptionExtraction {
  let workspacePath: string | undefined;
  const nextArgv: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--workspace" || token === "--cwd") {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error(`Missing value for ${token}.`);
      }

      const trimmedValue = nextValue.trim();
      if (trimmedValue === "") {
        throw new Error(`Missing value for ${token}.`);
      }

      workspacePath = trimmedValue;
      index += 1;
      continue;
    }

    const inlineMatch = token.match(/^--(?:workspace|cwd)=(.+)$/u);
    if (inlineMatch !== null) {
      const inlineValue = inlineMatch[1]?.trim();
      if (inlineValue === undefined || inlineValue === "") {
        throw new Error(`Missing value for ${token.split("=")[0]}.`);
      }

      workspacePath = inlineValue;
      continue;
    }

    nextArgv.push(token);
  }

  return {
    ...(workspacePath === undefined ? {} : { workspacePath }),
    argv: nextArgv
  };
}

function resolveWorkspacePath(pathValue: string, callerRoot: string): string {
  return isAbsolute(pathValue)
    ? resolve(pathValue)
    : resolve(callerRoot, pathValue);
}

function readOptionalEnv(
  env: Record<string, string | undefined>,
  key: string
): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}
