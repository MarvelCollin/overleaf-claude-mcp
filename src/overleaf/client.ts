import { BASE_URL, USER_AGENT } from "../config.js";
import { AuthError, SessionStore } from "../auth/session.js";
import { listMetaNames, readMeta, readMetaJson } from "./html.js";
import type {
  CompileOutputFile,
  CompileResult,
  DiffSegment,
  EntitiesResult,
  EntityType,
  ProjectSummary,
  RawProject,
  UpdatesResult,
  UploadResult,
} from "./types.js";

export class OverleafHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "OverleafHttpError";
  }
}

function normalizeProject(raw: RawProject): ProjectSummary | null {
  const id = raw.id ?? raw._id;
  if (!id) return null;
  const ownerName = [raw.owner?.firstName, raw.owner?.lastName].filter(Boolean).join(" ").trim();
  return {
    id,
    name: raw.name ?? "(untitled)",
    lastUpdated: raw.lastUpdated,
    owner: ownerName || raw.owner?.email,
    archived: raw.archived,
    trashed: raw.trashed,
    accessLevel: raw.accessLevel,
  };
}

export class OverleafClient {
  private csrf: string | null = null;

  constructor(
    private readonly session: SessionStore,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  cookieHeader(): string {
    return this.session.cookieHeader();
  }

  private resolve(pathname: string): string {
    return pathname.startsWith("http") ? pathname : `${this.baseUrl}${pathname}`;
  }

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("cookie", this.session.cookieHeader());
    headers.set("user-agent", USER_AGENT);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    headers.set("referer", `${this.baseUrl}/project`);

    const response = await fetch(this.resolve(pathname), { ...init, headers, redirect: "follow" });
    this.session.applyResponse(response);
    await this.session.persist();

    if (response.status === 401 || new URL(response.url).pathname.startsWith("/login")) {
      throw new AuthError(
        `Overleaf redirected to login for ${pathname}. The saved session expired. Call overleaf_set_session with a fresh overleaf_session2 cookie, or run "npm run login".`,
      );
    }
    return response;
  }

