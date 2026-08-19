import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_FILE = path.resolve(process.cwd(), ".env");
if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ENV_FILE);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const BASE_URL = stripTrailingSlash(
  process.env.OVERLEAF_BASE_URL ?? "https://www.overleaf.com",
);

export const HOME_DIR =
  process.env.OVERLEAF_HOME_DIR ?? path.join(os.homedir(), ".overleaf-claude-mcp");

export const SESSION_FILE =
  process.env.OVERLEAF_SESSION_FILE ?? path.join(HOME_DIR, "session.json");

export const USER_AGENT =
  process.env.OVERLEAF_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const MAX_READ_CHARS = Number(process.env.OVERLEAF_MAX_READ_CHARS ?? 60_000);

export const SESSION_COOKIE_NAMES = ["overleaf_session2", "sharelatex.sid", "overleaf_session"];
