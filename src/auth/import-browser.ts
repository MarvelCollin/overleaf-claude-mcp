import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { BASE_URL, SESSION_COOKIE_NAMES, SESSION_FILE, USER_AGENT } from "../config.js";
import { SessionStore } from "./session.js";
import { findBrowser } from "./browsers.js";
import type { InstalledBrowser, StoredCookie } from "./types.js";

const COPIED_FILES = [
  "Local State",
  "Default/Network/Cookies",
  "Default/Preferences",
  "Default/Secure Preferences",
];

async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function cloneProfile(profile: InstalledBrowser): Promise<string> {
  const target = await fsp.mkdtemp(path.join(os.tmpdir(), "overleaf-mcp-profile-"));
  await fsp.mkdir(path.join(target, "Default", "Network"), { recursive: true });

  let copied = 0;
  for (const relative of COPIED_FILES) {
    const source = path.join(profile.userDataDir, relative);
    if (!(await exists(source))) continue;
    try {
      await fsp.copyFile(source, path.join(target, relative));
      copied += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EBUSY") {
        await fsp.rm(target, { recursive: true, force: true });
        throw new Error(
          `${profile.name} is running and holding ${relative} open. Close ${profile.name} completely, then run this again. Your real profile is never modified, only copied.`,
        );
      }
      throw err;
    }
  }
  if (copied === 0) throw new Error(`Nothing to copy from ${profile.userDataDir}`);
  return target;
}

function isOverleafCookie(domain: string): boolean {
  const host = new URL(BASE_URL).hostname;
  const normalized = domain.replace(/^\./, "");
  return host === normalized || host.endsWith(`.${normalized}`);
}

export async function importBrowserSession(
  preferred?: string,
  useRealProfile = false,
): Promise<number> {
  const profile = findBrowser(preferred);
  if (!profile) {
    throw new Error(
      preferred
        ? `Could not find ${preferred} installed on this machine.`
        : "Could not find Brave, Chrome, Chromium or Edge installed on this machine.",
    );
  }
  process.stderr.write(`Using your ${profile.name} profile.\n`);

  if (useRealProfile) {
    process.stderr.write(
      `Launching ${profile.name} against its own profile directory, so it can decrypt its own cookies.\n`,
    );
  }

  const cloned = useRealProfile ? profile.userDataDir : await cloneProfile(profile);
  const context = await chromium.launchPersistentContext(cloned, {
    executablePath: profile.executable,
    headless: false,
    userAgent: USER_AGENT,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-sync"],
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${BASE_URL}/project`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const onLoginPage = /\/login/.test(page.url());
    const hasProjectList = (await page.locator('meta[name="ol-prefetchedProjectsBlob"]').count()) > 0;

    if (onLoginPage || !hasProjectList) {
      throw new Error(
        `${profile.name} is not signed in to Overleaf (landed on ${page.url()}). Run "npm run login" instead.`,
      );
    }

    const cookies = (await context.cookies(BASE_URL))
      .filter((cookie) => isOverleafCookie(cookie.domain))
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires > 0 ? Math.floor(cookie.expires) : undefined,
      })) satisfies StoredCookie[];

    if (!cookies.some((cookie) => SESSION_COOKIE_NAMES.includes(cookie.name))) {
      throw new Error(`No Overleaf session cookie found in the ${profile.name} profile.`);
    }

    const store = new SessionStore(SESSION_FILE);
    store.replaceAll(cookies);
    await store.persist(true);

    const probe = await fetch(`${BASE_URL}/project`, {
      headers: { cookie: store.cookieHeader(), "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "manual",
    });
    if (probe.status !== 200) {
      throw new Error(
        `Copied a session from ${profile.name} but Overleaf rejected it (HTTP ${probe.status}). ` +
          'Overleaf ties a session to the browser that created it, so copying does not always work. Run "npm run login" instead.',
      );
    }

    return cookies.length;
  } finally {
    await context.close();
    if (!useRealProfile) await fsp.rm(cloned, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useRealProfile = args.includes("--real-profile");
  const preferred = args.find((a) => !a.startsWith("--"));
  const count = await importBrowserSession(preferred, useRealProfile);
  process.stderr.write(`Session saved to ${SESSION_FILE} (${count} cookies). Keep it private.\n`);
}

const invokedDirectly = process.argv[1] && /import-browser\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
