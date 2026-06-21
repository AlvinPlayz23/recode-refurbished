/**
 * TUI message formatting tests.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import {
  findBuiltinCommands,
  getBuiltinCommands,
  isExitCommand,
  moveBuiltinCommandSelectionIndex,
  normalizeBuiltinCommandSelectionIndex,
  parseBuiltinCommand,
  titledRule,
  toDisplayLines
} from "./message-format.ts";

describe("tui message format", () => {
  it("recognizes exit commands", () => {
    expect(isExitCommand("/exit")).toBe(true);
    expect(isExitCommand(" /quit ")).toBe(true);
    expect(isExitCommand("hello")).toBe(false);
  });

  it("parses builtin commands", () => {
    expect(parseBuiltinCommand(" /help ")).toEqual({ name: "help", raw: "/help" });
    expect(parseBuiltinCommand("/status")).toEqual({ name: "status", raw: "/status" });
    expect(parseBuiltinCommand("/memory")).toEqual({ name: "memory", raw: "/memory" });
    expect(parseBuiltinCommand("/config")).toEqual({ name: "config", raw: "/config" });
    expect(parseBuiltinCommand("/models")).toEqual({ name: "models", raw: "/models" });
    expect(parseBuiltinCommand("/provider")).toEqual({ name: "provider", raw: "/provider" });
    expect(parseBuiltinCommand("/theme")).toEqual({ name: "theme", raw: "/theme" });
    expect(parseBuiltinCommand("/customize")).toEqual({ name: "customize", raw: "/customize" });
    expect(parseBuiltinCommand("/settings")).toEqual({ name: "settings", raw: "/settings" });
    expect(parseBuiltinCommand("/todos")).toEqual({ name: "todos", raw: "/todos" });
    expect(parseBuiltinCommand("/context-window")).toEqual({ name: "context-window", raw: "/context-window" });
    expect(parseBuiltinCommand("/approval-mode")).toEqual({ name: "approval-mode", raw: "/approval-mode" });
    expect(parseBuiltinCommand("/export")).toEqual({ name: "export", raw: "/export" });
    expect(parseBuiltinCommand("/history")).toEqual({ name: "history", raw: "/history" });
    expect(parseBuiltinCommand("/new")).toEqual({ name: "new", raw: "/new" });
    expect(parseBuiltinCommand("/init")).toEqual({ name: "init", raw: "/init" });
    expect(parseBuiltinCommand("/fork")).toEqual({ name: "fork", raw: "/fork" });
    expect(parseBuiltinCommand("/compact")).toEqual({ name: "compact", raw: "/compact" });
    expect(parseBuiltinCommand("/plan")).toEqual({ name: "plan", raw: "/plan" });
    expect(parseBuiltinCommand("/build")).toEqual({ name: "build", raw: "/build" });
    expect(parseBuiltinCommand("/layout")).toEqual({ name: "layout", raw: "/layout" });
    expect(parseBuiltinCommand("/minimal")).toEqual({ name: "minimal", raw: "/minimal" });
    expect(parseBuiltinCommand("hello")).toBeUndefined();
  });

  it("lists builtin commands", () => {
    expect(getBuiltinCommands()).toEqual([
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
    ]);
  });

  it("finds builtin command suggestions by prefix", () => {
    expect(findBuiltinCommands("/").map((command) => command.command)).toEqual([
      "/help",
      "/clear",
      "/status",
      "/memory",
      "/config",
      "/models",
      "/provider",
      "/theme",
      "/customize",
      "/settings",
      "/todos",
      "/context-window",
      "/approval-mode",
      "/export",
      "/export-md",
      "/history",
      "/new",
      "/init",
      "/fork",
      "/compact",
      "/plan",
      "/build",
      "/layout",
      "/minimal",
      "/exit",
      "/quit"
    ]);
    expect(findBuiltinCommands("/st")).toEqual([
      { name: "status", command: "/status", description: "Show the current session status" }
    ]);
    expect(findBuiltinCommands("/se")).toEqual([
      { name: "settings", command: "/settings", description: "Open the settings popup" }
    ]);
    expect(findBuiltinCommands("hello")).toEqual([]);
  });

  it("normalizes command selection index", () => {
    expect(normalizeBuiltinCommandSelectionIndex(-1, 5)).toBe(0);
    expect(normalizeBuiltinCommandSelectionIndex(99, 3)).toBe(2);
    expect(normalizeBuiltinCommandSelectionIndex(1, 3)).toBe(1);
    expect(normalizeBuiltinCommandSelectionIndex(1, 0)).toBe(0);
  });

  it("moves command selection index cyclically", () => {
    expect(moveBuiltinCommandSelectionIndex(0, 3, -1)).toBe(2);
    expect(moveBuiltinCommandSelectionIndex(2, 3, 1)).toBe(0);
    expect(moveBuiltinCommandSelectionIndex(1, 3, 1)).toBe(2);
    expect(moveBuiltinCommandSelectionIndex(0, 0, 1)).toBe(0);
  });

  it("splits content into display lines", () => {
    expect(toDisplayLines("a\nb")).toEqual(["a", "b"]);
    expect(toDisplayLines("a\r\nb")).toEqual(["a", "b"]);
  });

  it("creates a titled divider rule", () => {
    const rule = titledRule(20, "chat");

    expect(rule).toContain(" chat ");
    expect(rule.length).toBe(20);
  });
});
