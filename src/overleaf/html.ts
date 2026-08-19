const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
  "#47": "/",
  nbsp: " ",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const key = entity.toLowerCase();
    const named = NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[key];
    if (named !== undefined) return named;
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

export function readMeta(html: string, name: string): string | null {
  const tagPattern = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*>`, "i");
  const tag = html.match(tagPattern)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([\s\S]*?)["']\s*\/?>?$/i) ?? tag.match(/content=["']([\s\S]*?)["']/i);
  if (!content?.[1]) return null;
  return decodeHtmlEntities(content[1]);
}

export function readMetaJson<T>(html: string, name: string): T | null {
  const raw = readMeta(html, name);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function listMetaNames(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/<meta[^>]*name=["'](ol-[^"']+)["']/gi)) {
    if (match[1]) names.add(match[1]);
  }
  return [...names].sort();
}
