import { createRequire } from "node:module";

interface Manifest {
  version?: string;
}

function read(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../package.json") as Manifest).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = read();
