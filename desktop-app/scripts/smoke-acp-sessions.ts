/**
 * Smoke check that the desktop host can create independent ACP sessions.
 */

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopSessionManager } from "../src/bun/desktop-session-manager.ts";

const stateDir = mkdtempSync(join(tmpdir(), "recode-desktop-state-"));
const workspaceA = mkdtempSync(join(tmpdir(), "recode-desktop-a-"));
const workspaceB = mkdtempSync(join(tmpdir(), "recode-desktop-b-"));
const errors: string[] = [];

const manager = new DesktopSessionManager({
  statePath: join(stateDir, "desktop-sessions.json"),
  sendSessionUpdate: () => undefined,
  sendPermissionRequest: () => undefined,
  sendQuestionRequest: () => undefined,
  sendError: (_threadId, message) => {
    if (!message.includes("recode.acp_server")) {
      errors.push(message);
    }
  },
});

const [a, b] = await Promise.all([
  manager.createSession({ workspacePath: workspaceA, title: "Workspace A", mode: "build" }),
  manager.createSession({ workspacePath: workspaceB, title: "Workspace B", mode: "plan" }),
]);

if (a.thread.id === b.thread.id) {
  throw new Error("Expected independent ACP session IDs.");
}

if (a.project.path === b.project.path) {
  throw new Error("Expected independent workspace paths.");
}

if (a.thread.mode !== "build" || b.thread.mode !== "plan") {
  throw new Error(`Unexpected modes: ${a.thread.mode}, ${b.thread.mode}`);
}

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

await Promise.all([
  manager.closeSession(a.thread.id),
  manager.closeSession(b.thread.id),
]);

console.log(JSON.stringify({
  ok: true,
  sessions: [a.thread.id, b.thread.id],
  workspaces: [a.project.path, b.project.path],
  modes: [a.thread.mode, b.thread.mode],
}));

export {};
