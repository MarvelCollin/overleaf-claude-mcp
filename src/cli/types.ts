import type { SessionStore } from "../auth/session.js";
import type { OverleafClient } from "../overleaf/client.js";
import type { Workspace } from "../overleaf/workspace.js";

export interface SessionTools {
  store: SessionStore;
  client: OverleafClient;
  workspace: Workspace;
}

export interface Probe {
  name: string;
  ok: boolean;
  detail: unknown;
}

export interface CallOutcome {
  ok: boolean;
  body: string;
  images: number;
}
