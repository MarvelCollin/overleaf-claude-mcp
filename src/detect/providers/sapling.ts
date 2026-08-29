import { SAPLING_API_KEY } from "../../config.js";
import { countWords, postJson } from "../http.js";
import type { DetectorProvider, DetectorReport } from "../types.js";

const ENDPOINT = "https://api.sapling.ai/api/v1/aidetect";
const FLAG_AT = 0.6;

interface SaplingResponse {
  score?: number;
  sentence_scores?: { sentence?: string; score?: number }[];
  msg?: string;
}

function verdictFor(score: number): string {
  if (score >= 0.8) return "Sapling rates this as AI generated";
  if (score >= 0.4) return "Sapling rates this as mixed";
  return "Sapling rates this as human written";
}

export const sapling: DetectorProvider = {
  name: "sapling",
  label: "Sapling",
  maxChars: 100_000,
  requires: "SAPLING_API_KEY",

  available() {
    return SAPLING_API_KEY.length > 0;
  },

  async detect(text: string): Promise<DetectorReport> {
    const body = await postJson<SaplingResponse>(ENDPOINT, {
      key: SAPLING_API_KEY,
      text,
      sent_scores: true,
    });

    if (typeof body.score !== "number") {
      throw new Error(body.msg ?? "no score in the response");
    }

    const flagged = (body.sentence_scores ?? [])
      .filter((s) => (s.score ?? 0) >= FLAG_AT && s.sentence)
      .map((s) => ({ text: s.sentence as string, score: Math.round((s.score ?? 0) * 100) }));

    return {
      provider: sapling.label,
      aiPercentage: body.score * 100,
      verdict: verdictFor(body.score),
      flagged,
      words: countWords(text),
    };
  },
};
