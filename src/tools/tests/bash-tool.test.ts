/**
 * Tests for the Bash tool execution wrapper.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashTool } from "../bash-tool.ts";

describe("Bash tool", () => {
  it("bounds captured output from verbose commands", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-bash-output-"));
    const tool = createBashTool();

    try {
      const result = await tool.execute(
        { command: "bun -e \"process.stdout.write('x'.repeat(50000))\"" },
        {
          workspaceRoot,
          approvalMode: "yolo"
        }
      );

      expect(result.isError).toBe(false);
      expect(result.content.length).toBeLessThanOrEqual(12_020);
      expect(result.content).toContain("[truncated]");
      expect(result.metadata?.kind).toBe("bash-output");
      if (result.metadata?.kind === "bash-output") {
        expect(result.metadata.output.length).toBeLessThanOrEqual(12_020);
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns immediately when the request is already aborted", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-bash-abort-"));
    const abortController = new AbortController();
    const tool = createBashTool();
    abortController.abort();

    try {
      const result = await tool.execute(
        { command: "echo should-not-run" },
        {
          workspaceRoot,
          approvalMode: "yolo",
          abortSignal: abortController.signal
        }
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("aborted");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
