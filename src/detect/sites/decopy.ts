import type { Captured, SiteConfig } from "../browser.js";
import { countWords } from "../http.js";
import type { DetectorReport, FlaggedSentence } from "../types.js";

interface DecopySentence {
  content?: string;
  score?: number;
  text_type?: string;
  why_flagged?: string;
}

interface DecopyJob {
  result?: {
    output?: {
      totalScore?: number;
      sentences?: DecopySentence[];
    };
  };
}

const FLAG_AT = 0.5;

function scale(value: number): number {
  return value <= 1 ? value * 100 : value;
}

function verdictFor(percentage: number): string {
  if (percentage >= 80) return "Decopy rates this as AI generated";
  if (percentage >= 50) return "Decopy rates this as mostly AI generated";
  if (percentage >= 20) return "Decopy rates this as part AI and part human";
  return "Decopy rates this as human written";
}

function latestJob(captured: Captured[]): DecopyJob["result"] {
  const jobs = captured
    .filter((c) => /get-job/.test(c.url) && c.json)
    .map((c) => (c.json as DecopyJob).result)
    .filter((r) => Array.isArray(r?.output?.sentences));
  return jobs[jobs.length - 1];
}

export const decopy: SiteConfig = {
  name: "decopy",
  label: "Decopy",
  url: "https://decopy.ai/ai-detector/",
  maxChars: 12_000,
  input: "textarea:visible, [contenteditable='true']:visible",
  submit: /detect/i,
  avoid: /upload|image|code|humaniz/i,
  capture: /api\/decopy\/ai-detector\//,
  ready: /"sentences"\s*:\s*\[\s*\{/,
  settleMs: 2000,

  parse(captured, text): DetectorReport {
    const output = latestJob(captured)?.output;
    if (!output) throw new Error("Decopy returned no finished job");

    const sentences = output.sentences ?? [];
    const flagged: FlaggedSentence[] = sentences
      .filter((s) => s.content && (s.score ?? 0) >= FLAG_AT)
      .map((s) => ({
        text: s.content as string,
        score: Math.round(scale(s.score ?? 0)),
      }));

    const weight = sentences.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
    const total =
      weight > 0
        ? sentences.reduce((sum, s) => sum + scale(s.score ?? 0) * (s.content?.length ?? 0), 0) /
          weight
        : scale(output.totalScore ?? 0);

    const rounded = Math.round(total * 10) / 10;
    return {
      provider: decopy.label,
      aiPercentage: rounded,
      verdict: verdictFor(rounded),
      flagged,
      words: countWords(text),
    };
  },
};
