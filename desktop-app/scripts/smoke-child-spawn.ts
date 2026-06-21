/**
 * Smoke check that the Bun host process can spawn child processes.
 */

import { canSpawnChildProcesses } from "../src/bun/child-process.ts";

if (!canSpawnChildProcesses()) {
  throw new Error("Bun.spawn is not available in this runtime.");
}

const child = Bun.spawn([process.execPath, "--version"], {
  stdout: "pipe",
  stderr: "pipe",
});

const [exitCode, stdout, stderr] = await Promise.all([
  child.exited,
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
]);

if (exitCode !== 0) {
  throw new Error(`Child process exited with ${exitCode}: ${stderr}`);
}

console.log(`child-spawn-ok ${stdout.trim()}`);
