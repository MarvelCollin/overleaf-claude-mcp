import { DETECT_BROWSER, DETECT_HEADLESS, DETECT_TIMEOUT_MS, USER_AGENT } from "../config.js";
import type { DetectorReport } from "./types.js";

export interface Captured {
  url: string;
  status: number;
  body: string;
  json?: unknown;
}

export interface CrawlConfig {
  name: string;
  label: string;
  url: string;
  maxChars: number;
  input: string;
  submit: RegExp;
  avoid?: RegExp;
  capture: RegExp;
  settleMs?: number;
  ready?: RegExp;
}

export interface SiteConfig extends CrawlConfig {
  parse(captured: Captured[], text: string): DetectorReport;
}

const CONSENT = /^(accept|allow all|agree|i agree|got it|ok|continue|understood)/i;

type Browser = Awaited<ReturnType<typeof launch>>;

let shared: Browser | undefined;
let idleTimer: NodeJS.Timeout | undefined;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      'Playwright is not installed. Run "npm install" in the overleaf-claude-mcp folder, then "npx playwright install chromium".',
    );
  }
}

async function launch() {
  const playwright = await loadPlaywright();
  const engine = playwright[DETECT_BROWSER] ?? playwright.chromium;
  try {
    return await engine.launch({
      headless: DETECT_HEADLESS,
      args: DETECT_BROWSER === "chromium" ? ["--disable-blink-features=AutomationControlled"] : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|please run the following command/i.test(message)) {
      throw new Error(
        `No ${DETECT_BROWSER} binary for Playwright. Run "npx playwright install ${DETECT_BROWSER}" in the overleaf-claude-mcp folder.`,
      );
    }
    throw err;
  }
}

async function browser(): Promise<Browser> {
  if (!shared || !shared.isConnected()) shared = await launch();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), 60_000);
  idleTimer.unref?.();
  return shared;
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const current = shared;
  shared = undefined;
  if (current?.isConnected()) await current.close().catch(() => undefined);
}

export async function runSite(config: SiteConfig, text: string): Promise<DetectorReport> {
  return config.parse(await crawl(config, text), text);
}

export async function crawl(config: CrawlConfig, text: string): Promise<Captured[]> {
  const instance = await browser();
  const context = await instance.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const captured: Captured[] = [];
  context.on("response", async (response) => {
    if (!config.capture.test(response.url())) return;
    let body = "";
    try {
      body = await response.text();
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      json = undefined;
    }
    captured.push({ url: response.url(), status: response.status(), body, json });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  try {
    await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: DETECT_TIMEOUT_MS });
    await page.waitForTimeout(3500);
    await dismissConsent(page);

    const box = page.locator(config.input).first();
    await box.waitFor({ state: "visible", timeout: 25_000 });
    await enter(page, box, text);
    await page.waitForTimeout(1200);

    const clicked = await submit(page, config);
    if (!clicked) throw new Error(`no enabled button on ${config.url} matched ${config.submit}`);

    await waitForResult(page, config, captured);

    if (captured.length === 0) {
      throw new Error(`${config.label} returned no response matching ${config.capture}`);
    }
    return captured;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function dismissConsent(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<void> {
  await page
    .evaluate((pattern: string) => {
      const test = new RegExp(pattern, "i");
      for (const el of document.querySelectorAll("button, [role='button'], a")) {
        const label = (el as HTMLElement).innerText?.trim() ?? "";
        const rect = el.getBoundingClientRect();
        if (label && test.test(label) && rect.width > 20 && rect.height > 10) {
          (el as HTMLElement).click();
          return;
        }
      }
    }, CONSENT.source)
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function enter(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  box: ReturnType<Awaited<ReturnType<Browser["newPage"]>>["locator"]>,
  text: string,
): Promise<void> {
  const tag = await box.evaluate((el: Element) => el.tagName.toLowerCase());
  if (tag === "textarea" || tag === "input") {
    await box.fill(text);
    await box.dispatchEvent("input").catch(() => undefined);
    await box.dispatchEvent("change").catch(() => undefined);
    return;
  }
  await box.click({ force: true });
  await page.waitForTimeout(300);
  await page.keyboard.insertText(text);
}

async function submit(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  config: CrawlConfig,
): Promise<string | null> {
  return await page.evaluate(
    ({ want, skip }: { want: string; skip: string | null }) => {
      const wanted = new RegExp(want, "i");
      const avoid = skip ? new RegExp(skip, "i") : null;
      for (const el of document.querySelectorAll("button, [role='button'], input[type=submit]")) {
        const node = el as HTMLButtonElement;
        const label = (node.innerText || node.value || "").trim();
        const rect = node.getBoundingClientRect();
        if (!label || rect.width < 20 || node.disabled) continue;
        if (!wanted.test(label)) continue;
        if (avoid?.test(label)) continue;
        node.click();
        return label;
      }
      return null;
    },
    { want: config.submit.source, skip: config.avoid?.source ?? null },
  );
}

async function waitForResult(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  config: CrawlConfig,
  captured: Captured[],
): Promise<void> {
  const deadline = Date.now() + DETECT_TIMEOUT_MS;
  const settle = config.settleMs ?? 2500;

  while (Date.now() < deadline) {
    if (captured.length > 0) {
      const ready = config.ready
        ? captured.some((c) => config.ready?.test(c.body))
        : captured.some((c) => c.status < 400);
      if (ready) {
        await page.waitForTimeout(settle);
        return;
      }
    }
    await page.waitForTimeout(700);
  }
}

export interface WebHit {
  url: string;
  title: string;
  snippet: string;
}

function decodeBing(href: string): string {
  const match = /[?&]u=a1([^&]+)/.exec(href);
  if (!match?.[1]) return href;
  try {
    return Buffer.from(match[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return href;
  }
}

export async function searchExact(
  phrases: string[],
  perPhrase: number,
): Promise<Map<string, WebHit[]>> {
  const instance = await browser();
  const context = await instance.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const found = new Map<string, WebHit[]>();

  try {
    for (const phrase of phrases) {
      const query = encodeURIComponent(`"${phrase}"`);
      try {
        await page.goto(`https://www.bing.com/search?q=${query}&setlang=en&cc=US`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page.waitForTimeout(2200);

        const hits = await page.evaluate((take: number) => {
          const body = document.body.innerText;
          if (/There are no results|No results found|Showing results for|Search instead for/i.test(body)) {
            return [];
          }
          return [...document.querySelectorAll("li.b_algo")]
            .slice(0, take)
            .flatMap((li) => {
              const anchor = li.querySelector("h2 a") as HTMLAnchorElement | null;
              if (!anchor) return [];
              const snippet = (li as HTMLElement).innerText.replace(/\s+/g, " ").trim();
              return [{ url: anchor.href, title: anchor.innerText.trim(), snippet }];
            });
        }, perPhrase);

        found.set(
          phrase,
          hits.map((hit) => ({ url: decodeBing(hit.url), title: hit.title, snippet: hit.snippet })),
        );
      } catch {
        found.set(phrase, []);
      }
      await page.waitForTimeout(900);
    }
  } finally {
    await context.close().catch(() => undefined);
  }

  return found;
}
