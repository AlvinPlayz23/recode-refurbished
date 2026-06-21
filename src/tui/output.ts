/**
 * TUI output formatting helpers.
 *
 * @author dev
 */

import type { ProviderKind } from "../providers/provider-kind.ts";

const ANSI_RESET = "\u001B[0m";
const ANSI_CYAN = "\u001B[36m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_RED = "\u001B[31m";
const ANSI_GRAY = "\u001B[90m";

/**
 * Return the TUI welcome banner.
 */
export function formatBanner(provider: ProviderKind, model: string): string {
  return [
    `${ANSI_CYAN}Recode — draw the blade, cut through the code.${ANSI_RESET}`,
    `${ANSI_GRAY}Provider: ${provider} | Model: ${model}${ANSI_RESET}`,
    `${ANSI_GRAY}Use /help for commands, /exit or /quit to leave Recode.${ANSI_RESET}`
  ].join("\n");
}

/**
 * Format an assistant reply.
 */
export function formatAssistantReply(content: string): string {
  return `${ANSI_CYAN}[Recode]${ANSI_RESET} ${content}`;
}

/**
 * Format a tool call hint.
 */
export function formatToolCall(name: string): string {
  return `${ANSI_GRAY}→ ${name}${ANSI_RESET}`;
}

/**
 * Format error output.
 */
export function formatError(content: string): string {
  return `${ANSI_RED}[error]${ANSI_RESET} ${content}`;
}

/**
 * Format the completion line.
 */
export function formatCompletion(iterations: number): string {
  return `${ANSI_GREEN}✓ done${ANSI_RESET} (${iterations} iterations)`;
}
