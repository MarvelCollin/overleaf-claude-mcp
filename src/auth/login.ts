import { chromium, type Browser, type BrowserContext } from "playwright";
import { BASE_URL, SESSION_COOKIE_NAMES, SESSION_FILE, USER_AGENT } from "../config.js";
import { SessionStore } from "./session.js";
import type { StoredCookie } from "./types.js";
import { findBrowser, hasDisplay } from "./browsers.js";

const LOGIN_TIMEOUT_MS = Number(process.env.OVERLEAF_LOGIN_TIMEOUT_MS ?? 600_000);
const POLL_INTERVAL_MS = 1_000;

async function launchBrowser(): Promise<Browser> {
  if (!hasDisplay()) {
    throw new Error(
      'This machine has no graphical display, so a login window cannot open. Use "npm run login:paste" instead, which needs no browser here.',
    );
  }

  const preferred = findBrowser();
  if (preferred) {
    try {
      process.stderr.write(`Using your default browser: ${preferred.name}\n`);
      return await chromium.launch({ headless: false, executablePath: preferred.executable });
    } catch {
      process.stderr.write(`Could not start ${preferred.name}, trying another browser.\n`);
    }
  }

  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ headless: false, channel });
    } catch {
      continue;
    }
  }

  try {
    return await chromium.launch({ headless: false });
  } catch {
    throw new Error(
      'No usable browser found. Install a browser, run "npx playwright install chromium", or use "npm run login:paste".',
    );
  }
}

function isOverleafCookie(domain: string): boolean {
  const host = new URL(BASE_URL).hostname;
  const normalized = domain.replace(/^\./, "");
  return host === normalized || host.endsWith(`.${normalized}`);
}

async function waitForSession(context: BrowserContext): Promise<StoredCookie[]> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const cookies = await context.cookies(BASE_URL);
    const signedIn = cookies.some(
      (cookie) => SESSION_COOKIE_NAMES.includes(cookie.name) && cookie.value.length > 20,
    );
    if (signedIn && context.pages().some((page) => /\/project/.test(page.url()))) {
      return cookies
        .filter((cookie) => isOverleafCookie(cookie.domain))
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires > 0 ? Math.floor(cookie.expires) : undefined,
        }));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for login. Nothing was saved.");
}

export async function captureSession(): Promise<number> {
  process.stderr.write(`Opening ${BASE_URL}/login in a browser window.\n`);
  process.stderr.write("Sign in there. This finishes on its own once you reach your projects.\n");

  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  try {
    const cookies = await waitForSession(context);
    const store = new SessionStore(SESSION_FILE);
    store.replaceAll(cookies);
    await store.persist(true);
    return cookies.length;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const count = await captureSession();
  process.stderr.write(`Session saved to ${SESSION_FILE} (${count} cookies). Keep it private.\n`);
}

const invokedDirectly = process.argv[1] && /login\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
