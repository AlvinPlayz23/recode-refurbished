/**
 * Starts the Vite renderer and Electrobun host together for local development.
 */

const rendererUrl = "http://127.0.0.1:5173";

export {};

function spawnManaged(command: string[], cwd = process.cwd()): Bun.Subprocess {
  return Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: {
      ...process.env,
      BROWSER: "none",
    },
  });
}

async function waitForRenderer(): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl);

      if (response.ok) {
        return;
      }
    } catch {
      await Bun.sleep(250);
    }
  }

  throw new Error(`Renderer did not become available at ${rendererUrl}`);
}

const renderer = spawnManaged(["bun", "run", "dev", "--", "--host", "127.0.0.1"], "web");

try {
  await waitForRenderer();

  const host = Bun.spawn(["bun", "run", "electrobun:dev"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: {
      ...process.env,
      RECODE_DESKTOP_DEV_URL: rendererUrl,
    },
  });

  const stop = (): void => {
    host.kill();
    renderer.kill();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const exitCode = await host.exited;
  renderer.kill();
  process.exit(exitCode);
} catch (error) {
  renderer.kill();
  throw error;
}
