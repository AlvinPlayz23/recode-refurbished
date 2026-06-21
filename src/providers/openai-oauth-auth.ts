/**
 * OAuth helpers for the ChatGPT/Codex OpenAI provider.
 */

import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isRecord } from "../shared/is-record.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const ACCOUNT_CLAIM = "https://api.openai.com/auth";
const AUTH_FILE_MODE = 0o600;
const AUTH_DIRECTORY_MODE = 0o700;

export interface OpenAiOAuthToken {
  readonly type: "oauth";
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}

export interface OpenAiOAuthSession {
  readonly token: OpenAiOAuthToken;
  readonly accountId: string;
}

interface OAuthServerInfo {
  readonly ready: boolean;
  readonly close: () => void;
  readonly waitForCode: (state: string) => Promise<string | undefined>;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

/**
 * Return the default auth-token path.
 */
export function resolveOpenAiOAuthAuthPath(): string {
  return resolve(homedir(), ".recode", "auth", "openai-oauth.json");
}

/**
 * Load the persisted OpenAI OAuth token, if one exists.
 */
export function loadOpenAiOAuthToken(path: string = resolveOpenAiOAuthAuthPath()): OpenAiOAuthToken | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parseOpenAiOAuthToken(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Persist an OpenAI OAuth token.
 */
export function saveOpenAiOAuthToken(
  token: OpenAiOAuthToken,
  path: string = resolveOpenAiOAuthAuthPath()
): void {
  mkdirSync(dirname(path), { recursive: true, mode: AUTH_DIRECTORY_MODE });
  chmodIfSupported(dirname(path), AUTH_DIRECTORY_MODE);
  writeFileSync(path, `${JSON.stringify(token, null, 2)}\n`, {
    encoding: "utf8",
    mode: AUTH_FILE_MODE
  });
  chmodIfSupported(path, AUTH_FILE_MODE);
}

/**
 * Ensure a valid OAuth session is available, refreshing the token if needed.
 */
export async function ensureOpenAiOAuthSession(
  path: string = resolveOpenAiOAuthAuthPath()
): Promise<OpenAiOAuthSession> {
  const existingToken = loadOpenAiOAuthToken(path);
  if (existingToken === undefined) {
    throw new Error("OpenAI Codex OAuth is not authenticated. Run `recode setup` and log in for the openai-oauth provider.");
  }

  const token = existingToken.expires <= Date.now() + 60_000
    ? await refreshOpenAiOAuthToken(existingToken.refresh, path)
    : existingToken;
  const accountId = readChatGptAccountId(token.access);
  if (accountId === undefined) {
    throw new Error("OpenAI Codex OAuth token is missing the ChatGPT account id. Re-authenticate with `recode setup`.");
  }

  return { token, accountId };
}

/**
 * Run the browser OAuth login flow and persist the resulting token.
 */
export async function authenticateOpenAiOAuth(
  path: string = resolveOpenAiOAuthAuthPath()
): Promise<OpenAiOAuthSession> {
  const flow = await createOpenAiOAuthAuthorizationUrl();
  const server = await startOpenAiOAuthServer();
  openBrowserUrl(flow.url);

  if (!server.ready) {
    server.close();
    throw new Error(`Unable to start the OAuth callback server. Open this URL manually and paste callback support is not available in this setup UI yet: ${flow.url}`);
  }

  const code = await server.waitForCode(flow.state);
  server.close();
  if (code === undefined) {
    throw new Error("OpenAI OAuth login did not complete.");
  }

  const token = await exchangeOpenAiOAuthCode(code, flow.verifier);
  saveOpenAiOAuthToken(token, path);
  const accountId = readChatGptAccountId(token.access);
  if (accountId === undefined) {
    throw new Error("OpenAI OAuth login succeeded, but the access token did not include a ChatGPT account id.");
  }

  return { token, accountId };
}

/**
 * Exchange a manually supplied redirect URL or authorization code.
 */
export async function authenticateOpenAiOAuthFromInput(
  input: string,
  verifier: string,
  path: string = resolveOpenAiOAuthAuthPath()
): Promise<OpenAiOAuthSession> {
  const code = parseAuthorizationInput(input);
  if (code === undefined) {
    throw new Error("OAuth callback input did not include an authorization code.");
  }

  const token = await exchangeOpenAiOAuthCode(code, verifier);
  saveOpenAiOAuthToken(token, path);
  const accountId = readChatGptAccountId(token.access);
  if (accountId === undefined) {
    throw new Error("OpenAI OAuth token did not include a ChatGPT account id.");
  }

  return { token, accountId };
}

/**
 * Create the authorization URL and PKCE verifier for a manual OAuth flow.
 */
export async function createOpenAiOAuthAuthorizationUrl(): Promise<{
  readonly url: string;
  readonly verifier: string;
  readonly state: string;
}> {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = await sha256Base64Url(verifier);
  const state = randomUUID().replaceAll("-", "");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  return { url: url.toString(), verifier, state };
}

/**
 * Extract a ChatGPT account id from an OAuth access token.
 */
export function readChatGptAccountId(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload?.[ACCOUNT_CLAIM];
  if (!isRecord(authClaim)) {
    return undefined;
  }

  const accountId = authClaim["chatgpt_account_id"];
  return typeof accountId === "string" && accountId.trim() !== ""
    ? accountId.trim()
    : undefined;
}

function parseOpenAiOAuthToken(value: unknown): OpenAiOAuthToken | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value["type"];
  const access = value["access"];
  const refresh = value["refresh"];
  const expires = value["expires"];
  if (
    type !== "oauth"
    || typeof access !== "string"
    || access.trim() === ""
    || typeof refresh !== "string"
    || refresh.trim() === ""
    || typeof expires !== "number"
    || !Number.isFinite(expires)
  ) {
    return undefined;
  }

  return {
    type: "oauth",
    access: access.trim(),
    refresh: refresh.trim(),
    expires
  };
}

async function refreshOpenAiOAuthToken(refreshToken: string, path: string): Promise<OpenAiOAuthToken> {
  const token = await postTokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID
  });
  saveOpenAiOAuthToken(token, path);
  return token;
}

