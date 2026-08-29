import { SITES, siteProvider } from "../sites/index.js";
import type { DetectorProvider } from "../types.js";
import { gptzero } from "./gptzero.js";
import { sapling } from "./sapling.js";
import { zerogpt } from "./zerogpt.js";

export const ALL_PROVIDERS: DetectorProvider[] = [
  zerogpt,
  ...SITES.map(siteProvider),
  sapling,
  gptzero,
];

export function defaultProviders(): DetectorProvider[] {
  return ALL_PROVIDERS.filter((provider) => provider.available());
}

export function providerByName(name: string): DetectorProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.name === name.toLowerCase());
}

export { gptzero, sapling, zerogpt };
