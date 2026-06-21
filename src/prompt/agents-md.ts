/**
 * AGENTS.md loader — project-specific agent instructions.
 *
 * AGENTS.md is a standard convention (https://agents.md) for giving coding
 * agents project-specific context: build steps, conventions, forbidden
 * patterns, and anything else that would clutter a README.
 *
 * If AGENTS.md is present in the workspace root, its contents are prepended
 * to the base system prompt so the agent operates with full project context
 * from the very first turn.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD_FILENAME = "AGENTS.md";

/** Return true when `AGENTS.md` exists in the provided workspace root. */
export function hasAgentsMd(cwd: string): boolean {
  return existsSync(join(cwd, AGENTS_MD_FILENAME));
}

/**
 * Read AGENTS.md from `cwd` and return its trimmed contents, or `undefined`
 * if the file does not exist.
 */
export function loadAgentsMd(cwd: string): string | undefined {
  const agentsMdPath = join(cwd, AGENTS_MD_FILENAME);
  if (!hasAgentsMd(cwd)) {
    return undefined;
  }
  return readFileSync(agentsMdPath, "utf-8").trim();
}

/**
 * Build the effective system prompt for a session.
 *
 * If an AGENTS.md file is found in `cwd`, its contents are prepended to
 * `basePrompt` inside a clearly-labelled block so the model understands
 * where the project-specific instructions come from. The base system prompt
 * follows, separated by a blank line.
 *
 * When no AGENTS.md is present the base prompt is returned unchanged.
 */
export function buildSystemPrompt(basePrompt: string, cwd: string): string {
  const agentsMd = loadAgentsMd(cwd);
  if (agentsMd === undefined) {
    return basePrompt;
  }

  return [
    "<project-instructions>",
    "The following instructions come from the project's AGENTS.md file.",
    "They define project-specific conventions, build steps, and constraints.",
    "Follow them throughout this session.",
    "",
    agentsMd,
    "</project-instructions>",
    "",
    basePrompt
  ].join("\n");
}
