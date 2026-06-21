/**
 * Tests for file tools.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEditFileTool } from "../file-tools.ts";

describe("Edit tool", () => {
  it("writes replacement text literally even when it contains dollar patterns", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-edit-file-"));
    const filePath = join(workspaceRoot, "sample.txt");

    try {
      await Bun.write(filePath, "hello world\n");

      const tool = createEditFileTool();
      const result = await tool.execute(
        {
          path: "sample.txt",
          oldText: "hello",
          newText: "$&-literal"
        },
        { workspaceRoot }
      );

      expect(result.isError).toBe(false);
      expect(result.content).toBe("Edited file: sample.txt (1 replacement)");
      expect(await Bun.file(filePath).text()).toBe("$&-literal world\n");
      expect(result.metadata).toEqual({
        kind: "edit-preview",
        path: "sample.txt",
        oldText: "hello world\n",
        newText: "$&-literal world\n",
        replacementCount: 1
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("applies multiple non-overlapping edits against the original file", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-edit-file-"));
    const filePath = join(workspaceRoot, "sample.txt");

    try {
      await Bun.write(filePath, "alpha\nbeta\ngamma\n");

      const tool = createEditFileTool();
      const result = await tool.execute(
        {
          path: "sample.txt",
          edits: [
            { oldText: "alpha", newText: "ALPHA" },
            { oldText: "gamma", newText: "GAMMA" }
          ]
        },
        { workspaceRoot }
      );

      expect(result.content).toBe("Edited file: sample.txt (2 replacements)");
      expect(await Bun.file(filePath).text()).toBe("ALPHA\nbeta\nGAMMA\n");
      expect(result.metadata).toEqual({
        kind: "edit-preview",
        path: "sample.txt",
        oldText: "alpha\nbeta\ngamma\n",
        newText: "ALPHA\nbeta\nGAMMA\n",
        replacementCount: 2
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("supports replaceAll for deliberate broad replacements", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-edit-file-"));
    const filePath = join(workspaceRoot, "sample.txt");

    try {
      await Bun.write(filePath, "name name other name\n");

      const tool = createEditFileTool();
      await tool.execute(
        {
          path: "sample.txt",
          edits: [
            { oldText: "name", newText: "label", replaceAll: true }
          ]
        },
        { workspaceRoot }
      );

      expect(await Bun.file(filePath).text()).toBe("label label other label\n");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous and overlapping edits", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-edit-file-"));
    const filePath = join(workspaceRoot, "sample.txt");

    try {
      await Bun.write(filePath, "same same\nabcdef\n");

      const tool = createEditFileTool();
      await expect(tool.execute(
        {
          path: "sample.txt",
          edits: [{ oldText: "same", newText: "different" }]
        },
        { workspaceRoot }
      )).rejects.toThrow("Provide more context or set replaceAll to true");

      await expect(tool.execute(
        {
          path: "sample.txt",
          edits: [
            { oldText: "abc", newText: "ABC" },
            { oldText: "bc", newText: "BC" }
          ]
        },
        { workspaceRoot }
      )).rejects.toThrow("Edit replacements overlap");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
