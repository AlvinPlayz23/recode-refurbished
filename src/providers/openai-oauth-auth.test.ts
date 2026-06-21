/**
 * Tests for OpenAI Codex OAuth helpers.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOpenAiOAuthToken,
  readChatGptAccountId,
  saveOpenAiOAuthToken
} from "./openai-oauth-auth.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("OpenAI OAuth auth helpers", () => {
  it("extracts the ChatGPT account id from an access-token JWT", () => {
    const token = buildJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-123"
      }
    });

    expect(readChatGptAccountId(token)).toBe("account-123");
  });

  it("saves and loads OAuth tokens from a separate auth file", () => {
    const root = mkdtempSync(join(tmpdir(), "recode-oauth-"));
    tempDirs.push(root);
    const authPath = join(root, "openai-oauth.json");
    const token = {
      type: "oauth" as const,
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000
    };

    saveOpenAiOAuthToken(token, authPath);

    expect(loadOpenAiOAuthToken(authPath)).toEqual(token);
  });
});

function buildJwt(payload: Record<string, unknown>): string {
  return [
    base64UrlJson({ alg: "none" }),
    base64UrlJson(payload),
    "signature"
  ].join(".");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
