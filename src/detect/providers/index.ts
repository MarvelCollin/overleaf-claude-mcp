import type { DetectorProvider } from "../types.js";
import { gptzero } from "./gptzero.js";
import { sapling } from "./sapling.js";
import { zerogpt } from "./zerogpt.js";

export const PROVIDERS: DetectorProvider[] = [zerogpt, sapling, gptzero];

export function providerByName(name: string): DetectorProvider | undefined {
  return PROVIDERS.find((p) => p.name === name.toLowerCase());
}

export { gptzero, sapling, zerogpt };
