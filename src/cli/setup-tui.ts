/**
 * pi-tui setup entrypoint.
 *
 * The provider setup questions are still handled by the readline flow in
 * `setup.ts`; this module exists so the CLI no longer imports the old TSX
 * OpenTUI wizard.
 */

import { resolveConfigPath, loadRecodeConfigFile } from "../config/recode-config.ts";

/** Result returned by the setup TUI. */
export interface SetupTuiOutcome {
  readonly configPath: string;
  readonly savedCount: number;
}

/** Return the current setup state without launching the removed OpenTUI wizard. */
export async function runSetupTui(workspaceRoot: string): Promise<SetupTuiOutcome> {
  const configPath = resolveConfigPath(workspaceRoot, Bun.env.RECODE_CONFIG_PATH?.trim());
  const config = loadRecodeConfigFile(configPath);
  return {
    configPath,
    savedCount: config.providers.length
  };
}
