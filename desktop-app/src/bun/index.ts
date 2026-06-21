/**
 * Electrobun host process for the Recode desktop application.
 */

import { BrowserWindow } from "electrobun/bun";
import { BrowserView } from "electrobun/bun";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import type { RecodeDesktopRPC } from "../../web/src/desktop-rpc.ts";
import { DesktopSessionManager } from "./desktop-session-manager.ts";

const devUrl = process.env.RECODE_DESKTOP_DEV_URL;
const startUrl = devUrl && devUrl.length > 0 ? devUrl : "views://main/index.html";

let mainWindow: BrowserWindow | undefined;

const sessions = new DesktopSessionManager({
  sendSessionUpdate: (update) => rpc.send.sessionUpdate(update),
  sendPermissionRequest: (request) => rpc.send.permissionRequest(request),
  sendQuestionRequest: (request) => rpc.send.questionRequest(request),
  sendError: (threadId, message) => rpc.send.sessionError({ threadId, message }),
});

const rpc = BrowserView.defineRPC<RecodeDesktopRPC>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {
      getSnapshot: () => sessions.snapshot(),
      getThreadMessages: (params) => sessions.getThreadMessages(params.threadId),
      setRuntimeMode: (params) => sessions.setRuntimeMode(params.runtimeMode),
      setRecodeRepoRoot: (params) => sessions.setRecodeRepoRoot(params.path),
      setGpuAccelerationDisabled: (params) => sessions.setGpuAccelerationDisabled(params.disabled),
      listDirectory: (params) => listDirectory(params.path),
      addWorkspace: (params) => sessions.addWorkspace(params.workspacePath),
      createSession: async (params) => await sessions.createSession(params),
      activateSession: async (params) => await sessions.activateSession(params.threadId),
      sendPrompt: async (params) => await sessions.sendPrompt(params),
      cancelSession: async (params) => await sessions.cancelSession(params.threadId),
      setConfigOption: async (params) => await sessions.setConfigOption(params),
      answerPermission: (params) => {
        sessions.answerPermission(params);
        return {};
      },
      answerQuestion: (params) => {
        sessions.answerQuestion(params);
        return {};
      },
      closeSession: async (params) => {
        await sessions.closeSession(params.threadId);
        return {};
      },
    },
    messages: {},
  },
});

mainWindow = new BrowserWindow({
  title: "Recode",
  url: startUrl,
  rpc,
  frame: {
    x: 80,
    y: 80,
    width: 1280,
    height: 820,
  },
});

function listDirectory(requestedPath: string | undefined) {
  const targetPath = requestedPath && requestedPath.length > 0
    ? requestedPath
    : homedir();
  const root = parse(targetPath).root;
  const parentPath = targetPath === root ? undefined : dirname(targetPath);
  const entries = readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(targetPath, entry.name);
      return {
        name: entry.name,
        path,
      };
    })
    .filter((entry) => {
      try {
        return statSync(entry.path).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: targetPath,
    ...(parentPath === undefined ? {} : { parentPath }),
    entries,
  };
}
