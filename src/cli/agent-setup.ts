import path from "node:path";
import { BASE_URL, SESSION_FILE } from "../config.js";
import { findBrowser, hasDisplay } from "../auth/browsers.js";
import { importBrowserSession } from "../auth/import-browser.js";
import { captureSession } from "../auth/login.js";
import { parseCookieInput, saveAndVerify } from "../auth/paste.js";
import {
  ENTRY,
  REGISTER_COMMAND,
  ROOT,
  claudeAlreadyRegistered,
  claudeAvailable,
  dependenciesInstalled,
  openSession,
  registerWithClaude,
  runCommand,
  runQuiet,
  sessionWorks,
} from "./shared.js";

const ALLOW_BROWSER = !process.argv.includes("--no-browser");

const COOKIE_INSTRUCTIONS = `Ask the user for their Overleaf session cookie, once, using these words:

  Open https://www.overleaf.com/project in any browser where you are already signed in.
  Press F12, open Application, expand Cookies, select the Overleaf origin, click the
  row named overleaf_session2, and copy the whole Value. It is long and starts with s%3A.

Then run, without echoing the value back to them:

  OVERLEAF_SESSION_COOKIE="<value>" npm run agent-setup`;

function log(kind: "ok" | "warn" | "fail", message: string): void {
  process.stdout.write(`[${kind}] ${message}\n`);
}

function finish(result: string, nextAction: string, code: number): never {
  process.stdout.write(`\nRESULT: ${result}\nNEXT_ACTION: ${nextAction}\n`);
  process.exit(code);
}

async function buildProject(): Promise<void> {
  if (!(await dependenciesInstalled()) && !runCommand("npm", ["install"])) {
    finish("FAILED", "npm install failed, report the output", 1);
  }
  log("ok", "dependencies installed");

  if (!runCommand("npx", ["tsc"])) finish("FAILED", "the build failed, report the compiler output", 1);
  log("ok", `built ${ENTRY}`);

  if (!runQuiet("node", [JSON.stringify(path.join(ROOT, "scripts", "verify-startup.mjs"))])) {
    finish("FAILED", "the server does not start cleanly, run scripts/verify-startup.mjs", 1);
  }
  log("ok", "server starts and exposes its tools");
}

async function acquireSessionFromCookie(cookie: string): Promise<void> {
  try {
    await saveAndVerify(parseCookieInput(cookie));
    log("ok", "session cookie verified and saved");
  } catch (err) {
    log("fail", err instanceof Error ? err.message : String(err));
    finish("NEED_COOKIE", `That cookie was rejected. ${COOKIE_INSTRUCTIONS}`, 2);
  }
}

async function acquireSessionFromBrowser(): Promise<boolean> {
  const browser = findBrowser();
  if (browser) {
    log("ok", `found ${browser.name} as the default browser`);
    try {
      await importBrowserSession(undefined, true);
      if (await sessionWorks()) {
        log("ok", `reused the Overleaf login from ${browser.name}`);
        return true;
      }
    } catch (err) {
      log("warn", err instanceof Error ? err.message : String(err));
    }
  }

  log("warn", "could not reuse an existing login, opening a sign in window");
  try {
    await captureSession();
    return await sessionWorks();
  } catch (err) {
    log("fail", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function acquireSession(): Promise<void> {
  if (await sessionWorks()) {
    log("ok", "existing Overleaf session works");
    return;
  }

  const pasted = process.env.OVERLEAF_SESSION_COOKIE;
  if (pasted) {
    await acquireSessionFromCookie(pasted);
    return;
  }

  if (!hasDisplay() || !ALLOW_BROWSER) {
    log("warn", "no graphical display, so no login window can open here");
    finish("NEED_COOKIE", COOKIE_INSTRUCTIONS, 2);
  }

  if (!(await acquireSessionFromBrowser())) finish("NEED_COOKIE", COOKIE_INSTRUCTIONS, 2);
}

async function verifyAgainstOverleaf(): Promise<void> {
  const { store, client, workspace } = await openSession();
  const projects = (await client.listProjects()).filter((p) => !p.archived && !p.trashed);
  log("ok", `${projects.length} project(s) visible on ${BASE_URL}`);

  const first = projects[0];
  if (first) {
    const tree = await workspace.tree(first.id, true);
    log("ok", `read "${first.name}", ${tree.entries.length} entries`);
  }

  const expiry = store.sessionExpiry();
  if (expiry) {
    const days = (expiry.getTime() - Date.now()) / 86_400_000;
    log("ok", `session valid for ${days.toFixed(1)} more days`);
  }
}

function register(): boolean {
  if (!claudeAvailable()) {
    log("warn", "claude CLI not on PATH, register manually");
    return false;
  }
  if (claudeAlreadyRegistered()) {
    log("ok", "already registered with Claude Code");
    return true;
  }
  const registered = registerWithClaude();
  log(registered ? "ok" : "warn", registered ? "registered with Claude Code" : "registration failed");
  return registered;
}

async function main(): Promise<void> {
  process.stdout.write(`overleaf-claude-mcp agent setup\n${ROOT}\n\n`);

  await buildProject();
  await acquireSession();
  await verifyAgainstOverleaf();
  const registered = register();

  process.stdout.write(`\nsession file: ${SESSION_FILE}\n`);
  finish(
    "READY",
    registered
      ? "Tell the user to restart Claude, then ask it to list their Overleaf projects."
      : `Tell the user to register the server with: ${REGISTER_COMMAND} and then restart Claude.`,
    0,
  );
}

main().catch((err) => {
  process.stdout.write(`[fail] ${err instanceof Error ? err.message : String(err)}\n`);
  finish("FAILED", "report this error to the user", 1);
});
