import { AuthError, SessionStore } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { Artifacts } from "./overleaf/artifacts.js";
import { Workspace } from "./overleaf/workspace.js";
import { ProjectState } from "./state.js";

export class AppContext {
  readonly session: SessionStore;
  readonly client: OverleafClient;
  readonly workspace: Workspace;
  readonly artifacts: Artifacts;
  readonly state: ProjectState;

  private sessionLoaded = false;

  constructor() {
    this.session = new SessionStore();
    this.client = new OverleafClient(this.session);
    this.workspace = new Workspace(this.client);
    this.artifacts = new Artifacts(this.client);
    this.state = new ProjectState();
  }

  async ensureSession(): Promise<void> {
    if (this.sessionLoaded) {
      await this.session.reloadIfChanged();
      return;
    }
    const found = await this.session.load();
    if (!found || !this.session.hasSessionCookie()) {
      throw new AuthError(
        `No Overleaf session at ${this.session.filePath}. Call overleaf_set_session with a fresh overleaf_session2 cookie, or run "npm run login" in the overleaf-claude-mcp folder.`,
      );
    }
    this.sessionLoaded = true;
  }

  markSessionLoaded(): void {
    this.sessionLoaded = true;
  }

  async activeProject(projectId?: string): Promise<string> {
    await this.ensureSession();
    return await this.state.resolve(projectId);
  }
}
