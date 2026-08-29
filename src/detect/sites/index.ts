import { runSite, type SiteConfig } from "../browser.js";
import type { DetectorProvider } from "../types.js";
import { decopy } from "./decopy.js";

export function siteProvider(config: SiteConfig): DetectorProvider {
  return {
    name: config.name,
    label: config.label,
    maxChars: config.maxChars,
    available: () => true,
    detect: (text: string) => runSite(config, text),
  };
}

export const SITES: SiteConfig[] = [decopy];

export { decopy };
