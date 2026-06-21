/**
 * File-system storage helpers for Recode history.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const HISTORY_INDEX_FILENAME = "index.json";

/**
 * Resolve the history root directory from the config file path.
 */
export function resolveHistoryRoot(configPath: string): string {
  return resolve(dirname(configPath), "history");
}

/**
 * Return the JSON file path for one conversation.
 */
export function getConversationFilePath(historyRoot: string, conversationId: string): string {
  return join(historyRoot, `${conversationId}.json`);
}

/**
 * Read and parse one JSON file. Missing files return undefined.
 */
export function readHistoryJson(filePath: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Write one formatted JSON file, creating parent directories first.
 */
export function writeHistoryJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}
