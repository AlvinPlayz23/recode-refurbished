/**
 * Tests for CLI workspace resolution.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveCliWorkspace } from "./workspace.ts";

describe("resolveCliWorkspace", () => {
  test("prefers explicit --workspace and strips it from argv", () => {
    const result = resolveCliWorkspace(
      ["--workspace", "../demo", "ship", "it"],
      {
        INIT_CWD: "/Users/dev/launcher",
        RECODE_WORKSPACE_ROOT: "/Users/dev/env-workspace"
      },
      "/Users/dev/re-code"
    );

    expect(result).toEqual({
      workspaceRoot: resolve("/Users/dev/demo"),
      argv: ["ship", "it"]
    });
  });

  test("accepts inline --cwd syntax", () => {
    const result = resolveCliWorkspace(
      ["--cwd=examples/app", "setup"],
      {
        INIT_CWD: "/Users/dev/projects"
      },
      "/Users/dev/re-code"
    );

    expect(result).toEqual({
      workspaceRoot: resolve("/Users/dev/projects/examples/app"),
      argv: ["setup"]
    });
  });

  test("falls back to RECODE_WORKSPACE_ROOT before launcher env", () => {
    const result = resolveCliWorkspace(
      [],
      {
        RECODE_WORKSPACE_ROOT: "sandbox/app",
        INIT_CWD: "/Users/dev/launcher"
      },
      "/Users/dev/re-code"
    );

    expect(result.workspaceRoot).toBe(resolve("/Users/dev/launcher/sandbox/app"));
  });

  test("falls back to INIT_CWD before PWD", () => {
    const result = resolveCliWorkspace(
      [],
      {
        INIT_CWD: "/Users/dev/original",
        PWD: "/Users/dev/pwd"
      },
      "/Users/dev/re-code"
    );

    expect(result.workspaceRoot).toBe(resolve("/Users/dev/original"));
  });

  test("falls back to current cwd when no overrides exist", () => {
    const result = resolveCliWorkspace([], {}, "/Users/dev/re-code");
    expect(result.workspaceRoot).toBe(resolve("/Users/dev/re-code"));
    expect(result.argv).toEqual([]);
  });

  test("throws for missing workspace option values", () => {
    expect(() => resolveCliWorkspace(["--workspace"], {}, "/Users/dev/re-code")).toThrow(
      "Missing value for --workspace."
    );
  });
});
