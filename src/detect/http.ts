import { DETECT_TIMEOUT_MS, USER_AGENT } from "../config.js";

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${raw.slice(0, 300)}`);
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`response was not JSON: ${raw.slice(0, 300)}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timed out after ${DETECT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
