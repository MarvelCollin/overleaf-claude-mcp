import fsp from "node:fs/promises";
import path from "node:path";
import { HOME_DIR } from "./config.js";

export interface ActiveProject {
  id: string;
  name: string;
  selectedAt: string;
}

const STATE_FILE = path.join(HOME_DIR, "state.json");

export class ProjectState {
  private active: ActiveProject | null = null;
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const text = await fsp.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(text) as { active?: ActiveProject };
      this.active = parsed.active ?? null;
    } catch {
      this.active = null;
    }
  }

  async set(project: { id: string; name: string }): Promise<void> {
    this.active = { id: project.id, name: project.name, selectedAt: new Date().toISOString() };
    await fsp.mkdir(HOME_DIR, { recursive: true, mode: 0o700 });
    await fsp.writeFile(STATE_FILE, JSON.stringify({ active: this.active }, null, 2), {
      mode: 0o600,
    });
  }

  get current(): ActiveProject | null {
    return this.active;
  }

  async resolve(explicitId?: string): Promise<string> {
    await this.load();
    if (explicitId) return explicitId;
    if (this.active) return this.active.id;
    throw new Error(
      "No project selected. Call overleaf_select_project first, or pass projectId explicitly.",
    );
  }
}