  private async requestOk(pathname: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.request(pathname, init);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OverleafHttpError(
        `${init.method ?? "GET"} ${pathname} failed with ${response.status}`,
        response.status,
        body.slice(0, 2000),
      );
    }
    return response;
  }

  async getHtml(pathname: string): Promise<string> {
    const response = await this.requestOk(pathname, {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    return await response.text();
  }

  async csrfToken(force = false): Promise<string> {
    if (this.csrf && !force) return this.csrf;
    const html = await this.getHtml("/project");
    const token = readMeta(html, "ol-csrfToken");
    if (!token) {
      throw new Error(
        `Could not find ol-csrfToken on /project. Meta tags seen: ${listMetaNames(html).join(", ") || "none"}`,
      );
    }
    this.csrf = token;
    return token;
  }

  private async withCsrf(
    pathname: string,
    build: (token: string) => RequestInit,
  ): Promise<Response> {
    const firstAttempt = build(await this.csrfToken());
    let response = await this.request(pathname, firstAttempt);
    if (response.status === 403) {
      response = await this.request(pathname, build(await this.csrfToken(true)));
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OverleafHttpError(
        `${firstAttempt.method ?? "POST"} ${pathname} failed with ${response.status}`,
        response.status,
        body.slice(0, 2000),
      );
    }
    return response;
  }

  private async sendJson<T>(
    pathname: string,
    method: "POST" | "DELETE",
    body?: unknown,
  ): Promise<T> {
    const response = await this.withCsrf(pathname, (token) => ({
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await response.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const html = await this.getHtml("/project");
    const token = readMeta(html, "ol-csrfToken");
    if (token) this.csrf = token;

    const blob = readMetaJson<{ projects?: RawProject[] }>(html, "ol-prefetchedProjectsBlob");
    const projects = blob?.projects ?? readMetaJson<RawProject[]>(html, "ol-projects") ?? undefined;
    if (projects?.length) {
      return projects.map(normalizeProject).filter((p): p is ProjectSummary => p !== null);
    }

    const api = await this.sendJson<{ projects?: RawProject[] }>("/api/project", "POST", {});
    if (api.projects?.length) {
      return api.projects.map(normalizeProject).filter((p): p is ProjectSummary => p !== null);
    }

    throw new Error(
      `Could not read a project list. Meta tags seen: ${listMetaNames(html).join(", ") || "none"}`,
    );
  }

  async createProject(name: string, template = "none"): Promise<{ project_id?: string }> {
    return await this.sendJson<{ project_id?: string }>("/project/new", "POST", {
      _csrf: await this.csrfToken(),
      projectName: name,
      template,
    });
  }

  async entities(projectId: string): Promise<EntitiesResult> {
    const response = await this.requestOk(`/project/${projectId}/entities`, {
      headers: { accept: "application/json" },
    });
    return (await response.json()) as EntitiesResult;
  }

  async downloadProjectZip(projectId: string): Promise<Buffer> {
    const response = await this.requestOk(`/project/${projectId}/download/zip`, {
      headers: { accept: "application/zip,application/octet-stream" },
    });
    return Buffer.from(await response.arrayBuffer());
  }

  async readDoc(projectId: string, docId: string): Promise<string> {
    const response = await this.requestOk(`/project/${projectId}/doc/${docId}/download`, {
      headers: { accept: "text/plain" },
    });
    return await response.text();
  }

  async readBlob(projectId: string, hash: string): Promise<Buffer> {
    const response = await this.requestOk(`/project/${projectId}/blob/${hash}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadFile(
    projectId: string,
    folderId: string,
    fileName: string,
    contents: Buffer | Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<UploadResult> {
    const bytes = new Uint8Array(contents);
    const response = await this.withCsrf(
      `/project/${projectId}/upload?folder_id=${encodeURIComponent(folderId)}`,
      (token) => {
        const form = new FormData();
        form.set("relativePath", "null");
        form.set("name", fileName);
        form.set("type", contentType);
        form.set("qqfile", new Blob([bytes], { type: contentType }), fileName);
        return {
          method: "POST",
          headers: { accept: "application/json", "x-csrf-token": token },
          body: form,
        };
      },
    );
    return (await response.json()) as UploadResult;
  }

  async createEntity(
    projectId: string,
    type: "doc" | "folder",
    name: string,
    parentFolderId: string,
  ): Promise<{ _id?: string; name?: string }> {
    return await this.sendJson(`/project/${projectId}/${type}`, "POST", {
      name,
      parent_folder_id: parentFolderId,
    });
  }

  async deleteEntity(projectId: string, type: EntityType, entityId: string): Promise<void> {
    await this.sendJson(`/project/${projectId}/${type}/${entityId}`, "DELETE");
  }

  async renameEntity(
    projectId: string,
    type: EntityType,
    entityId: string,
    name: string,
  ): Promise<void> {
    await this.sendJson(`/project/${projectId}/${type}/${entityId}/rename`, "POST", { name });
  }

  async moveEntity(
    projectId: string,
    type: EntityType,
    entityId: string,
    folderId: string,
  ): Promise<void> {
    await this.sendJson(`/project/${projectId}/${type}/${entityId}/move`, "POST", {
      folder_id: folderId,
    });
  }

  async updates(projectId: string, minCount = 10): Promise<UpdatesResult> {
    const response = await this.requestOk(
      `/project/${projectId}/updates?min_count=${minCount}`,
      { headers: { accept: "application/json" } },
    );
    return (await response.json()) as UpdatesResult;
  }

  async diff(
    projectId: string,
    pathname: string,
    from: number,
    to: number,
  ): Promise<DiffSegment[]> {
    const query = new URLSearchParams({
      pathname,
      from: String(from),
      to: String(to),
    });
    const response = await this.requestOk(`/project/${projectId}/diff?${query.toString()}`, {
      headers: { accept: "application/json" },
    });
    const body = (await response.json()) as { diff?: DiffSegment[] };
    return body.diff ?? [];
  }

  async wordCount(projectId: string): Promise<unknown> {
    const response = await this.requestOk(`/project/${projectId}/wordcount`, {
      headers: { accept: "application/json" },
    });
    return await response.json();
  }

  async compile(
    projectId: string,
    options: { rootDocId?: string; draft?: boolean; stopOnFirstError?: boolean } = {},
  ): Promise<CompileResult> {
    const payload: Record<string, unknown> = {
      check: "silent",
      draft: options.draft ?? false,
      incrementalCompilesEnabled: true,
      stopOnFirstError: options.stopOnFirstError ?? false,
    };
    if (options.rootDocId) payload.rootDoc_id = options.rootDocId;

    const raw = await this.sendJson<{
      status?: string;
      outputFiles?: CompileOutputFile[];
      compileGroup?: string;
      clsiServerId?: string;
    }>(`/project/${projectId}/compile?auto_compile=false`, "POST", payload);

    return {
      status: raw.status ?? "unknown",
      outputFiles: raw.outputFiles ?? [],
      compileGroup: raw.compileGroup,
      clsiServerId: raw.clsiServerId,
    };
  }

  async fetchOutput(url: string, clsiServerId?: string): Promise<Buffer> {
    const target = clsiServerId
      ? `${url}${url.includes("?") ? "&" : "?"}clsiserverid=${encodeURIComponent(clsiServerId)}`
      : url;
    const response = await this.requestOk(target);
    return Buffer.from(await response.arrayBuffer());
  }
}
