import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { BASE_URL, SESSION_FILE } from "./config.js";
import { SessionStore } from "./auth/session.js";
import { captureSession } from "./auth/login.js";
import { importBrowserSession } from "./auth/import-browser.js";
import { parseCookieInput, saveAndVerify } from "./auth/paste.js";
import { hasDisplay } from "./auth/browsers.js";

const PASTE_HELP = `      1. Open https://www.overleaf.com/project in a browser where you are signed in
      2. Press F12, go to Application, expand Cookies, select the Overleaf origin
      3. Copy the whole Value of the cookie named overleaf_session2`;
import { OverleafClient } from "./overleaf/client.js";
import { Workspace } from "./overleaf/workspace.js";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const ENTRY = path.join(ROOT, "dist", "index.js");

function step(n: number, label: string): void {
  process.stdout.write(`\n[${n}/5] ${label}\n`);
}

function ok(message: string): void {
  process.stdout.write(`      ${message}\n`);
}

function run(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: true });
  return result.status === 0;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
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

async function main(): Promise<void> {
  process.stdout.write(`overleaf-claude-mcp setup\n${ROOT}\n`);

  step(1, "Installing dependencies");
  if (await exists(path.join(ROOT, "node_modules", "@modelcontextprotocol"))) {
    ok("already installed");
  } else if (!run("npm", ["install"])) {
    throw new Error("npm install failed");
  }

  step(2, "Building");
  if (!run("npx", ["tsc"])) throw new Error("Build failed");
  ok(ENTRY);

  step(3, "Checking your Overleaf session");
  if (await sessionWorks()) {
    ok(`existing session at ${SESSION_FILE} still works`);
  } else {
    if (!hasDisplay()) {
      ok("this machine has no graphical display, so no login window can open");
      ok("paste your Overleaf session cookie instead:");
      process.stdout.write(`\n${PASTE_HELP}\n`);

      if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const pasted = await rl.question("      Paste the cookie value, or press Enter to skip: ");
        rl.close();
        if (pasted.trim()) {
          await saveAndVerify(parseCookieInput(pasted));
          ok("session verified and saved");
        }
      }

      if (!(await sessionWorks())) {
        throw new Error(
          'No session yet. Run: OVERLEAF_SESSION_COOKIE="<value>" npm run login:paste',
        );
      }
    } else {
    let imported = false;
    if (await ask("      No session yet. Reuse the Overleaf login from your everyday browser?")) {
      ok("that browser must be fully closed for this to work");
      try {
        const count = await importBrowserSession(undefined, true);
        imported = await sessionWorks();
        ok(imported ? `imported ${count} cookies from your browser` : "import produced an unusable session");
      } catch (err) {
        ok(err instanceof Error ? err.message : String(err));
      }
    }

    if (!imported) {
      ok("opening your default browser so you can sign in");
      const count = await captureSession();
      ok(`saved ${count} cookies to ${SESSION_FILE}`);
      if (!(await sessionWorks())) throw new Error("Saved a session but Overleaf still refused it.");
    }
    }
  }

  step(4, "Verifying against Overleaf");
  const store = new SessionStore();
  await store.load();
  const client = new OverleafClient(store);
  const workspace = new Workspace(client);
  const projects = (await client.listProjects()).filter((p) => !p.archived && !p.trashed);
  ok(`${projects.length} project(s) visible on ${BASE_URL}`);
  const first = projects[0];
  if (first) {
    const tree = await workspace.tree(first.id, true);
    const docs = tree.entries.filter((e) => e.type === "doc").length;
    const files = tree.entries.filter((e) => e.type === "file").length;
    ok(`read "${first.name}": ${docs} docs, ${files} binary files`);
  }

  step(5, "Registering with Claude Code");
  const command = `claude mcp add overleaf -s user -- node "${ENTRY}"`;
  const claudeVersion = spawnSync("claude", ["--version"], { shell: true, stdio: "ignore" });

  if (claudeVersion.status !== 0) {
    ok("claude CLI not found on PATH. Register it yourself with:");
    ok(command);
  } else if (spawnSync("claude", ["mcp", "get", "overleaf"], { shell: true, stdio: "ignore" }).status === 0) {
    ok("already registered as \"overleaf\"");
  } else if (await ask("      Register this server with Claude Code now?")) {
    const registered = spawnSync(
      "claude",
      ["mcp", "add", "overleaf", "-s", "user", "--", "node", `"${ENTRY}"`],
      { cwd: ROOT, stdio: "inherit", shell: true },
    ).status === 0;
    ok(registered ? "registered" : `registration failed, run it yourself: ${command}`);
  } else {
    ok(`skipped. Register later with: ${command}`);
  }

  process.stdout.write("\nSetup complete. Restart Claude, then ask it to list your Overleaf projects.\n");
}

main().catch((err) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
