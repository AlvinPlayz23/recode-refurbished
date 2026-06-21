/**
 * Tests for tool-call approval handling.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import { ToolExecutionError } from "../../errors/recode-error.ts";
import type { ToolCall } from "../../transcript/message.ts";
import { executeToolCall } from "../execute-tool-call.ts";
import { ToolRegistry } from "../tool-registry.ts";
import type { ToolDefinition } from "../tool.ts";

const EDIT_TOOL: ToolDefinition = {
  name: "Edit",
  description: "Edit a file.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  async execute() {
    return {
      content: "edited",
      isError: false
    };
  }
};

const READ_TOOL: ToolDefinition = {
  name: "Read",
  description: "Read a file.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  async execute() {
    return {
      content: "read",
      isError: false
    };
  }
};

const WEB_TOOL: ToolDefinition = {
  name: "WebSearch",
  description: "Search the web.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  async execute() {
    return {
      content: "searched",
      isError: false
    };
  }
};

const FAILING_APPLY_PATCH_TOOL: ToolDefinition = {
  name: "ApplyPatch",
  description: "Apply a patch.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  async execute() {
    throw new ToolExecutionError("Patch must include '*** Begin Patch'.");
  }
};

const FAILING_APPLY_PATCH_HUNK_TOOL: ToolDefinition = {
  name: "ApplyPatch",
  description: "Apply a patch.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  },
  async execute() {
    throw new ToolExecutionError("Patch hunk target was not found in: src/example.ts.");
  }
};

describe("executeToolCall approval handling", () => {
  it("blocks tools that require approval when no interactive handler exists", async () => {
    const result = await executeToolCall(
      createToolCall("Edit"),
      new ToolRegistry([EDIT_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "approval"
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Approval required for Edit");
  });

  it("allows auto-edits mode to run edit tools without prompting", async () => {
    const result = await executeToolCall(
      createToolCall("Edit"),
      new ToolRegistry([EDIT_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "auto-edits"
      }
    );

    expect(result).toEqual({
      role: "tool",
      toolCallId: "tool-call-1",
      toolName: "Edit",
      content: "edited",
      isError: false
    });
  });

  it("respects a deny decision from the approval handler", async () => {
    const result = await executeToolCall(
      createToolCall("Bash"),
      new ToolRegistry([{
        ...EDIT_TOOL,
        name: "Bash"
      }]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "approval",
        requestToolApproval: async () => "deny"
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("denied by user");
  });

  it("skips approval for allowlisted scopes", async () => {
    const result = await executeToolCall(
      createToolCall("Read"),
      new ToolRegistry([READ_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "approval",
        approvalAllowlist: ["read"]
      }
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBe("read");
  });

  it("allows matching permission rules before prompting", async () => {
    const result = await executeToolCall(
      {
        ...createToolCall("Bash"),
        argumentsJson: "{\"command\":\"git status --short\"}"
      },
      new ToolRegistry([{ ...EDIT_TOOL, name: "Bash" }]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "approval",
        permissionRules: [
          { permission: "bash", pattern: "git status*", action: "allow" }
        ]
      }
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBe("edited");
  });

  it("denies matching permission rules without asking", async () => {
    let asked = false;
    const result = await executeToolCall(
      {
        ...createToolCall("Bash"),
        argumentsJson: "{\"command\":\"rm -rf dist\"}"
      },
      new ToolRegistry([{ ...EDIT_TOOL, name: "Bash" }]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "yolo",
        permissionRules: [
          { permission: "bash", pattern: "rm *", action: "deny" }
        ],
        requestToolApproval: async () => {
          asked = true;
          return "allow-once";
        }
      }
    );

    expect(asked).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("denied by permission rule");
  });

  it("treats web tools as a separate approval scope", async () => {
    const blocked = await executeToolCall(
      createToolCall("WebSearch"),
      new ToolRegistry([WEB_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "auto-edits"
      }
    );
    const allowed = await executeToolCall(
      createToolCall("WebSearch"),
      new ToolRegistry([WEB_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "auto-edits",
        approvalAllowlist: ["web"]
      }
    );

    expect(blocked.isError).toBe(true);
    expect(blocked.content).toContain("Approval required for WebSearch");
    expect(allowed.isError).toBe(false);
    expect(allowed.content).toBe("searched");
  });

  it("adds recovery hints to failed tool results", async () => {
    const result = await executeToolCall(
      createToolCall("ApplyPatch"),
      new ToolRegistry([FAILING_APPLY_PATCH_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "yolo"
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Tool execution failed: Patch must include");
    expect(result.content).toContain("Recovery hint:");
    expect(result.content).toContain("Begin Patch/End Patch");
  });

  it("tells the model to reread files after ApplyPatch hunk misses", async () => {
    const result = await executeToolCall(
      createToolCall("ApplyPatch"),
      new ToolRegistry([FAILING_APPLY_PATCH_HUNK_TOOL]),
      {
        workspaceRoot: "/workspace",
        approvalMode: "yolo"
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Patch hunk target was not found");
    expect(result.content).toContain("Read the target file again before retrying");
  });
});

function createToolCall(name: string): ToolCall {
  return {
    id: "tool-call-1",
    name,
    argumentsJson: "{}"
  };
}
