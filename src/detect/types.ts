export interface ProseBlock {
  text: string;
  line: number;
  path?: string;
}

export interface ProseDocument {
  blocks: ProseBlock[];
  text: string;
}

export interface FlaggedSentence {
  text: string;
  score?: number;
  line?: number;
  path?: string;
}

export interface DetectorReport {
  provider: string;
  aiPercentage: number;
  verdict: string;
  flagged: FlaggedSentence[];
  words?: number;
  note?: string;
}

export interface DetectorOutcome {
  provider: string;
  report?: DetectorReport;
  error?: string;
  skipped?: string;
}

export interface DetectorProvider {
  name: string;
  label: string;
  maxChars: number;
  requires?: string;
  available(): boolean;
  detect(text: string): Promise<DetectorReport>;
}

export interface PlagiarismMatch {
  sentence: string;
  line?: number;
  path?: string;
  url: string;
  title: string;
  similarity: string;
  matched?: string;
}

export interface PlagiarismReport {
  provider: string;
  checked: number;
  matches: PlagiarismMatch[];
  exactMatch?: number;
  partialMatch?: number;
  original?: number;
  note?: string;
}
