import { GPTZERO_API_KEY } from "../../config.js";
import { countWords, postJson } from "../http.js";
import type { DetectorProvider, DetectorReport } from "../types.js";

const ENDPOINT = "https://api.gptzero.me/v2/predict/text";

interface GptZeroSentence {
  sentence?: string;
  generated_prob?: number;
  highlight_sentence_for_ai?: boolean;
}

interface GptZeroResponse {
  documents?: {
    class_probabilities?: { ai?: number; human?: number; mixed?: number };
    document_classification?: string;
    confidence_category?: string;
    sentences?: GptZeroSentence[];
  }[];
  error?: string;
}

const CLASSIFICATION: Record<string, string> = {
  AI_ONLY: "GPTZero rates this as entirely AI generated",
  MIXED: "GPTZero rates this as part human and part AI",
  HUMAN_ONLY: "GPTZero rates this as entirely human written",
};

export const gptzero: DetectorProvider = {
  name: "gptzero",
  label: "GPTZero",
  maxChars: 50_000,
  requires: "GPTZERO_API_KEY",

  available() {
    return GPTZERO_API_KEY.length > 0;
  },

  async detect(text: string): Promise<DetectorReport> {
    const body = await postJson<GptZeroResponse>(
      ENDPOINT,
      { document: text, multilingual: false },
      { "x-api-key": GPTZERO_API_KEY },
    );

    const document = body.documents?.[0];
    const ai = document?.class_probabilities?.ai;
    if (!document || typeof ai !== "number") {
      throw new Error(body.error ?? "no document in the response");
    }

    const classification = document.document_classification ?? "";
    const confidence = document.confidence_category;
    const verdict = CLASSIFICATION[classification] ?? classification;

    const flagged = (document.sentences ?? [])
      .filter((s) => s.highlight_sentence_for_ai && s.sentence)
      .map((s) => ({
        text: s.sentence as string,
        score: Math.round((s.generated_prob ?? 0) * 100),
      }));

    return {
      provider: gptzero.label,
      aiPercentage: ai * 100,
      verdict: confidence ? `${verdict} (${confidence} confidence)` : verdict,
      flagged,
      words: countWords(text),
    };
  },
};
