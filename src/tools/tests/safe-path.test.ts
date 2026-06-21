/**
 * Tests for safe path resolution.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { PathSecurityError } from "../../errors/recode-error.ts";
import { resolveSafePath } from "../safe-path.ts";

describe("resolveSafePath", () => {
  it("resolves a child path inside workspace", () => {
    const workspaceRoot = "/tmp/recode";
    const resolvedPath = resolveSafePath(workspaceRoot, "src/index.ts");

    expect(resolvedPath).toBe(resolve(workspaceRoot, "src/index.ts"));
  });

  it("rejects a path that escapes the workspace", () => {
    const workspaceRoot = "/tmp/recode";

    expect(() => resolveSafePath(workspaceRoot, "../secret.txt")).toThrow(PathSecurityError);
  });
});
