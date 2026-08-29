import { locateSentence, normalise } from "./latex-text.js";
import { ALL_PROVIDERS, defaultProviders, providerByName } from "./providers/index.js";
import type {
  DetectorOutcome,
  DetectorProvider,
  DetectorReport,
  FlaggedSentence,
  ProseBlock,
} from "./types.js";

export interface DetectRequest {
  text: string;
  blocks?: ProseBlock[];
  path?: string;
  providers?: string[];
}

export interface DetectResult {
  outcomes: DetectorOutcome[];
  words: number;
  chars: number;
  consensus?: number;
  agreed: FlaggedSentence[];
}

export function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let current = "";

  for (const paragraph of text.split(/\n{2,}/)) {
    for (const piece of splitLong(paragraph, limit)) {
      if (current.length > 0 && current.length + piece.length + 2 > limit) {
        parts.push(current);
        current = piece;
      } else {
        current = current.length > 0 ? `${current}\n\n${piece}` : piece;
      }
    }
  }

  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function splitLong(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > limit && current.length > 0) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence.length > limit ? `${sentence.slice(0, limit)} ` : sentence;
  }

  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function merge(reports: DetectorReport[], provider: DetectorProvider): DetectorReport {
  if (reports.length === 1) return reports[0] as DetectorReport;

  const total = reports.reduce((sum, r) => sum + (r.words ?? 1), 0) || reports.length;
  const weighted = reports.reduce((sum, r) => sum + r.aiPercentage * (r.words ?? 1), 0) / total;

  const seen = new Set<string>();
  const flagged: FlaggedSentence[] = [];
  for (const report of reports) {
    for (const sentence of report.flagged) {
      const key = normalise(sentence.text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      flagged.push(sentence);
    }
  }

  return {
    provider: provider.label,
    aiPercentage: Math.round(weighted * 10) / 10,
    verdict: reports.map((r) => r.verdict).find((v) => v.length > 0) ?? "",
    flagged,
    words: total,
    note: `averaged over ${reports.length} chunks`,
  };
}

async function runProvider(
  provider: DetectorProvider,
  request: DetectRequest,
): Promise<DetectorOutcome> {
  if (!provider.available()) {
    return {
      provider: provider.label,
      skipped: `set ${provider.requires} to enable this provider`,
    };
  }

  try {
    const pieces = chunk(request.text, provider.maxChars);
    const reports: DetectorReport[] = [];
    for (const piece of pieces) {
      reports.push(await provider.detect(piece));
    }

    const report = merge(reports, provider);
    if (request.blocks) {
      for (const sentence of report.flagged) {
        sentence.line = locateSentence(request.blocks, sentence.text);
        sentence.path = request.path;
      }
    }
    return { provider: provider.label, report };
  } catch (err) {
    return { provider: provider.label, error: err instanceof Error ? err.message : String(err) };
  }
}

function agreedSentences(outcomes: DetectorOutcome[]): FlaggedSentence[] {
  const reports = outcomes.flatMap((o) => (o.report ? [o.report] : []));
  if (reports.length < 2) return [];

  const counts = new Map<string, { sentence: FlaggedSentence; hits: number }>();
  for (const report of reports) {
    const seen = new Set<string>();
    for (const sentence of report.flagged) {
      const key = normalise(sentence.text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.hits += 1;
      else counts.set(key, { sentence, hits: 1 });
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => entry.sentence);
}

export async function detect(request: DetectRequest): Promise<DetectResult> {
  const wanted = request.providers?.length
    ? request.providers.flatMap((name) => {
        const found = providerByName(name);
        if (!found) {
          throw new Error(
            `unknown provider "${name}". Known: ${ALL_PROVIDERS.map((p) => p.name).join(", ")}`,
          );
        }
        return [found];
      })
    : defaultProviders();

  const outcomes = await Promise.all(wanted.map((provider) => runProvider(provider, request)));
  const scored = outcomes.flatMap((o) => (o.report ? [o.report.aiPercentage] : []));

  return {
    outcomes,
    words: request.text.split(/\s+/).filter(Boolean).length,
    chars: request.text.length,
    consensus:
      scored.length > 0
        ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
        : undefined,
    agreed: agreedSentences(outcomes),
  };
}
