/**
 * bubblewrap (`bwrap`) sandbox integration.
 *
 * These primitives are retained for a future sandbox redesign. The active Bash
 * execution policy currently bypasses bwrap because it can hang on some hosts.
 *
 * @author dev
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Child process spawn options.
 */
interface SpawnOptions {
  readonly stdout: "pipe";
  readonly stderr: "pipe";
  readonly stdin: "ignore";
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly killSignal?: NodeJS.Signals;
}

/** Cached `bwrap` availability: `undefined` = unchecked, `true`/`false` = checked. */
let bwrapAvailable: boolean | undefined;

/** Minimal set of environment variable names forwarded into the sandbox. */
const MINIMAL_ENV_KEYS = ["HOME", "PATH", "TMPDIR", "LANG", "TERM"] as const;

/** System directories mounted read-only inside the sandbox. */
const READONLY_BIND_DIRS = ["/usr", "/bin", "/lib", "/lib64", "/etc"] as const;

/**
 * Check whether `bwrap` is available.
 *
 * The result is cached and checked at most once per process.
 */
export async function isBubblewrapAvailable(): Promise<boolean> {
  if (bwrapAvailable !== undefined) {
    return bwrapAvailable;
  }

  try {
    const proc = Bun.spawn({
      cmd: ["bwrap", "--version"],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    });
    const exitCode = await proc.exited;
    bwrapAvailable = exitCode === 0;
    return bwrapAvailable;
  } catch (_error: unknown) {
    bwrapAvailable = false;
    return false;
  }
}

/**
 * Spawn a child process directly without sandboxing.
 */
export function spawnDirect(
  command: string,
  workspaceRoot: string,
  options: SpawnOptions
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn({
    cmd: getShellCommand(command),
    cwd: workspaceRoot,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.killSignal === undefined ? {} : { killSignal: options.killSignal }),
    windowsHide: true
  });
}

/**
 * Spawn a child process inside a `bwrap` sandbox.
 *
 * Sandbox policy:
 * - `--unshare-all` isolates all namespaces
 * - system directories (`/usr`, `/bin`, `/lib`, `/lib64`, `/etc`) are mounted read-only
 * - the workspace is mounted read-write
 * - `/tmp` uses sandbox-local tmpfs
 * - `/proc` and `/dev` are mounted for common command support
 * - only a minimal environment plus `RECODE_*` variables is forwarded
 */
export function spawnSandboxed(
  command: string,
  workspaceRoot: string,
  options: SpawnOptions
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  const args = buildBwrapArgs(command, workspaceRoot);
  return Bun.spawn({
    cmd: args,
    cwd: workspaceRoot,
    stdin: options.stdin,
    stdout: options.stdout,
    stderr: options.stderr,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.killSignal === undefined ? {} : { killSignal: options.killSignal }),
    windowsHide: true
  });
}

/**
 * Build the `bwrap` command argument list.
 */
function buildBwrapArgs(command: string, workspaceRoot: string): string[] {
  const args: string[] = [
    "bwrap",
    "--unshare-all",
    "--new-session",
    "--die-with-parent",
    "--clearenv",
    "--proc",
    "/proc",
    "--dev",
    "/dev"
  ];

  for (const dir of READONLY_BIND_DIRS) {
    if (existsSync(dir)) {
      args.push("--ro-bind", dir, dir);
    }
  }

  args.push("--tmpfs", "/tmp");
  args.push("--bind", workspaceRoot, workspaceRoot);

  const envVars = collectMinimalEnv();
  for (const [key, value] of Object.entries(envVars)) {
    args.push("--setenv", key, value);
  }

  args.push(...getShellCommand(command));
  return args;
}

/**
 * Collect the minimal environment variable set passed into the sandbox.
 */
function collectMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of MINIMAL_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("RECODE_") && value !== undefined && value !== "") {
      env[key] = value;
    }
  }

  return env;
}

function getShellCommand(command: string): string[] {
  if (process.platform === "win32") {
    const bash = resolveWindowsBashExecutable();
    if (bash !== undefined) {
      return [bash, "-lc", command];
    }

    return [
      resolveWindowsPowerShellExecutable(),
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command
    ];
  }

  return ["zsh", "-lc", command];
}

function resolveWindowsBashExecutable(): string | undefined {
  const programFiles = [
    process.env["ProgramFiles"],
    process.env["ProgramFiles(x86)"],
    process.env["LocalAppData"] === undefined
      ? undefined
      : join(process.env["LocalAppData"], "Programs")
  ].filter((item) => item !== undefined);

  for (const root of programFiles) {
    const candidates = [
      join(root, "Git", "bin", "bash.exe"),
      join(root, "Git", "usr", "bin", "bash.exe")
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return findExecutableOnPath("bash.exe", isGitBashPath);
}

function resolveWindowsPowerShellExecutable(): string {
  const pwshFromPath = findExecutableOnPath("pwsh.exe");
  if (pwshFromPath !== undefined) {
    return pwshFromPath;
  }

  const programFiles = process.env["ProgramFiles"];
  const commonPwshPath = programFiles === undefined
    ? undefined
    : join(programFiles, "PowerShell", "7", "pwsh.exe");
  if (commonPwshPath !== undefined && existsSync(commonPwshPath)) {
    return commonPwshPath;
  }

  return "powershell.exe";
}

function findExecutableOnPath(
  executableName: string,
  predicate: (candidate: string) => boolean = () => true
): string | undefined {
  const pathValue = process.env["PATH"] ?? process.env["Path"];
  if (pathValue === undefined) {
    return undefined;
  }

  for (const directory of pathValue.split(delimiter)) {
    if (directory.trim() === "") {
      continue;
    }

    const candidate = join(directory, executableName);
    if (existsSync(candidate) && predicate(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isGitBashPath(candidate: string): boolean {
  return candidate.toLowerCase().includes(`${delimiter === ";" ? "\\" : "/"}git${delimiter === ";" ? "\\" : "/"}`);
}

export type { SpawnOptions };
