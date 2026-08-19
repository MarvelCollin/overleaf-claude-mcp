import fsp from "node:fs/promises";
import path from "node:path";
import { SESSION_COOKIE_NAMES, SESSION_FILE } from "../config.js";
import type { StoredCookie, StoredSession } from "./types.js";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function parseSetCookie(raw: string): StoredCookie | null {
  const parts = raw.split(";");
  const pair = parts[0];
  if (!pair) return null;
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const cookie: StoredCookie = { name, value, domain: "", path: "/" };
  for (const attr of parts.slice(1)) {
    const [rawKey, ...rest] = attr.split("=");
    const key = (rawKey ?? "").trim().toLowerCase();
    const val = rest.join("=").trim();
    if (key === "domain") cookie.domain = val.replace(/^\./, "");
    else if (key === "path") cookie.path = val || "/";
    else if (key === "expires") {
      const ts = Date.parse(val);
      if (!Number.isNaN(ts)) cookie.expires = Math.floor(ts / 1000);
    } else if (key === "max-age") {
      const secs = Number(val);
      if (Number.isFinite(secs)) cookie.expires = Math.floor(Date.now() / 1000) + secs;
    }
  }
  return cookie;
}

export class SessionStore {
  private cookies = new Map<string, StoredCookie>();
  private dirty = false;

  constructor(private readonly file: string = SESSION_FILE) {}

  async load(): Promise<boolean> {
    try {
      const text = await fsp.readFile(this.file, "utf8");
      const parsed = JSON.parse(text) as StoredSession;
      this.cookies.clear();
      for (const cookie of parsed.cookies ?? []) {
        this.cookies.set(cookie.name, cookie);
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  replaceAll(cookies: StoredCookie[]): void {
    this.cookies.clear();
    for (const cookie of cookies) this.cookies.set(cookie.name, cookie);
    this.dirty = true;
  }

  hasSessionCookie(): boolean {
    return SESSION_COOKIE_NAMES.some((name) => this.cookies.has(name));
  }

  cookieHeader(): string {
    const now = Math.floor(Date.now() / 1000);
    const live: string[] = [];
    for (const cookie of this.cookies.values()) {
      if (cookie.expires && cookie.expires > 0 && cookie.expires < now) continue;
      live.push(`${cookie.name}=${cookie.value}`);
    }
    return live.join("; ");
  }

  applyResponse(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const raws = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const raw of raws) {
      const cookie = parseSetCookie(raw);
      if (!cookie) continue;
      if (cookie.value === "" || cookie.value === "deleted") {
        this.cookies.delete(cookie.name);
        this.dirty = true;
        continue;
      }
      const existing = this.cookies.get(cookie.name);
      if (existing && existing.value === cookie.value) continue;
      if (existing && !cookie.domain) cookie.domain = existing.domain;
      this.cookies.set(cookie.name, cookie);
      this.dirty = true;
    }
  }

  async persist(force = false): Promise<void> {
    if (!this.dirty && !force) return;
    const payload: StoredSession = {
      savedAt: new Date().toISOString(),
      baseUrl: process.env.OVERLEAF_BASE_URL ?? "https://www.overleaf.com",
      cookies: [...this.cookies.values()],
    };
    await fsp.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await fsp.rename(tmp, this.file);
    this.dirty = false;
  }

  get filePath(): string {
    return this.file;
  }

  sessionExpiry(): Date | null {
    for (const name of SESSION_COOKIE_NAMES) {
      const cookie = this.cookies.get(name);
      if (cookie?.expires) return new Date(cookie.expires * 1000);
    }
    return null;
  }
}

export async function loadSessionOrThrow(file?: string): Promise<SessionStore> {
  const store = new SessionStore(file);
  const found = await store.load();
  if (!found || !store.hasSessionCookie()) {
    throw new AuthError(
      `No Overleaf session found at ${store.filePath}. Run "npm run login" and sign in when the browser opens.`,
    );
  }
  return store;
}
