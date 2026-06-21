/**
 * Embeds a per-monitor DPI-aware manifest into Windows Electrobun executables.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const targetOs = process.env.ELECTROBUN_OS;

if (targetOs !== "win") {
  console.log(`Skipping DPI manifest patch for ${targetOs ?? "unknown"} target.`);
  process.exit(0);
}

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;

if (!buildDir || !appName) {
  throw new Error("Missing ELECTROBUN_BUILD_DIR or ELECTROBUN_APP_NAME.");
}

const require = createRequire(import.meta.url);
const rceditPackagePath = require.resolve("rcedit/package.json");
const rceditDir = dirname(rceditPackagePath);
const rceditExe = join(rceditDir, "bin", process.arch === "x64" ? "rcedit-x64.exe" : "rcedit.exe");
const manifestPath = join(process.cwd(), "assets", "windows-dpi-aware.manifest");
const appBinDir = join(buildDir, appName, "bin");
const executablePaths = [
  join(appBinDir, "launcher.exe"),
  join(appBinDir, "bun.exe"),
];

if (!existsSync(manifestPath)) {
  throw new Error(`DPI manifest not found: ${manifestPath}`);
}

for (const executablePath of executablePaths) {
  if (!existsSync(executablePath)) {
    console.log(`Skipping missing executable: ${executablePath}`);
    continue;
  }

  const result = Bun.spawnSync([
    rceditExe,
    executablePath,
    "--application-manifest",
    manifestPath,
  ]);

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`Failed to patch DPI manifest for ${executablePath}: ${stderr}`);
  }

  console.log(`Patched Windows DPI manifest: ${executablePath}`);
}
