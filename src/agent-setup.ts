import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL, SESSION_FILE } from "./config.js";
import { SessionStore } from "./auth/session.js";
import { hasDisplay, findBrowser } from "./auth/browsers.js";
import { importBrowserSession } from "./auth/import-browser.js";
import { captureSession } from "./auth/login.js";
import { parseCookieInput, saveAndVerify } from "./auth/paste.js";
import { OverleafClient } from "./overleaf/client.js";
import { Workspace } from "./overleaf/workspace.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const ENTRY = path.join(ROOT, "dist", "index.js");

const ALLOW_BROWSER = !process.argv.includes("--no-browser");

function log(kind: "ok" | "warn" | "fail", message: string): void {
  process.stdout.write(`[${kind}] ${message}\n`);
}

function finish(result: string, nextAction: string, code: number): never {
  process.stdout.write(`\nRESULT: ${result}\nNEXT_ACTION: ${nextAction}\n`);
  process.exit(code);
}

function run(command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: true }).status === 0;
}

function quiet(command: string, args: string[]): boolean {
  return spawnSync(command, args, { cwd: ROOT, stdio: "ignore", shell: true }).status === 0;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function sessionWorks(): Promise<boolean> {
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

const COOKIE_INSTRUCTIONS = `Ask the user for their Overleaf session cookie, once, using these words:

  Open https://www.overleaf.com/project in any browser where you are already signed in.
  Press F12, open Application, expand Cookies, select the Overleaf origin, click the
  row named overleaf_session2, and copy the whole Value. It is long and starts with s%3A.

Then run, without echoing the value back to them:

  OVERLEAF_SESSION_COOKIE="<value>" npm run agent-setup`;

async function main(): Promise<void> {
  process.stdout.write(`overleaf-claude-mcp agent setup\n${ROOT}\n\n`);

  if (!(await exists(path.join(ROOT, "node_modules", "@modelcontextprotocol")))) {
    if (!run("npm", ["install"])) finish("FAILED", "npm install failed, report the output", 1);
  }
  log("ok", "dependencies installed");

  if (!run("npx", ["tsc"])) finish("FAILED", "the build failed, report the compiler output", 1);
  log("ok", `built ${ENTRY}`);

  if (!quiet("node", [JSON.stringify(path.join(ROOT, "scripts", "verify-startup.mjs"))])) {
    finish("FAILED", "the server does not start cleanly, run scripts/verify-startup.mjs", 1);
  }
  log("ok", "server starts and exposes its tools");

  if (await sessionWorks()) {
    log("ok", "existing Overleaf session works");
  } else {
    const pasted = process.env.OVERLEAF_SESSION_COOKIE;

    if (pasted) {
      try {
        await saveAndVerify(parseCookieInput(pasted));
        log("ok", "session cookie verified and saved");
      } catch (err) {
        log("fail", err instanceof Error ? err.message : String(err));
        finish("NEED_COOKIE", `That cookie was rejected. ${COOKIE_INSTRUCTIONS}`, 2);
      }
    } else if (!hasDisplay() || !ALLOW_BROWSER) {
      log("warn", "no graphical display, so no login window can open here");
      finish("NEED_COOKIE", COOKIE_INSTRUCTIONS, 2);
    } else {
      const browser = findBrowser();
      let done = false;

      if (browser) {
        log("ok", `found ${browser.name} as the default browser`);
        try {
          await importBrowserSession(undefined, true);
          done = await sessionWorks();
          if (done) log("ok", `reused the Overleaf login from ${browser.name}`);
        } catch (err) {
          log("warn", err instanceof Error ? err.message : String(err));
        }
      }

      if (!done) {
        log("warn", "could not reuse an existing login, opening a sign in window");
        try {
          await captureSession();
          done = await sessionWorks();
        } catch (err) {
          log("fail", err instanceof Error ? err.message : String(err));
        }
      }

      if (!done) finish("NEED_COOKIE", COOKIE_INSTRUCTIONS, 2);
    }
  }

  const store = new SessionStore();
  await store.load();
  const client = new OverleafClient(store);
  const workspace = new Workspace(client);
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

  const hasClaude = quiet("claude", ["--version"]);
  let registered = false;
  if (hasClaude) {
    if (quiet("claude", ["mcp", "get", "overleaf"])) {
      log("ok", "already registered with Claude Code");
      registered = true;
    } else {
      registered = run("claude", ["mcp", "add", "overleaf", "-s", "user", "--", "node", `"${ENTRY}"`]);
      log(registered ? "ok" : "warn", registered ? "registered with Claude Code" : "registration failed");
    }
  } else {
    log("warn", "claude CLI not on PATH, register manually");
  }

  process.stdout.write(`\nsession file: ${SESSION_FILE}\n`);
  finish(
    "READY",
    registered
      ? "Tell the user to restart Claude, then ask it to list their Overleaf projects."
      : `Tell the user to register the server with: claude mcp add overleaf -s user -- node "${ENTRY}" and then restart Claude.`,
    0,
  );
}

main().catch((err) => {
  process.stdout.write(`[fail] ${err instanceof Error ? err.message : String(err)}\n`);
  finish("FAILED", "report this error to the user", 1);
});
