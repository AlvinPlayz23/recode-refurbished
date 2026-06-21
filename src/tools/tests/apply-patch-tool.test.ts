/**
 * Tests for the ApplyPatch tool.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createApplyPatchTool } from "../apply-patch-tool.ts";

describe("ApplyPatch tool", () => {
  it("adds, updates, deletes, and moves files from one patch", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));
    const sourcePath = join(workspaceRoot, "src", "main.txt");
    const deletePath = join(workspaceRoot, "old.txt");

    try {
      await mkdir(dirname(sourcePath), { recursive: true });
      await Bun.write(sourcePath, "hello world\nkeep me\n");
      await Bun.write(deletePath, "remove me\n");

      const tool = createApplyPatchTool();
      const result = await tool.execute(
        {
          patch: [
            "*** Begin Patch",
            "*** Add File: notes/todo.txt",
            "+one",
            "+two",
            "*** Update File: src/main.txt",
            "*** Move to: src/renamed.txt",
            "@@",
            "-hello world",
            "+hello recode",
            " keep me",
            "*** Delete File: old.txt",
            "*** End Patch"
          ].join("\n")
        },
        { workspaceRoot }
      );

      expect(result).toEqual({
        content: "Applied patch: added notes/todo.txt, moved src/main.txt -> src/renamed.txt, deleted old.txt",
        isError: false
      });
      expect(await Bun.file(join(workspaceRoot, "notes", "todo.txt")).text()).toBe("one\ntwo\n");
      expect(await Bun.file(join(workspaceRoot, "src", "renamed.txt")).text()).toBe("hello recode\nkeep me\n");
      expect(await Bun.file(sourcePath).exists()).toBe(false);
      expect(await Bun.file(deletePath).exists()).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous update hunks", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));

    try {
      await Bun.write(join(workspaceRoot, "sample.txt"), "same\nsame\n");
      const tool = createApplyPatchTool();

      await expect(tool.execute(
        {
          patch: [
            "*** Begin Patch",
            "*** Update File: sample.txt",
            "@@",
            "-same",
            "+different",
            "*** End Patch"
          ].join("\n")
        },
        { workspaceRoot }
      )).rejects.toThrow("Patch hunk target must appear exactly once in: sample.txt");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects paths outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));

    try {
      const tool = createApplyPatchTool();

      await expect(tool.execute(
        {
          patch: [
            "*** Begin Patch",
            "*** Add File: ../outside.txt",
            "+nope",
            "*** End Patch"
          ].join("\n")
        },
        { workspaceRoot }
      )).rejects.toThrow("Path escapes workspace root: ../outside.txt");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("accepts OpenCode-style patchText, wrappers, and relaxed section headers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));

    try {
      await Bun.write(join(workspaceRoot, "poem.txt"), "first line\nsecond line\n");
      const tool = createApplyPatchTool();
      const result = await tool.execute(
        {
          patchText: [
            "```patch",
            "*** Begin Patch",
            "Update File: poem.txt",
            "",
            "@@",
            "-second line",
            "+second line, revised",
            "",
            "*** End Patch",
            "```"
          ].join("\n")
        },
        { workspaceRoot }
      );

      expect(result.isError).toBe(false);
      expect(await Bun.file(join(workspaceRoot, "poem.txt")).text()).toBe("first line\nsecond line, revised\n");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("appends pure addition update hunks", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));

    try {
      await Bun.write(join(workspaceRoot, "notes.txt"), "one\n");
      const tool = createApplyPatchTool();
      await tool.execute(
        {
          patch: [
            "*** Begin Patch",
            "*** Update File: notes.txt",
            "@@",
            "+two",
            "+",
            "+three",
            "*** End Patch"
          ].join("\n")
        },
        { workspaceRoot }
      );

      expect(await Bun.file(join(workspaceRoot, "notes.txt")).text()).toBe("one\ntwo\n\nthree\n");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("fuzzy matches hunk context with harmless whitespace and punctuation drift", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "recode-apply-patch-"));

    try {
      await Bun.write(join(workspaceRoot, "quote.txt"), "He said “hello”  \n");
      const tool = createApplyPatchTool();
      await tool.execute(
        {
          patch: [
            "*** Begin Patch",
            "*** Update File: quote.txt",
            "@@",
            "-He said \"hello\"",
            "+He said \"hi\"",
            "*** End Patch"
          ].join("\n")
        },
        { workspaceRoot }
      );

      expect(await Bun.file(join(workspaceRoot, "quote.txt")).text()).toBe("He said \"hi\"\n");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
