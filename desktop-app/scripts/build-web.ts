/**
 * Builds the Vite renderer from the desktop app root.
 */

const build = Bun.spawn(["bun", "run", "build"], {
  cwd: "web",
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const exitCode = await build.exited;
process.exit(exitCode);

export {};
