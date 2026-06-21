/**
 * Tool registry.
 *
 * @author dev
 */

import { ToolExecutionError } from "../errors/recode-error.ts";
import type { ToolDefinition } from "./tool.ts";

/**
 * Index tool definitions by name.
 */
export class ToolRegistry {
  readonly #tools: ReadonlyMap<string, ToolDefinition>;
  readonly #toolList: readonly ToolDefinition[];

  public constructor(tools: readonly ToolDefinition[]) {
    const toolEntries = new Map<string, ToolDefinition>();

    for (const tool of tools) {
      if (toolEntries.has(tool.name)) {
        throw new ToolExecutionError(`Duplicate tool name: ${tool.name}`);
      }

      toolEntries.set(tool.name, tool);
    }

    this.#tools = toolEntries;
    this.#toolList = [...tools];
  }

  /**
   * Return all registered tool definitions.
   */
  public list(): readonly ToolDefinition[] {
    return this.#toolList;
  }

  /**
   * Look up a tool definition by name.
   */
  public get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }
}
