import readline from "node:readline/promises";
import { BASE_URL, SESSION_FILE } from "../config.js";
import { captureSession } from "../auth/login.js";
import { importBrowserSession } from "../auth/import-browser.js";
import { parseCookieInput, saveAndVerify } from "../auth/paste.js";
import { hasDisplay } from "../auth/browsers.js";
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
  sessionWorks,
} from "./shared.js";

const PASTE_HELP = `      1. Open https://www.overleaf.com/project in a browser where you are signed in
      2. Press F12, go to Application, expand Cookies, select the Overleaf origin
      3. Copy the whole Value of the cookie named overleaf_session2`;

function step(n: number, label: string): void {
  process.stdout.write(`\n[${n}/5] ${label}\n`);
}

function ok(message: string): void {
  process.stdout.write(`      ${message}\n`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const answer = (await prompt(`${question} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}

async function installAndBuild(): Promise<void> {
  step(1, "Installing dependencies");
  if (await dependenciesInstalled()) {
    ok("already installed");
  } else if (!runCommand("npm", ["install"])) {
    throw new Error("npm install failed");
  }

  step(2, "Building");
  if (!runCommand("npx", ["tsc"])) throw new Error("Build failed");
  ok(ENTRY);
}

async function acquireWithoutDisplay(): Promise<void> {
  ok("this machine has no graphical display, so no login window can open");
  ok("paste your Overleaf session cookie instead:");
  process.stdout.write(`\n${PASTE_HELP}\n`);

  if (process.stdin.isTTY) {
    const pasted = await prompt("      Paste the cookie value, or press Enter to skip: ");
    if (pasted) {
      await saveAndVerify(parseCookieInput(pasted));
      ok("session verified and saved");
    }
  }

  if (!(await sessionWorks())) {
    throw new Error('No session yet. Run: OVERLEAF_SESSION_COOKIE="<value>" npm run login:paste');
  }
}

async function acquireWithDisplay(): Promise<void> {
  let imported = false;
  if (await confirm("      No session yet. Reuse the Overleaf login from your everyday browser?")) {
    ok("that browser must be fully closed for this to work");
    try {
      const count = await importBrowserSession(undefined, true);
      imported = await sessionWorks();
      ok(imported ? `imported ${count} cookies from your browser` : "import produced an unusable session");
    } catch (err) {
      ok(err instanceof Error ? err.message : String(err));
    }
  }

  if (imported) return;

  ok("opening your default browser so you can sign in");
  const count = await captureSession();
  ok(`saved ${count} cookies to ${SESSION_FILE}`);
  if (!(await sessionWorks())) throw new Error("Saved a session but Overleaf still refused it.");
}

async function acquireSession(): Promise<void> {
  step(3, "Checking your Overleaf session");
  if (await sessionWorks()) {
    ok(`existing session at ${SESSION_FILE} still works`);
    return;
  }
  await (hasDisplay() ? acquireWithDisplay() : acquireWithoutDisplay());
}

async function verifyAgainstOverleaf(): Promise<void> {
  step(4, "Verifying against Overleaf");
  const { client, workspace } = await openSession();
  const projects = (await client.listProjects()).filter((p) => !p.archived && !p.trashed);
  ok(`${projects.length} project(s) visible on ${BASE_URL}`);

  const first = projects[0];
  if (!first) return;

  const tree = await workspace.tree(first.id, true);
  const docs = tree.entries.filter((e) => e.type === "doc").length;
  const files = tree.entries.filter((e) => e.type === "file").length;
  ok(`read "${first.name}": ${docs} docs, ${files} binary files`);
}

async function register(): Promise<void> {
  step(5, "Registering with Claude Code");
  if (!claudeAvailable()) {
    ok("claude CLI not found on PATH. Register it yourself with:");
    ok(REGISTER_COMMAND);
    return;
  }
  if (claudeAlreadyRegistered()) {
    ok('already registered as "overleaf"');
    return;
  }
  if (!(await confirm("      Register this server with Claude Code now?"))) {
    ok(`skipped. Register later with: ${REGISTER_COMMAND}`);
    return;
  }
  ok(registerWithClaude() ? "registered" : `registration failed, run it yourself: ${REGISTER_COMMAND}`);
}

async function main(): Promise<void> {
  process.stdout.write(`overleaf-claude-mcp setup\n${ROOT}\n`);

  await installAndBuild();
  await acquireSession();
  await verifyAgainstOverleaf();
  await register();

  process.stdout.write("\nSetup complete. Restart Claude, then ask it to list your Overleaf projects.\n");
}

main().catch((err) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
