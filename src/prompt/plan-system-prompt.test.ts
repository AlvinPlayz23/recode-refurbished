/**
 * Tests for the plan mode system prompt.
 */

import { describe, expect, it } from "bun:test";

const PLAN_SYSTEM_PROMPT_SOURCE = await Bun.file(new URL("./plan-system-prompt.md", import.meta.url)).text();

describe("plan system prompt", () => {
  it("keeps direct build requests in planning mode", () => {
    expect(PLAN_SYSTEM_PROMPT_SOURCE).toContain("treat that as a request to plan that work");
    expect(PLAN_SYSTEM_PROMPT_SOURCE).toContain("Do not begin the implementation");
  });

  it("names unavailable implementation tools in plan mode", () => {
    expect(PLAN_SYSTEM_PROMPT_SOURCE).toContain("do not call Bash, Write, Edit, ApplyPatch, Task");
    expect(PLAN_SYSTEM_PROMPT_SOURCE).toContain("Unknown tool");
    expect(PLAN_SYSTEM_PROMPT_SOURCE).toContain("<plan>");
  });
});
