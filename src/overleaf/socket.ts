import WebSocket from "ws";
import { BASE_URL, USER_AGENT } from "../config.js";
import type { OverleafClient } from "./client.js";

export interface RawDoc {
  _id: string;
  name: string;
}

export interface RawFileRef {
  _id: string;
  name: string;
  hash?: string;
  created?: string;
}

export interface RawFolder {
  _id: string;
  name: string;
  folders: RawFolder[];
  fileRefs: RawFileRef[];
  docs: RawDoc[];
}

export interface JoinedProject {
  _id: string;
  name: string;
  rootDoc_id?: string;
  rootFolder: RawFolder[];
  compiler?: string;
  imageName?: string;
  spellCheckLanguage?: string;
  publicAccesLevel?: string;
}

export interface JoinProjectResult {
  project: JoinedProject;
  permissionsLevel: string;
  protocolVersion: number;
}

const JOIN_TIMEOUT_MS = Number(process.env.OVERLEAF_SOCKET_TIMEOUT_MS ?? 20_000);

function websocketUrl(sid: string, projectId: string): string {
  const url = new URL(BASE_URL);
  const scheme = url.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${url.host}/socket.io/1/websocket/${sid}?projectId=${projectId}`;
}

export async function joinProject(
  client: OverleafClient,
  projectId: string,
): Promise<JoinProjectResult> {
  const handshake = await client.request(
    `/socket.io/1/?projectId=${encodeURIComponent(projectId)}&t=${Date.now()}`,
    { headers: { accept: "text/plain" } },
  );
  if (!handshake.ok) {
    throw new Error(`Socket handshake failed with ${handshake.status} for project ${projectId}`);
  }
  const body = await handshake.text();
  const sid = body.split(":")[0];
  if (!sid) throw new Error(`Socket handshake returned an unexpected body: ${body.slice(0, 120)}`);

  return await new Promise<JoinProjectResult>((resolve, reject) => {
    const ws = new WebSocket(websocketUrl(sid, projectId), {
      headers: {
        cookie: client.cookieHeader(),
        origin: BASE_URL,
        "user-agent": USER_AGENT,
      },
    });

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* nothing to do */
      }
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Timed out joining project ${projectId}`))),
      JOIN_TIMEOUT_MS,
    );

    ws.on("message", (data) => {
      const frame = data.toString();
      if (frame.startsWith("2::")) {
        ws.send("2::");
        return;
      }
      if (!frame.startsWith("5:::")) return;

      let message: { name?: string; args?: unknown[] };
      try {
        message = JSON.parse(frame.slice(4));
      } catch {
        return;
      }

      if (message.name === "connectionRejected") {
        const detail = JSON.stringify(message.args?.[0] ?? {});
        finish(() => reject(new Error(`Overleaf rejected the socket connection: ${detail}`)));
        return;
      }
      if (message.name === "joinProjectResponse") {
        const payload = message.args?.[0] as JoinProjectResult | undefined;
        if (!payload?.project) {
          finish(() => reject(new Error("joinProjectResponse arrived without a project payload")));
          return;
        }
        finish(() => resolve(payload));
      }
    });

    ws.on("error", (err) => finish(() => reject(err)));
    ws.on("close", () =>
      finish(() => reject(new Error(`Socket closed before joining project ${projectId}`))),
    );
  });
}
