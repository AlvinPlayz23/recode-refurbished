/**
 * OpenCode-style permission rule helpers.
 */

import type {
  PermissionAction,
  PermissionRule,
  ToolArguments,
  ToolApprovalScope
} from "./tool.ts";

/** Config object accepted for persistent permission rules. */
export type PermissionConfig = PermissionAction | Readonly<Record<string, PermissionAction | Readonly<Record<string, PermissionAction>>>>;

/** Result of evaluating one permission request. */
export interface PermissionEvaluation {
  readonly permission: string;
  readonly pattern: string;
  readonly action: PermissionAction;
}

/**
 * Expand config-shaped permission rules into an ordered ruleset.
 */
export function permissionRulesFromConfig(config: PermissionConfig | undefined): readonly PermissionRule[] {
  if (config === undefined) {
    return [];
  }

  if (typeof config === "string") {
    return [{ permission: "*", pattern: "*", action: config }];
  }

  const rules: PermissionRule[] = [];
  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === "string") {
      rules.push({ permission, pattern: "*", action: value });
      continue;
    }

    for (const [pattern, action] of Object.entries(value)) {
      rules.push({ permission, pattern: expandHomePattern(pattern), action });
    }
  }

  return rules;
}

/**
 * Evaluate a permission key and target pattern. The last matching rule wins.
 */
export function evaluatePermissionRules(
  permission: string,
  pattern: string,
  rules: readonly PermissionRule[]
): PermissionEvaluation {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (rule === undefined) {
      continue;
    }

    if (wildcardMatch(permission, rule.permission) && wildcardMatch(pattern, rule.pattern)) {
      return {
        permission,
        pattern,
        action: rule.action
      };
    }
  }

  return {
    permission,
    pattern,
    action: "ask"
  };
}

/**
 * Build a persistent allow rule for a user-approved request.
 */
export function createPermissionRule(
  permission: string,
  pattern: string,
  action: PermissionAction
): PermissionRule {
  return {
    permission,
    pattern: pattern.trim() === "" ? "*" : pattern,
    action
  };
}

/**
 * Infer the permission key used for a tool call.
 */
export function getToolPermissionKey(toolName: string, scope: ToolApprovalScope): string {
  switch (toolName) {
    case "Write":
    case "Edit":
    case "ApplyPatch":
      return "edit";
    case "Read":
      return "read";
    case "Glob":
      return "glob";
    case "Grep":
      return "grep";
    case "WebFetch":
      return "webfetch";
    case "WebSearch":
      return "websearch";
    case "Bash":
      return "bash";
    default:
      return scope;
  }
}

/**
 * Infer the rule target pattern for a tool call.
 */
export function getToolPermissionPattern(toolName: string, arguments_: ToolArguments): string {
  switch (toolName) {
    case "Bash":
      return readStringArgument(arguments_, "command") ?? "*";
    case "Read":
    case "Write":
    case "Edit":
      return readStringArgument(arguments_, "path") ?? "*";
    case "ApplyPatch":
      return summarizePatchTargets(readStringArgument(arguments_, "patch") ?? readStringArgument(arguments_, "patchText"));
    case "Glob":
      return readStringArgument(arguments_, "pattern") ?? readStringArgument(arguments_, "path") ?? "*";
    case "Grep":
      return readStringArgument(arguments_, "path") ?? readStringArgument(arguments_, "pattern") ?? "*";
    case "WebFetch":
      return readStringArgument(arguments_, "url") ?? "*";
    case "WebSearch":
      return readStringArgument(arguments_, "query") ?? "*";
    default:
      return "*";
  }
}

function readStringArgument(arguments_: ToolArguments, key: string): string | undefined {
  const value = arguments_[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function summarizePatchTargets(patch: string | undefined): string {
  if (patch === undefined) {
    return "*";
  }

  const targets = patch
    .split(/\r?\n/u)
    .map((line) => line.match(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/u)?.[1]?.trim())
    .filter((value): value is string => value !== undefined && value !== "");

  return targets.length === 0 ? "*" : targets.join(",");
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const source = `^${Array.from(pattern).map((character) => {
    if (character === "*") {
      return ".*";
    }

    if (character === "?") {
      return ".";
    }

    return character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }).join("")}$`;
  return new RegExp(source, "u").test(value);
}

function expandHomePattern(pattern: string): string {
  if (pattern === "~") {
    return Bun.env.HOME ?? Bun.env.USERPROFILE ?? pattern;
  }

  if (pattern.startsWith("~/") || pattern.startsWith("~\\")) {
    const home = Bun.env.HOME ?? Bun.env.USERPROFILE;
    return home === undefined ? pattern : `${home}${pattern.slice(1)}`;
  }

  return pattern;
}
