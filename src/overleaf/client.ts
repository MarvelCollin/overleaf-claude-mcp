import { BASE_URL, USER_AGENT } from "../config.js";
import { AuthError, SessionStore } from "../auth/session.js";
import { listMetaNames, readMeta, readMetaJson } from "./html.js";

export interface ProjectSummary {
  id: string;
  name: string;
  lastUpdated?: string;
  owner?: string;
  archived?: boolean;
  trashed?: boolean;
  accessLevel?: string;
}

export interface CompileOutputFile {
  path: string;
  url: string;
  type?: string;
  build?: string;
}

export interface CompileResult {
  status: string;
  outputFiles: CompileOutputFile[];
  compileGroup?: string;
  clsiServerId?: string;
  raw: unknown;
}

interface RawProject {
  id?: string;
  _id?: string;
  name?: string;
  lastUpdated?: string;
  archived?: boolean;
  trashed?: boolean;
  accessLevel?: string;
  owner?: { email?: string; first_name?: string; last_name?: string };
}

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
  const ownerName = [raw.owner?.first_name, raw.owner?.last_name].filter(Boolean).join(" ").trim();
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

  private resolve(pathname: string): string {
    return pathname.startsWith("http") ? pathname : `${this.baseUrl}${pathname}`;
  }

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const url = this.resolve(pathname);
    const headers = new Headers(init.headers);
    headers.set("cookie", this.session.cookieHeader());
    headers.set("user-agent", USER_AGENT);
    if (!headers.has("accept")) headers.set("accept", "*/*");
    headers.set("referer", this.baseUrl + "/project");

    const response = await fetch(url, { ...init, headers, redirect: "follow" });
    this.session.applyResponse(response);
    await this.session.persist();

    if (response.status === 401 || /\/login/.test(new URL(response.url).pathname)) {
      throw new AuthError(
        `Overleaf redirected to login for ${pathname}. The saved session expired. Run "npm run login".`,
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

  async postJson<T>(pathname: string, body: unknown): Promise<T> {
    const send = async (token: string): Promise<Response> =>
      await this.request(pathname, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify(body ?? {}),
      });

    let response = await send(await this.csrfToken());
    if (response.status === 403) {
      response = await send(await this.csrfToken(true));
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OverleafHttpError(
        `POST ${pathname} failed with ${response.status}`,
        response.status,
        text.slice(0, 2000),
      );
    }
    return (await response.json()) as T;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const html = await this.getHtml("/project");
    const blob = readMetaJson<{ projects?: RawProject[] } | RawProject[]>(
      html,
      "ol-prefetchedProjectsBlob",
    );
    const fromBlob = Array.isArray(blob) ? blob : blob?.projects;
    if (fromBlob?.length) {
      return fromBlob.map(normalizeProject).filter((p): p is ProjectSummary => p !== null);
    }

    const legacy = readMetaJson<RawProject[]>(html, "ol-projects");
    if (legacy?.length) {
      return legacy.map(normalizeProject).filter((p): p is ProjectSummary => p !== null);
    }

    const token = readMeta(html, "ol-csrfToken");
    if (token) this.csrf = token;
    const api = await this.postJson<{ projects?: RawProject[] }>("/api/project", {});
    if (api.projects?.length) {
      return api.projects.map(normalizeProject).filter((p): p is ProjectSummary => p !== null);
    }

    throw new Error(
      `Could not read a project list from /project or /api/project. Meta tags seen: ${
        listMetaNames(html).join(", ") || "none"
      }`,
    );
  }

  async downloadProjectZip(projectId: string): Promise<Buffer> {
    const response = await this.requestOk(`/project/${projectId}/download/zip`, {
      headers: { accept: "application/zip,application/octet-stream" },
    });
    return Buffer.from(await response.arrayBuffer());
  }

  async projectPage(projectId: string): Promise<string> {
    return await this.getHtml(`/project/${projectId}`);
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

    const raw = await this.postJson<{
      status?: string;
      outputFiles?: CompileOutputFile[];
      compileGroup?: string;
      clsiServerId?: string;
    }>(`/project/${projectId}/compile?auto_compile=false`, payload);

    return {
      status: raw.status ?? "unknown",
      outputFiles: raw.outputFiles ?? [],
      compileGroup: raw.compileGroup,
      clsiServerId: raw.clsiServerId,
      raw,
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
