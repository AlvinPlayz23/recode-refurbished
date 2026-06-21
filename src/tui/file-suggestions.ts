/**
 * Workspace file suggestion helpers for the TUI composer.
 */

import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { normalizeBuiltinCommandSelectionIndex } from "./message-format.ts";

const DIRECTORY_SCAN_YIELD_INTERVAL = 24;
const SKIPPED_WORKSPACE_ENTRIES = new Set([".git", "node_modules", "refs", ".recode"]);
const workspaceFileSuggestionCache = new Map<string, readonly FileSuggestionItem[]>();

export interface FileSuggestionItem {
  readonly displayPath: string;
  readonly directory: boolean;
}

export interface FileSuggestionPanelState {
  readonly items: readonly FileSuggestionItem[];
  readonly hasMore: boolean;
  readonly selectedIndex: number;
  readonly selectedItem: FileSuggestionItem | undefined;
}

/**
 * Extract the active `@file` query from the current draft.
 */
export function getFileSuggestionQuery(value: string): string | undefined {
  const match = /(?:^|\s)@([^\n\r\t ]*)$/.exec(value);
  return match?.[1];
}

/**
 * Build the visible file suggestion panel state for the current draft.
 */
export function buildFileSuggestionPanelState(
  draft: string,
  files: readonly FileSuggestionItem[],
  busy: boolean,
  selectedIndex: number
): FileSuggestionPanelState | undefined {
  const query = getFileSuggestionQuery(draft);

  if (busy || query === undefined) {
    return undefined;
  }

  const normalizedQuery = normalizePathForSuggestion(query).toLowerCase();
  const matchingItems = files.filter((item) => normalizedQuery === "" || item.displayPath.toLowerCase().includes(normalizedQuery));
  const visibleItems = matchingItems.slice(0, 6);
  const normalizedSelectedIndex = normalizeBuiltinCommandSelectionIndex(selectedIndex, visibleItems.length);

  return {
    items: visibleItems,
    hasMore: matchingItems.length > visibleItems.length,
    selectedIndex: normalizedSelectedIndex,
    selectedItem: visibleItems[normalizedSelectedIndex]
  };
}

/**
 * Apply a selected file suggestion to the current draft value.
 */
export function applyFileSuggestionDraftValue(
  currentDraft: string,
  item: FileSuggestionItem
): string {
  const suffix = item.directory ? "" : " ";
  return currentDraft.replace(/(^|\s)@([^\n\r\t ]*)$/, `$1@${item.displayPath}${suffix}`);
}

/**
 * Load and cache workspace file suggestions for `@file` autocomplete.
 */
export async function loadWorkspaceFileSuggestions(
  workspaceRoot: string
): Promise<readonly FileSuggestionItem[]> {
  const cached = workspaceFileSuggestionCache.get(workspaceRoot);
  if (cached !== undefined) {
    return cached;
  }

  const results: FileSuggestionItem[] = [];
  const stack = [workspaceRoot];
  let scannedDirectoryCount = 0;

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (currentDirectory === undefined) {
      continue;
    }

    let entries: { readonly name: string; readonly directory: boolean }[];
    try {
      entries = (await readdir(currentDirectory, { withFileTypes: true })).map((entry) => ({
        name: String(entry.name),
        directory: entry.isDirectory()
      }));
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (shouldSkipWorkspaceSuggestionEntry(entry.name)) {
        continue;
      }

      const absolutePath = join(currentDirectory, entry.name);
      const relativePath = normalizePathForSuggestion(relative(workspaceRoot, absolutePath));
      if (relativePath === "") {
        continue;
      }

      results.push({
        displayPath: entry.directory ? `${relativePath}/` : relativePath,
        directory: entry.directory
      });

      if (entry.directory) {
        stack.push(absolutePath);
      }
    }

    scannedDirectoryCount += 1;
    if (scannedDirectoryCount % DIRECTORY_SCAN_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }

  results.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  workspaceFileSuggestionCache.set(workspaceRoot, results);
  return results;
}

/**
 * Invalidate cached workspace suggestions after file-system changes.
 */
export function invalidateWorkspaceFileSuggestionCache(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) {
    workspaceFileSuggestionCache.clear();
    return;
  }

  workspaceFileSuggestionCache.delete(workspaceRoot);
}

function shouldSkipWorkspaceSuggestionEntry(name: string): boolean {
  return SKIPPED_WORKSPACE_ENTRIES.has(name);
}

function normalizePathForSuggestion(value: string): string {
  return value.split(sep).join("/");
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