async function exchangeOpenAiOAuthCode(code: string, verifier: string): Promise<OpenAiOAuthToken> {
  return await postTokenRequest({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI
  });
}

async function postTokenRequest(body: Record<string, string>): Promise<OpenAiOAuthToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI OAuth token request failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as TokenResponse;
  if (
    typeof payload.access_token !== "string"
    || typeof payload.refresh_token !== "string"
    || typeof payload.expires_in !== "number"
  ) {
    throw new Error("OpenAI OAuth token response did not include access, refresh, and expiry fields.");
  }

  return {
    type: "oauth",
    access: payload.access_token,
    refresh: payload.refresh_token,
    expires: Date.now() + payload.expires_in * 1000
  };
}

function parseAuthorizationInput(input: string): string | undefined {
  const value = input.trim();
  if (value === "") {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.searchParams.get("code") ?? undefined;
  } catch {
    // Continue parsing non-URL input.
  }

  if (value.includes("code=")) {
    const code = new URLSearchParams(value).get("code");
    return code ?? undefined;
  }

  if (value.includes("#")) {
    return value.split("#", 2)[0];
  }

  return value;
}

async function startOpenAiOAuthServer(): Promise<OAuthServerInfo> {
  let resolveCode: ((value: string | undefined) => void) | undefined;
  const codePromise = new Promise<string | undefined>((resolve) => {
    resolveCode = resolve;
  });
  let server: Server | undefined;
  let expectedState = "";

  try {
    server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", REDIRECT_URI);
      if (requestUrl.pathname !== "/auth/callback") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code") ?? undefined;
      const state = requestUrl.searchParams.get("state") ?? "";
      const valid = code !== undefined && state === expectedState;
      response.writeHead(valid ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(!valid
        ? "<html><body>Invalid or missing authorization response.</body></html>"
        : "<html><body>OpenAI OAuth complete. You can close this tab.</body></html>");
      resolveCode?.(valid ? code : undefined);
    });

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(1455, "127.0.0.1", () => resolve());
    });
  } catch {
    server?.close();
    return {
      ready: false,
      close() {
        return;
      },
      async waitForCode() {
        return undefined;
      }
    };
  }

  return {
    ready: true,
    close() {
      server?.close();
    },
    async waitForCode(state: string) {
      expectedState = state;
      const code = await Promise.race([
        codePromise,
        new Promise<undefined>((resolve) => setTimeout(resolve, 180_000))
      ]);
      return code === undefined ? undefined : code;
    }
  };
}

function openBrowserUrl(url: string): void {
  const command = process.platform === "win32"
    ? ["cmd.exe", "/c", "start", "", url]
    : process.platform === "darwin"
      ? ["open", url]
      : ["xdg-open", url];
  try {
    Bun.spawn(command, {
      stdout: "ignore",
      stderr: "ignore"
    });
  } catch {
    // The authorization URL is still available in setup status/error text.
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }

  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function sha256Base64Url(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(Buffer.from(digest));
}

function base64UrlEncode(value: Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function chmodIfSupported(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and some mounted filesystems do not fully support POSIX modes.
  }
}
