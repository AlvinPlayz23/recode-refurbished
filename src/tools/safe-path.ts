/**
 * Safe path resolution within the workspace.
 *
 * @author dev
 */

import { isAbsolute, relative, resolve } from "node:path";
import { PathSecurityError } from "../errors/recode-error.ts";

/**
 * Resolve and validate a target path within the workspace.
 */
export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const normalizedWorkspaceRoot = resolve(workspaceRoot);
  const candidatePath = resolve(normalizedWorkspaceRoot, targetPath);
  const relativePath = relative(normalizedWorkspaceRoot, candidatePath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return candidatePath;
  }

  throw new PathSecurityError(`Path escapes workspace root: ${targetPath}`);
}
