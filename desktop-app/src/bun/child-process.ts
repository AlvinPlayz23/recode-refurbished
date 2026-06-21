/**
 * Helpers for launching Recode-managed child processes from the desktop host.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface RecodeAcpProcessOptions {
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  runtimeMode?: "dev" | "prod";
  recodeRepoRoot?: string;
}

/**
 * Returns true when the Bun runtime exposes process spawning for the host app.
 */
export function canSpawnChildProcesses(): boolean {
  return typeof Bun.spawn === "function";
}

/**
 * Starts a Recode ACP server process using stdio transport.
 */
export function spawnRecodeAcpServer(options: RecodeAcpProcessOptions = {}): Bun.Subprocess {
  const commandParts = resolveRecodeAcpCommand(options);

  return Bun.spawn(commandParts, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function resolveRecodeAcpCommand(options: RecodeAcpProcessOptions): string[] {
  if (options.command !== undefined) {
    return [options.command, ...(options.args ?? ["acp-server", "--stdio"])];
  }

  const envCommand = process.env.RECODE_ACP_COMMAND;
  if (envCommand !== undefined && envCommand.trim() !== "") {
    return [
      envCommand,
      ...splitCommandArgs(process.env.RECODE_ACP_ARGS ?? "acp-server --stdio"),
    ];
  }

  if (options.runtimeMode === "dev") {
    // Dev mode intentionally runs the local repo command from the detected clone.
    // Future packaged releases should default to prod and rely on `recode`.
    const repoRoot = options.recodeRepoRoot ?? findRecodeRepoRoot();
    if (repoRoot !== undefined) {
      return [
        process.execPath,
        `--config=${join(repoRoot, "desktop-app", "bunfig.acp.toml")}`,
        "run",
        join(repoRoot, "src", "index.ts"),
        "acp-server",
        "--stdio",
      ];
    }
    throw new Error("Recode repo root is not configured. Set it in Settings > General.");
  }

  if (options.runtimeMode === "prod") {
    return ["recode", "acp-server", "--stdio"];
  }

  const localCliEntry = findLocalRecodeCliEntry();
  if (existsSync(localCliEntry)) {
    return [process.execPath, localCliEntry, "acp-server", "--stdio"];
  }

  return ["recode", "acp-server", "--stdio"];
}

function findLocalRecodeCliEntry(): string {
  const repoRoot = findRecodeRepoRoot();
  if (repoRoot !== undefined) {
    return join(repoRoot, "src", "index.ts");
  }

  return join(process.cwd(), "..", "src", "index.ts");
}

export function findRecodeRepoRoot(): string | undefined {
  const candidates = [
    process.cwd(),
    import.meta.dir,
    dirname(process.execPath),
  ];

  for (const start of candidates) {
    const found = findRecodePackageUpward(start);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function findRecodePackageUpward(start: string): string | undefined {
  let current = resolve(start);

  for (let depth = 0; depth < 10; depth += 1) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
        if (
          isRecord(packageJson)
          && packageJson.name === "recode"
          && existsSync(join(current, "src", "index.ts"))
        ) {
          return current;
        }
      } catch {
        // Keep walking upward; a malformed unrelated package should not stop detection.
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

function findUpward(start: string, relativePath: string): string | undefined {
  let current = resolve(start);

  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

function splitCommandArgs(value: string): string[] {
  return value.split(" ").map((part) => part.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
