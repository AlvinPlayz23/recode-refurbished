/**
 * Tests for workspace file suggestions.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyFileSuggestionDraftValue,
  buildFileSuggestionPanelState,
  getFileSuggestionQuery,
  invalidateWorkspaceFileSuggestionCache,
  loadWorkspaceFileSuggestions
} from "./file-suggestions.ts";

const tempRoots: string[] = [];

describe("workspace file suggestions", () => {
  afterEach(() => {
    invalidateWorkspaceFileSuggestionCache();

    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot !== undefined) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("extracts the active @file query from the draft", () => {
    expect(getFileSuggestionQuery("open @src/tu")).toBe("src/tu");
    expect(getFileSuggestionQuery("plain text")).toBeUndefined();
  });

  it("applies the selected suggestion back into the draft", () => {
    const nextDraft = applyFileSuggestionDraftValue("open @src/tu", {
      displayPath: "src/tui/",
      directory: true
    });

    expect(nextDraft).toBe("open @src/tui/");
  });

  it("loads sorted suggestions and skips ignored directories", async () => {
    const workspaceRoot = createWorkspace();

    mkdirSync(join(workspaceRoot, "src", "tui"), { recursive: true });
    mkdirSync(join(workspaceRoot, "refs", "vendor"), { recursive: true });
    mkdirSync(join(workspaceRoot, "node_modules", "pkg"), { recursive: true });
    await Bun.write(join(workspaceRoot, "README.md"), "docs");
    await Bun.write(join(workspaceRoot, "src", "app.tsx"), "app");
    await Bun.write(join(workspaceRoot, "src", "tui", "panel.tsx"), "panel");
    await Bun.write(join(workspaceRoot, "refs", "vendor", "ignored.txt"), "ignored");

    const suggestions = await loadWorkspaceFileSuggestions(workspaceRoot);

    expect(suggestions.map((item) => item.displayPath)).toEqual([
      "README.md",
      "src/",
      "src/app.tsx",
      "src/tui/",
      "src/tui/panel.tsx"
    ]);
  });

  it("invalidates cached suggestions after a file-system change", async () => {
    const workspaceRoot = createWorkspace();
    await Bun.write(join(workspaceRoot, "one.ts"), "one");

    const firstLoad = await loadWorkspaceFileSuggestions(workspaceRoot);
    await Bun.write(join(workspaceRoot, "two.ts"), "two");

    const cachedLoad = await loadWorkspaceFileSuggestions(workspaceRoot);
    expect(cachedLoad).toEqual(firstLoad);

    invalidateWorkspaceFileSuggestionCache(workspaceRoot);
    const refreshedLoad = await loadWorkspaceFileSuggestions(workspaceRoot);
    expect(refreshedLoad.map((item) => item.displayPath)).toEqual(["one.ts", "two.ts"]);
  });

  it("builds the visible suggestion panel from the loaded file index", () => {
    const panel = buildFileSuggestionPanelState(
      "open @src/",
      [
        { displayPath: "src/app.tsx", directory: false },
        { displayPath: "src/tui/", directory: true },
        { displayPath: "README.md", directory: false }
      ],
      false,
      1
    );

    expect(panel).toEqual({
      items: [
        { displayPath: "src/app.tsx", directory: false },
        { displayPath: "src/tui/", directory: true }
      ],
      hasMore: false,
      selectedIndex: 1,
      selectedItem: { displayPath: "src/tui/", directory: true }
    });
  });
});

function createWorkspace(): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "recode-file-suggestions-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}
