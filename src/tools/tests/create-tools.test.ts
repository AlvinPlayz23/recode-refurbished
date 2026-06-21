/**
 * Tests for default tool registry construction.
 */

import { describe, expect, it } from "bun:test";
import { createTools } from "../create-tools.ts";

describe("createTools", () => {
  it("includes web tools after local search tools", () => {
    expect(createTools().map((tool) => tool.name)).toEqual([
      "Bash",
      "AskUserQuestion",
      "TodoWrite",
      "Task",
      "Read",
      "Write",
      "Edit",
      "ApplyPatch",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch"
    ]);
  });
});
