const CITE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*)\s*\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
const REF =
  /\\(?:ref|eqref|autoref|pageref|nameref|vref|Vref|cref|Cref|crefrange|Crefrange|cpageref|Cpageref)\s*\*?\s*\{([^}]*)\}/g;
const LABEL = /\\label\s*\{([^}]*)\}/g;
const ENVIRONMENT = /\\begin\s*\{([^}]*)\}/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

export interface Drift {
  dropped: string[];
  added: string[];
}

export interface Integrity {
  numbers: Drift;
  citations: Drift;
  references: Drift;
  labels: Drift;
  environments: Drift;
}

function keys(value: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );
}

function figures(value: string): string[] {
  const prose = value
    .replace(CITE, " ")
    .replace(REF, " ")
    .replace(LABEL, " ")
    .replace(/\\includegraphics\s*(?:\[[^\]]*\]\s*)*\{[^}]*\}/g, " ");
  return (prose.match(NUMBER) ?? []).map((n) => n.replace(/,+$/, ""));
}

function counted(items: string[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const item of items) seen.set(item, (seen.get(item) ?? 0) + 1);
  return seen;
}

function diff(before: string[], after: string[]): Drift {
  const left = counted(before);
  const right = counted(after);
  const dropped: string[] = [];
  const added: string[] = [];

  for (const [item, count] of left) {
    const missing = count - (right.get(item) ?? 0);
    for (let i = 0; i < missing; i += 1) dropped.push(item);
  }
  for (const [item, count] of right) {
    const extra = count - (left.get(item) ?? 0);
    for (let i = 0; i < extra; i += 1) added.push(item);
  }

  return { dropped: dropped.sort(), added: added.sort() };
}

export function compareIntegrity(before: string, after: string): Integrity {
  return {
    numbers: diff(figures(before), figures(after)),
    citations: diff(keys(before, CITE), keys(after, CITE)),
    references: diff(keys(before, REF), keys(after, REF)),
    labels: diff(keys(before, LABEL), keys(after, LABEL)),
    environments: diff(keys(before, ENVIRONMENT), keys(after, ENVIRONMENT)),
  };
}

export function isClean(integrity: Integrity): boolean {
  return Object.values(integrity).every(
    (drift) => drift.dropped.length === 0 && drift.added.length === 0,
  );
}

function line(kind: string, drift: Drift): string | undefined {
  if (drift.dropped.length === 0 && drift.added.length === 0) return undefined;
  const parts: string[] = [];
  if (drift.dropped.length > 0) parts.push(`removed ${drift.dropped.slice(0, 12).join(", ")}`);
  if (drift.added.length > 0) parts.push(`added ${drift.added.slice(0, 12).join(", ")}`);
  return `  ${kind}: ${parts.join("; ")}`;
}

export function formatIntegrity(integrity: Integrity): string | undefined {
  if (isClean(integrity)) return undefined;

  const lines = [
    line("numbers", integrity.numbers),
    line("citations", integrity.citations),
    line("references", integrity.references),
    line("labels", integrity.labels),
    line("environments", integrity.environments),
  ].filter((value): value is string => value !== undefined);

  return `This edit changed more than wording. Check it before compiling:\n${lines.join("\n")}`;
}
