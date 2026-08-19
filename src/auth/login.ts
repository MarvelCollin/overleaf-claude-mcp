import { chromium, type Browser, type BrowserContext } from "playwright";
import { BASE_URL, SESSION_COOKIE_NAMES, SESSION_FILE, USER_AGENT } from "../config.js";
import { SessionStore, type StoredCookie } from "./session.js";

const LOGIN_TIMEOUT_MS = Number(process.env.OVERLEAF_LOGIN_TIMEOUT_MS ?? 600_000);
const POLL_INTERVAL_MS = 1_000;

async function launchBrowser(): Promise<Browser> {
  const channels = ["chrome", "msedge"];
  for (const channel of channels) {
    try {
      return await chromium.launch({ headless: false, channel });
    } catch {
      continue;
    }
  }
  return await chromium.launch({ headless: false });
}

function overleafHost(): string {
  return new URL(BASE_URL).hostname;
}

function isOverleafCookie(domain: string): boolean {
  const host = overleafHost();
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
    if (signedIn) {
      const pages = context.pages();
      const onAppPage = pages.some((page) => /\/project/.test(page.url()));
      if (onAppPage) {
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
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for login. Nothing was saved.");
}

async function main(): Promise<void> {
  process.stderr.write(`Opening ${BASE_URL}/login in a real browser window.\n`);
  process.stderr.write("Sign in there. This process saves the session once you reach your project list.\n");

  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  try {
    const cookies = await waitForSession(context);
    const store = new SessionStore(SESSION_FILE);
    store.replaceAll(cookies);
    await store.persist(true);
    process.stderr.write(`Session saved to ${SESSION_FILE}\n`);
    process.stderr.write(`Stored ${cookies.length} cookie(s). Keep this file private.\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
