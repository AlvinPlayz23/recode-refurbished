/**
 * Tests for Bash execution policy validation.
 */

import { describe, expect, it } from "bun:test";
import {
  resolveBashExecutionPolicy,
  validateCommandForUnsandboxedExecution
} from "../bash-execution-policy.ts";

const WORKSPACE = "/tmp/recode-sandbox-test";

describe("validateCommandForUnsandboxedExecution", () => {
  it("uses explicitly unsandboxed Bash execution", async () => {
    const policy = await resolveBashExecutionPolicy();
    expect(policy.isolation).toBe("unsandboxed");
  });

  it("allows simple commands covered by app-layer guardrails", () => {
    expect(validateCommandForUnsandboxedExecution("echo hello", WORKSPACE)).toBeNull();
  });

  it("rejects command substitution through guardrails, not sandboxing", () => {
    const result = validateCommandForUnsandboxedExecution("echo $(cat secret.txt)", WORKSPACE);
    expect(result).toContain("guardrails");
  });

  it("rejects backtick command substitution through guardrails, not sandboxing", () => {
    const result = validateCommandForUnsandboxedExecution("echo `cat secret.txt`", WORKSPACE);
    expect(result).toContain("guardrails");
  });

  it("keeps existing workspace escape validation", () => {
    const result = validateCommandForUnsandboxedExecution("cat ../../secret", WORKSPACE);
    expect(result).toContain("../../secret");
  });
});
