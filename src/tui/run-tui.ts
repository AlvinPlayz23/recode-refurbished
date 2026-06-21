/**
 * pi-tui runtime entrypoint.
 */

import type { AiModel } from "../ai/types.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import type { ToolExecutionContext } from "../tools/tool.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import { ProcessTerminal, TUI } from "./pi-tui/index.ts";
import { TuiApp } from "./app.ts";

/** TUI runtime options. */
export interface TuiRunOptions {
  readonly systemPrompt: string;
  readonly runtimeConfig: RuntimeConfig;
  readonly languageModel: AiModel;
  readonly toolRegistry: ToolRegistry;
  readonly toolContext: ToolExecutionContext;
}

/** Launch the terminal interface for Recode. */
export async function runTui(options: TuiRunOptions): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const app = new TuiApp(tui, options);
  app.start();
  await app.waitForExit();
}
