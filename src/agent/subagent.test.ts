/**
 * Tests for subagent registry and model selection helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import type { ToolDefinition } from "../tools/tool.ts";
import { ToolRegistry } from "../tools/tool-registry.ts";
import {
  createSubagentToolRegistry,
  resolveSubagentRuntimeConfig
} from "./subagent.ts";

describe("subagent helpers", () => {
  it("limits explore subagents to read/search/web tools", () => {
    const registry = createSubagentToolRegistry(new ToolRegistry(createToolSet()), "explore");

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "Read",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch"
    ]);
  });

  it("keeps general tools but excludes recursive Task usage", () => {
    const registry = createSubagentToolRegistry(new ToolRegistry(createToolSet()), "general");

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "Bash",
      "TodoWrite",
      "Read",
      "Write",
      "Edit",
      "ApplyPatch",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch"
    ]);
  });

  it("uses configured subagent provider/model and falls back to the parent model", () => {
    const parent = createRuntimeConfig();

    expect(resolveSubagentRuntimeConfig(parent, "explore").model).toBe("parent-model");

    const configured = resolveSubagentRuntimeConfig({
      ...parent,
      agents: {
        general: {
          providerId: "other",
          model: "other-model"
        }
      }
    }, "general");

    expect(configured.providerId).toBe("other");
    expect(configured.model).toBe("other-model");
    expect(configured.baseUrl).toBe("https://other.example/v1");
  });

  it("honors disabled tools in subagent config", () => {
    const registry = createSubagentToolRegistry(new ToolRegistry(createToolSet()), "general", {
      tools: {
        Bash: false,
        Write: false
      }
    });

    expect(registry.list().map((tool) => tool.name)).not.toContain("Bash");
    expect(registry.list().map((tool) => tool.name)).not.toContain("Write");
  });
});

function createToolSet(): readonly ToolDefinition[] {
  return [
    createTool("Bash"),
    createTool("TodoWrite"),
    createTool("Task"),
    createTool("Read"),
    createTool("Write"),
    createTool("Edit"),
    createTool("ApplyPatch"),
    createTool("Glob"),
    createTool("Grep"),
    createTool("WebFetch"),
    createTool("WebSearch")
  ];
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    },
    async execute() {
      return {
        content: name,
        isError: false
      };
    }
  };
}

function createRuntimeConfig(): RuntimeConfig {
  return {
    workspaceRoot: "/workspace",
    configPath: "/tmp/config.json",
    provider: "openai-chat",
    providerId: "parent",
    providerName: "Parent Provider",
    model: "parent-model",
    providers: [
      {
        id: "parent",
        name: "Parent Provider",
        kind: "openai-chat",
        baseUrl: "https://parent.example/v1",
        models: [{ id: "parent-model" }],
        defaultModelId: "parent-model",
        source: "config"
      },
      {
        id: "other",
        name: "Other Provider",
        kind: "openai-chat",
        baseUrl: "https://other.example/v1",
        models: [{ id: "other-model" }],
        defaultModelId: "other-model",
        source: "config"
      }
    ],
    approvalMode: "approval",
    approvalAllowlist: [],
    permissionRules: [],
    baseUrl: "https://parent.example/v1"
  };
}
