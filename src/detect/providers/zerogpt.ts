import { countWords, postJson } from "../http.js";
import type { DetectorProvider, DetectorReport } from "../types.js";

const ENDPOINT = "https://api.zerogpt.com/api/detect/detectText";

interface ZeroGptResponse {
  success?: boolean;
  message?: string;
  data?: {
    fakePercentage?: number;
    isHuman?: number;
    textWords?: number;
    aiWords?: number;
    feedback?: string;
    h?: string[];
    detected_language?: string;
  };
}

export const zerogpt: DetectorProvider = {
  name: "zerogpt",
  label: "ZeroGPT",
  maxChars: 14_000,

  available() {
    return true;
  },

  async detect(text: string): Promise<DetectorReport> {
    const body = await postJson<ZeroGptResponse>(
      ENDPOINT,
      { input_text: text },
      { origin: "https://www.zerogpt.com", referer: "https://www.zerogpt.com/" },
    );

    const data = body.data;
    if (!data || typeof data.fakePercentage !== "number") {
      throw new Error(body.message ?? "no detection data in the response");
    }

    return {
      provider: zerogpt.label,
      aiPercentage: data.fakePercentage,
      verdict: data.feedback ?? "",
      flagged: (data.h ?? []).map((sentence) => ({ text: sentence })),
      words: data.textWords ?? countWords(text),
    };
  },
};
