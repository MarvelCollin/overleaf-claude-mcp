import { DETECT_TIMEOUT_MS, USER_AGENT } from "../config.js";
import { searchExact, type WebHit } from "./browser.js";
import { locateBlock, normalise } from "./latex-text.js";
import type { PlagiarismMatch, PlagiarismReport, ProseBlock } from "./types.js";

const MIN_LENGTH = 70;
const MAX_LENGTH = 300;
const DEFAULT_QUERIES = 12;
const PER_PHRASE = 3;
const MIN_RUN = 8;

export function longestRun(phrase: string, haystack: string): number {
  const words = normalise(phrase).split(" ").filter(Boolean);
  const hay = normalise(haystack);
  if (words.length === 0 || hay.length === 0) return 0;

  let best = 0;
  for (let start = 0; start < words.length; start += 1) {
    if (words.length - start <= best) break;
    let run = 0;
    while (start + run < words.length) {
      if (!hay.includes(words.slice(start, start + run + 1).join(" "))) break;
      run += 1;
    }
    if (run > best) best = run;
  }
  return best;
}

export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [])
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= MIN_LENGTH);
}

export function sample(items: string[], limit: number): string[] {
  if (items.length <= limit) return items;
  const step = items.length / limit;
  const picked: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const item = items[Math.floor(i * step)];
    if (item) picked.push(item);
  }
  return picked;
}

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/\s+/g, " ");
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(DETECT_TIMEOUT_MS, 20_000));
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain/i.test(type)) return "";
    return visibleText(await response.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function confirm(phrase: string, hits: WebHit[]): Promise<{ hit: WebHit; run: number }[]> {
  const checked = await Promise.all(
    hits.slice(0, PER_PHRASE).map(async (hit) => ({
      hit,
      run: longestRun(phrase, await fetchPage(hit.url)),
    })),
  );
  return checked.filter((entry) => entry.run >= MIN_RUN).sort((a, b) => b.run - a.run);
}

export interface PlagiarismRequest {
  text: string;
  blocks?: ProseBlock[];
  path?: string;
  maxQueries?: number;
}

export async function checkPlagiarism(request: PlagiarismRequest): Promise<PlagiarismReport> {
  const all = sentencesOf(request.text);
  if (all.length === 0) {
    throw new Error(`No sentence of at least ${MIN_LENGTH} characters to search for.`);
  }

  const limit = request.maxQueries ?? DEFAULT_QUERIES;
  const chosen = sample(all, limit).map((s) => s.slice(0, MAX_LENGTH));
  const results = await searchExact(chosen, PER_PHRASE);

  const matches: PlagiarismMatch[] = [];
  for (const phrase of chosen) {
    const hits = results.get(phrase) ?? [];
    if (hits.length === 0) continue;

    const confirmed = await confirm(phrase, hits);
    if (confirmed.length === 0) continue;

    const block = request.blocks ? locateBlock(request.blocks, phrase) : undefined;
    const words = normalise(phrase).split(" ").filter(Boolean).length;
    for (const { hit, run } of confirmed) {
      matches.push({
        sentence: phrase,
        similarity: run >= words ? "whole sentence" : `${run} of ${words} words in a row`,
        url: hit.url,
        title: hit.title,
        line: block?.line,
        path: block?.path ?? request.path,
      });
    }
  }

  const matched = new Set(matches.map((m) => m.sentence)).size;
  const rate = Math.round((matched / chosen.length) * 1000) / 10;

  return {
    provider: "web search, confirmed on the source page",
    checked: chosen.length,
    matches,
    exactMatch: rate,
    original: Math.round((100 - rate) * 10) / 10,
    note:
      all.length > chosen.length
        ? `${all.length} sentences were long enough to search, ${chosen.length} sampled evenly across the text`
        : undefined,
  };
}
