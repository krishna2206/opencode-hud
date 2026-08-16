/**
 * OpenCode Go: credentials resolution.
 *
 * The scraping needs a workspace id + auth cookie. Resolution order: env vars
 * (OPENCODE_GO_WORKSPACE_ID / OPENCODE_GO_AUTH_COOKIE), then the legacy
 * `opencode-hud/hud.json` file in the opencode config dir.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenCodeGoCredentials {
  workspaceId: string;
  authCookie: string;
}

export type ResolvedCredentials =
  | { state: "configured"; credentials: OpenCodeGoCredentials; source: string }
  | { state: "missing" }
  | { state: "incomplete"; missing: string }
  | { state: "invalid"; error: string };

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "opencode");
}

function configFilePath(): string {
  return join(configDir(), "opencode-hud", "hud.json");
}

export async function resolveCredentials(): Promise<ResolvedCredentials> {
  const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID?.trim() ?? "";
  const authCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim() ?? "";

  if (workspaceId || authCookie) {
    if (workspaceId && authCookie) {
      return { state: "configured", credentials: { workspaceId, authCookie }, source: "env" };
    }
    return {
      state: "incomplete",
      missing: workspaceId ? "OPENCODE_GO_AUTH_COOKIE" : "OPENCODE_GO_WORKSPACE_ID",
    };
  }

  const path = configFilePath();
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "invalid", error: `Failed to read config file: ${String(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      state: "invalid",
      error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "invalid", error: "Config file must contain a JSON object" };
  }

  const credentials = (parsed as { credentials?: unknown }).credentials;
  const record =
    credentials && typeof credentials === "object" && !Array.isArray(credentials)
      ? (credentials as Record<string, unknown>)
      : {};

  const fileWorkspaceId = typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
  const fileAuthCookie = typeof record.authCookie === "string" ? record.authCookie.trim() : "";

  if (fileWorkspaceId && fileAuthCookie) {
    return {
      state: "configured",
      credentials: { workspaceId: fileWorkspaceId, authCookie: fileAuthCookie },
      source: path,
    };
  }

  return {
    state: "incomplete",
    missing: !fileWorkspaceId ? "credentials.workspaceId" : "credentials.authCookie",
  };
}