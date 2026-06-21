/**
 * TUI message formatting helpers.
 *
 * @author dev
 */

/**
 * Built-in TUI command names.
 */
export type BuiltinCommandName =
  "help" | "clear" | "status" | "memory" | "config" | "models" | "provider" | "theme" | "customize" | "settings" | "todos" | "context-window" | "approval-mode" | "export" | "export-md" | "history" | "new" | "init" | "fork" | "compact" | "plan" | "build" | "layout" | "minimal" | "exit" | "quit";

/**
 * Built-in TUI command definition.
 */
export interface BuiltinCommandDefinition {
  readonly name: BuiltinCommandName;
  readonly command: `/${BuiltinCommandName}`;
  readonly description: string;
}

/**
 * Parsed built-in command.
 */
export interface ParsedBuiltinCommand {
  readonly name: BuiltinCommandName;
  readonly raw: string;
}

const BUILTIN_COMMANDS: readonly BuiltinCommandDefinition[] = [
  { name: "help", command: "/help", description: "Show built-in command help" },
  { name: "clear", command: "/clear", description: "Clear the current session" },
  { name: "status", command: "/status", description: "Show the current session status" },
  { name: "memory", command: "/memory", description: "Show in-memory session diagnostics" },
  { name: "config", command: "/config", description: "Show the current Recode configuration" },
  { name: "models", command: "/models", description: "Open the model selector" },
  { name: "provider", command: "/provider", description: "Select, enable, or disable providers" },
  { name: "theme", command: "/theme", description: "Open the theme selector" },
  { name: "customize", command: "/customize", description: "Customize theme, tool marker, and settings" },
  { name: "settings", command: "/settings", description: "Open the settings popup" },
  { name: "todos", command: "/todos", description: "Toggle the composer todo panel" },
  { name: "context-window", command: "/context-window", description: "Set the active model context window" },
  { name: "approval-mode", command: "/approval-mode", description: "Open the approval mode selector" },
  { name: "export", command: "/export", description: "Export the current conversation to HTML" },
  { name: "export-md", command: "/export-md", description: "Export the current conversation to Markdown" },
  { name: "history", command: "/history", description: "Open the conversation history" },
  { name: "new", command: "/new", description: "Start a new conversation" },
  { name: "init", command: "/init", description: "Create an AGENTS.md file with instructions for Recode" },
  { name: "fork", command: "/fork", description: "Fork the current conversation into a new session" },
  { name: "compact", command: "/compact", description: "Compact older conversation history into a continuation summary" },
  { name: "plan", command: "/plan", description: "Switch to read-only planning mode" },
  { name: "build", command: "/build", description: "Switch to normal implementation mode" },
  { name: "layout", command: "/layout", description: "Switch between compact and comfortable layout" },
  { name: "minimal", command: "/minimal", description: "Toggle minimal mode (hide header)" },
  { name: "exit", command: "/exit", description: "Exit Recode" },
  { name: "quit", command: "/quit", description: "Exit Recode" }
] as const;

const BUILTIN_COMMAND_ALIASES: Readonly<Record<string, BuiltinCommandName>> = {
  "/help": "help",
  "/clear": "clear",
  "/status": "status",
  "/memory": "memory",
  "/config": "config",
  "/models": "models",
  "/provider": "provider",
  "/theme": "theme",
  "/customize": "customize",
  "/settings": "settings",
  "/todos": "todos",
  "/context-window": "context-window",
  "/approval-mode": "approval-mode",
  "/export": "export",
  "/export-md": "export-md",
  "/history": "history",
  "/new": "new",
  "/init": "init",
  "/fork": "fork",
  "/compact": "compact",
  "/plan": "plan",
  "/build": "build",
  "/layout": "layout",
  "/minimal": "minimal",
  "/exit": "exit",
  "/quit": "quit"
};

/**
 * Return all built-in command definitions.
 */
export function getBuiltinCommands(): readonly BuiltinCommandDefinition[] {
  return BUILTIN_COMMANDS;
}

/**
 * Parse a built-in command from input.
 */
export function parseBuiltinCommand(value: string): ParsedBuiltinCommand | undefined {
  const prompt = value.trim().toLowerCase();
  const name = BUILTIN_COMMAND_ALIASES[prompt];

  if (name === undefined) {
    return undefined;
  }

  return {
    name,
    raw: prompt
  };
}

/**
 * Return matching built-in commands for an input prefix.
 */
export function findBuiltinCommands(value: string): readonly BuiltinCommandDefinition[] {
  const prompt = value.trim().toLowerCase();

  if (!prompt.startsWith("/")) {
    return [];
  }

  if (prompt === "/") {
    return BUILTIN_COMMANDS;
  }

  return BUILTIN_COMMANDS.filter((command) => command.command.startsWith(prompt));
}

/**
 * Clamp the selected command index into a valid range.
 */
export function normalizeBuiltinCommandSelectionIndex(index: number, commandCount: number): number {
  if (!Number.isFinite(index) || commandCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(Math.trunc(index), commandCount - 1));
}

/**
 * Move the selected command index cyclically by direction.
 */
export function moveBuiltinCommandSelectionIndex(
  currentIndex: number,
  commandCount: number,
  direction: -1 | 1
): number {
  if (commandCount <= 0) {
    return 0;
  }

  const normalizedIndex = normalizeBuiltinCommandSelectionIndex(currentIndex, commandCount);
  return (normalizedIndex + direction + commandCount) % commandCount;
}

/**
 * Check whether an input is an exit command.
 */
export function isExitCommand(value: string): boolean {
  const command = parseBuiltinCommand(value);
  return command?.name === "exit" || command?.name === "quit";
}

/**
 * Split message text into display lines.
 */
export function toDisplayLines(content: string): readonly string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Indent a multi-line body except for the first line.
 */
export function indentBody(lines: readonly string[], prefix: string): readonly string[] {
  if (lines.length === 0) {
    return lines;
  }

  const first = lines[0] ?? "";
  return [first, ...lines.slice(1).map((line) => `${prefix}${line}`)];
}

/**
 * Horizontal divider line.
 */
export function horizontalRule(width: number, char: string = "─"): string {
  return char.repeat(Math.max(1, width));
}

/**
 * Build a horizontal divider with a centered title.
 */
export function titledRule(
  width: number,
  title: string,
  char: string = "─"
): string {
  const safeWidth = Math.max(1, width);
  const normalizedTitle = title.trim();

  if (normalizedTitle === "" || safeWidth <= normalizedTitle.length + 2) {
    return horizontalRule(safeWidth, char);
  }

  const decoratedTitle = ` ${normalizedTitle} `;
  const sideWidth = Math.max(0, safeWidth - decoratedTitle.length);
  const leftWidth = Math.floor(sideWidth / 2);
  const rightWidth = sideWidth - leftWidth;

  return `${char.repeat(leftWidth)}${decoratedTitle}${char.repeat(rightWidth)}`;
}
