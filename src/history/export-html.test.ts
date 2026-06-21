/**
 * Tests for HTML conversation export.
 *
 * @author dev
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportConversationToHtml } from "./export-html.ts";
import type { SavedConversationRecord } from "./recode-history.ts";

describe("exportConversationToHtml", () => {
  it("writes a standalone HTML transcript", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-export-"));
    const conversation: SavedConversationRecord = {
      id: "conversation-1",
      title: "Architecture Review",
      preview: "Looks good.",
      workspaceRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      providerId: "openai",
      providerName: "OpenAI",
      model: "gpt-4.1",
      mode: "build",
      messageCount: 2,
      transcript: [
        { role: "user", content: "Explain the architecture." },
        {
          role: "assistant",
          content: "Here is the architecture.",
          toolCalls: []
        }
      ]
    };

    const outputPath = exportConversationToHtml({
      workspaceRoot,
      conversation,
      themeName: "senren-dusk"
    });
    const html = readFileSync(outputPath, "utf8");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Architecture Review");
    expect(html).toContain("Explain the architecture.");
    expect(html).toContain("Here is the architecture.");
    expect(outputPath).toContain("recode-export-architecture-review");
  });

  it("renders edit previews for tool results", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "recode-export-diff-"));
    const conversation: SavedConversationRecord = {
      id: "conversation-2",
      title: "Patch Preview",
      preview: "Edited file: src/app.tsx",
      workspaceRoot,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:05:00.000Z",
      providerId: "openai",
      providerName: "OpenAI",
      model: "gpt-4.1",
      mode: "build",
      messageCount: 2,
      transcript: [
        { role: "user", content: "Update the greeting." },
        {
          role: "assistant",
          content: "",
          toolCalls: []
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "Edit",
          content: "Edited file: src/app.tsx",
          isError: false,
          metadata: {
            kind: "edit-preview",
            path: "src/app.tsx",
            oldText: "const greeting = \"Hello\";\n",
            newText: "const greeting = \"Hello there\";\n"
          }
        }
      ]
    };

    const outputPath = exportConversationToHtml({
      workspaceRoot,
      conversation,
      themeName: "senren-dusk"
    });
    const html = readFileSync(outputPath, "utf8");

    expect(html).toContain("Edit Preview");
    expect(html).toContain("src/app.tsx");
    expect(html).toContain("-const greeting = &quot;Hello&quot;;");
    expect(html).toContain("+const greeting = &quot;Hello there&quot;;");
  });
});
