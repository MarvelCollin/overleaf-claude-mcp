import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore } from "../auth/session.js";
import { OverleafClient } from "../overleaf/client.js";
import { Workspace } from "../overleaf/workspace.js";
import type { SessionTools } from "./types.js";

export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
export const ENTRY = path.join(ROOT, "dist", "index.js");
export const REGISTER_COMMAND = `claude mcp add overleaf -s user -- node "${ENTRY}"`;

export function runCommand(command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: true }).status === 0;
}

export function runQuiet(command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd: ROOT, stdio: "ignore", shell: true }).status === 0;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function dependenciesInstalled(): Promise<boolean> {
  return await exists(path.join(ROOT, "node_modules", "@modelcontextprotocol"));
}

export async function openSession(): Promise<SessionTools> {
  const store = new SessionStore();
  await store.load();
  const client = new OverleafClient(store);
  return { store, client, workspace: new Workspace(client) };
}

export async function sessionWorks(): Promise<boolean> {
  const store = new SessionStore();
  const found = await store.load();
  if (!found || !store.hasSessionCookie()) return false;
  try {
    await new OverleafClient(store).listProjects();
    return true;
  } catch {
    return false;
  }
}

export function claudeAvailable(): boolean {
  return runQuiet("claude", ["--version"]);
}

export function claudeAlreadyRegistered(): boolean {
  return runQuiet("claude", ["mcp", "get", "overleaf"]);
}

export function registerWithClaude(): boolean {
  return runCommand("claude", ["mcp", "add", "overleaf", "-s", "user", "--", "node", `"${ENTRY}"`]);
}
