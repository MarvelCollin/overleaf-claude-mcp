import { AuthError, SessionStore } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { Workspace } from "./overleaf/workspace.js";
import { ProjectState } from "./state.js";

export class AppContext {
  readonly session: SessionStore;
  readonly client: OverleafClient;
  readonly workspace: Workspace;
  readonly state: ProjectState;

  private sessionLoaded = false;

  constructor() {
    this.session = new SessionStore();
    this.client = new OverleafClient(this.session);
    this.workspace = new Workspace(this.client);
    this.state = new ProjectState();
  }

  async ensureSession(): Promise<void> {
    if (this.sessionLoaded) return;
    const found = await this.session.load();
    if (!found || !this.session.hasSessionCookie()) {
      throw new AuthError(
        `No Overleaf session at ${this.session.filePath}. Run "npm run login" in the overleaf-claude-mcp folder and sign in.`,
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
