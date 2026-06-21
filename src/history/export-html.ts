/**
 * Export Recode conversations to standalone HTML.
 *
 * @author dev
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ConversationMessage } from "../transcript/message.ts";
import type { EditToolResultMetadata, ToolResultMetadata } from "../tools/tool.ts";
import { getTheme, type ThemeName } from "../tui/appearance/theme.ts";
import type { SavedConversationRecord } from "./recode-history.ts";

/**
 * HTML export request.
 */
export interface ExportConversationHtmlOptions {
  readonly workspaceRoot: string;
  readonly conversation: SavedConversationRecord;
  readonly themeName: ThemeName;
  readonly outputPath?: string;
}

/**
 * Export one conversation to a standalone HTML file.
 */
export function exportConversationToHtml(options: ExportConversationHtmlOptions): string {
  const outputPath = options.outputPath ?? defaultExportPath(options.workspaceRoot, options.conversation);
  const html = buildConversationHtml(options.conversation, options.themeName);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
  return outputPath;
}

function defaultExportPath(workspaceRoot: string, conversation: SavedConversationRecord): string {
  const timestamp = conversation.updatedAt.replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");
  const slug = slugify(conversation.title);
  return resolve(join(workspaceRoot, `recode-export-${slug}-${timestamp}.html`));
}

