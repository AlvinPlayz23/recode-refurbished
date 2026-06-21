/**
 * Prompt used by the `/init` command to generate AGENTS.md.
 */

/** Prompt text for the `/init` AGENTS.md generator. */
export const INIT_COMMAND_PROMPT: string = await Bun.file(
  new URL("./prompt_for_init_command.md", import.meta.url)
).text()