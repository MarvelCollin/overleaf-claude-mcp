import readline from "node:readline/promises";
import { BASE_URL, SESSION_COOKIE_NAMES, SESSION_FILE, USER_AGENT } from "../config.js";
import { SessionStore } from "./session.js";
import type { StoredCookie } from "./types.js";

const FIVE_DAYS_SECONDS = 5 * 24 * 60 * 60;

export function parseCookieInput(raw: string): StoredCookie[] {
  const trimmed = raw.trim().replace(/^Cookie:\s*/i, "");
  if (!trimmed) throw new Error("Nothing was pasted.");

  const host = new URL(BASE_URL).hostname;
  const domain = host.startsWith("www.") ? host.slice(3) : host;
  const cookies: StoredCookie[] = [];

  if (trimmed.includes("=")) {
    for (const part of trimmed.split(";")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!SESSION_COOKIE_NAMES.includes(name)) continue;
      cookies.push({
        name,
        value,
        domain: `.${domain}`,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + FIVE_DAYS_SECONDS,
      });
    }
  }

  if (cookies.length === 0) {
    if (/[;\s]/.test(trimmed)) {
      throw new Error(
        `Could not find a ${SESSION_COOKIE_NAMES[0]} cookie in what was pasted. Paste either the cookie value on its own, or the whole "name=value" pair.`,
      );
    }
    cookies.push({
      name: SESSION_COOKIE_NAMES[0]!,
      value: trimmed,
      domain: `.${domain}`,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + FIVE_DAYS_SECONDS,
    });
  }

  return cookies;
}

export async function saveAndVerify(cookies: StoredCookie[]): Promise<void> {
  const store = new SessionStore(SESSION_FILE);
  store.replaceAll(cookies);

  const response = await fetch(`${BASE_URL}/project`, {
    headers: { cookie: store.cookieHeader(), "user-agent": USER_AGENT, accept: "text/html" },
    redirect: "manual",
  });

  if (response.status !== 200) {
    throw new Error(
      `Overleaf rejected that cookie (HTTP ${response.status}). It is probably expired or was copied incompletely. Copy it again, making sure you take the whole value.`,
    );
  }

  await store.persist(true);
}

const INSTRUCTIONS = `
Copy your Overleaf session cookie:

  1. Open ${BASE_URL}/project in a browser where you are signed in
  2. Open developer tools with F12
  3. Go to Application on Chrome, Brave and Edge, or Storage on Firefox
  4. Expand Cookies and select ${BASE_URL}
  5. Click the row named ${SESSION_COOKIE_NAMES[0]} and copy its Value

The value is long and starts with s%3A. Copy all of it.
`;

async function main(): Promise<void> {
  const fromArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const fromEnv = process.env.OVERLEAF_SESSION_COOKIE;
  let raw = fromArg ?? fromEnv ?? "";

  if (!raw) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `${INSTRUCTIONS}\nThen run:\n  OVERLEAF_SESSION_COOKIE="paste_here" npm run login:paste\n`,
      );
      process.exit(1);
    }
    process.stdout.write(INSTRUCTIONS);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    raw = await rl.question("\nPaste the cookie value: ");
    rl.close();
  }

  await saveAndVerify(parseCookieInput(raw));
  process.stdout.write(`\nSession verified and saved to ${SESSION_FILE}. Keep it private.\n`);
}

const invokedDirectly = process.argv[1] && /paste\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