function buildConversationHtml(conversation: SavedConversationRecord, themeName: ThemeName): string {
  const theme = getTheme(themeName);
  const messagesHtml = conversation.transcript.map((message) => renderMessage(message, theme)).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(conversation.title)} · Recode Export</title>
  <style>
    :root {
      --bg: ${theme.bashMessageBackgroundColor};
      --panel: ${theme.userMessageBackground};
      --panel-alt: ${theme.userMessageBackgroundHover};
      --text: ${theme.text};
      --muted: ${theme.hintText};
      --brand: ${theme.brand};
      --brand-bright: ${theme.brandShimmer};
      --tool: ${theme.tool};
      --success: ${theme.success};
      --error: ${theme.error};
      --border: ${theme.promptBorder};
      --diff-added: ${theme.diffAdded};
      --diff-removed: ${theme.diffRemoved};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, ${theme.messageActionsBackground}, var(--bg) 48%);
      color: var(--text);
      font-family: "IBM Plex Mono", "Cascadia Code", "Consolas", monospace;
      line-height: 1.5;
    }
    .page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      margin-bottom: 24px;
      padding: 20px 22px;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.18);
      border-radius: 16px;
    }
    .title {
      margin: 0 0 6px;
      color: var(--brand-bright);
      font-size: 28px;
      font-weight: 700;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
    }
    .transcript {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .message {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.16);
    }
    .message.user { background: color-mix(in srgb, var(--panel) 72%, transparent); }
    .message.assistant { background: color-mix(in srgb, var(--panel-alt) 54%, transparent); }
    .message.summary { background: color-mix(in srgb, var(--panel-alt) 34%, transparent); }
    .message.tool { background: rgba(255,255,255,0.03); }
    .message-header {
      margin-bottom: 8px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .message.user .message-header { color: ${theme.user}; }
    .message.assistant .message-header { color: ${theme.assistantLabel}; }
    .message.summary .message-header { color: var(--brand-bright); }
    .message.tool .message-header { color: var(--tool); }
    .message.error .message-header { color: var(--error); }
    .content {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .tool-ok { color: var(--success); }
    .tool-error { color: var(--error); }
    .tool-preview {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255,255,255,0.03);
    }
    .tool-preview-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
      font-size: 13px;
      background: rgba(255,255,255,0.02);
    }
    .tool-preview-path {
      color: var(--brand-bright);
    }
    .diff-lines {
      margin: 0;
      padding: 0;
    }
    .diff-line {
      display: block;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 0.2rem 0.75rem;
    }
    .diff-line.removed {
      background: color-mix(in srgb, var(--diff-removed) 65%, transparent);
      color: var(--text);
    }
    .diff-line.added {
      background: color-mix(in srgb, var(--diff-added) 65%, transparent);
      color: var(--text);
    }
    .footer {
      margin-top: 28px;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    code {
      color: var(--brand-bright);
      background: rgba(255,255,255,0.06);
      padding: 0.08rem 0.28rem;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <h1 class="title">${escapeHtml(conversation.title)}</h1>
      <div class="meta">
        <span>Provider: <code>${escapeHtml(conversation.providerName)}</code></span>
        <span>Model: <code>${escapeHtml(conversation.model)}</code></span>
        <span>Mode: <code>${escapeHtml(conversation.mode.toUpperCase())}</code></span>
        <span>Created: ${escapeHtml(formatDate(conversation.createdAt))}</span>
        <span>Updated: ${escapeHtml(formatDate(conversation.updatedAt))}</span>
      </div>
    </section>
    <section class="transcript">
      ${messagesHtml}
    </section>
    <div class="footer">Exported from Recode</div>
  </main>
</body>
</html>`;
}

function renderMessage(message: ConversationMessage, theme: ReturnType<typeof getTheme>): string {
  switch (message.role) {
    case "user":
      return `<article class="message user">
  <div class="message-header">User</div>
  <div class="content">${escapeHtml(message.content)}</div>
</article>`;
    case "assistant":
      return `<article class="message assistant">
  <div class="message-header">Assistant</div>
  <div class="content">${escapeHtml(message.content === "" ? "(tool-only turn)" : message.content)}</div>
${message.toolCalls.length === 0 ? "" : `  <div class="content" style="margin-top: 12px; color: ${theme.tool};">${message.toolCalls.map((toolCall) =>
    `• ${escapeHtml(toolCall.name)} ${escapeHtml(toolCall.argumentsJson)}`
  ).join("\n")}</div>`}
</article>`;
    case "summary":
      return `<article class="message summary">
  <div class="message-header">Continuation Summary</div>
  <div class="content">${escapeHtml(message.content)}</div>
</article>`;
    case "tool":
      return `<article class="message tool ${message.isError ? "error" : ""}">
  <div class="message-header">${message.isError ? "Tool Error" : "Tool Result"} · ${escapeHtml(message.toolName)}</div>
  <div class="content ${message.isError ? "tool-error" : "tool-ok"}">${escapeHtml(message.content)}</div>
${renderToolMetadata(message.metadata)}
</article>`;
  }
}

function renderToolMetadata(metadata: ToolResultMetadata | undefined): string {
  if (metadata?.kind !== "edit-preview") {
    return "";
  }

  return renderEditPreview(metadata);
}

function renderEditPreview(metadata: EditToolResultMetadata): string {
  const removedLines = splitDiffLines(metadata.oldText);
  const addedLines = splitDiffLines(metadata.newText);

  return `  <div class="tool-preview">
    <div class="tool-preview-header">Edit Preview · <span class="tool-preview-path">${escapeHtml(metadata.path)}</span></div>
    <div class="diff-lines">
${removedLines.map((line) => `      <span class="diff-line removed">-${escapeHtml(line)}</span>`).join("\n")}
${addedLines.map((line) => `      <span class="diff-line added">+${escapeHtml(line)}</span>`).join("\n")}
    </div>
  </div>`;
}

function splitDiffLines(value: string): readonly string[] {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length > 1 && lines.at(-1) === "") {
    return lines.slice(0, -1);
  }

  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Markdown export request.
 */
export interface ExportConversationMarkdownOptions {
  readonly workspaceRoot: string;
  readonly conversation: SavedConversationRecord;
  readonly outputPath?: string;
}

/**
 * Export one conversation to a Markdown file.
 */
export function exportConversationToMarkdown(options: ExportConversationMarkdownOptions): string {
  const outputPath = options.outputPath ?? defaultMarkdownExportPath(options.workspaceRoot, options.conversation);
  const md = buildConversationMarkdown(options.conversation);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, md, "utf8");
  return outputPath;
}

function defaultMarkdownExportPath(workspaceRoot: string, conversation: SavedConversationRecord): string {
  const timestamp = conversation.updatedAt.replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");
  const slug = slugify(conversation.title);
  return resolve(join(workspaceRoot, `recode-export-${slug}-${timestamp}.md`));
}

function buildConversationMarkdown(conversation: SavedConversationRecord): string {
  const header = [
    `# ${conversation.title}`,
    "",
    `- **Provider**: ${conversation.providerName}`,
    `- **Model**: ${conversation.model}`,
    `- **Mode**: ${conversation.mode.toUpperCase()}`,
    `- **Created**: ${formatDate(conversation.createdAt)}`,
    `- **Updated**: ${formatDate(conversation.updatedAt)}`,
    ""
  ].join("\n");

  const body = conversation.transcript.map(renderMessageMarkdown).filter((s) => s !== "").join("\n\n---\n\n");
  return `${header}\n${body}\n`;
}

function renderMessageMarkdown(message: ConversationMessage): string {
  switch (message.role) {
    case "user":
      return `### You\n\n${message.content}`;
    case "assistant": {
      const toolLines = message.toolCalls.map(
        (toolCall) => `- **${toolCall.name}**: \`${toolCall.argumentsJson.slice(0, 120)}\``
      );
      const parts = [
        "### Recode",
        "",
        message.content === "" ? "_tool-only turn_" : message.content
      ];
      if (toolLines.length > 0) {
        parts.push("", "_Tool calls:_", ...toolLines);
      }
      return parts.join("\n");
    }
    case "summary":
      return `### Continuation Summary\n\n${message.content}`;
    case "tool": {
      const header = message.isError ? `### Tool Error · ${message.toolName}` : `### Tool Result · ${message.toolName}`;
      return `${header}\n\n\`\`\`\n${message.content}\n\`\`\``;
    }
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug === "" ? "conversation" : slug;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
