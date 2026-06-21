/**
 * Per-file mutation queue for write-capable tools.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const fileMutationQueues = new Map<string, Promise<void>>();

/**
 * Serialize mutations for one canonical filesystem target while allowing
 * unrelated files to proceed concurrently.
 */
export async function withFileMutationQueue<T>(
  workspaceRoot: string,
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = getMutationQueueKey(workspaceRoot, filePath);
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

  let releaseNext!: () => void;
  const nextQueue = new Promise<void>((resolveQueue) => {
    releaseNext = resolveQueue;
  });
  const chainedQueue = currentQueue.then(() => nextQueue);
  fileMutationQueues.set(key, chainedQueue);

  await currentQueue;
  try {
    return await operation();
  } finally {
    releaseNext();
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}

function getMutationQueueKey(workspaceRoot: string, filePath: string): string {
  const resolvedPath = resolve(workspaceRoot, filePath);
  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
