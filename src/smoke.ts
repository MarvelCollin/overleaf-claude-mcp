import { loadSessionOrThrow } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { Workspace } from "./overleaf/workspace.js";
import { renderTree } from "./overleaf/tree.js";

const PROJECT_NAME = process.env.OVERLEAF_SMOKE_NAME ?? "claude-mcp-smoketest";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS  ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${label}${detail ? ` :: ${detail}` : ""}\n`);
  }
}

async function run(): Promise<void> {
  const session = await loadSessionOrThrow();
  const client = new OverleafClient(session);
  const workspace = new Workspace(client);

  const created = await client.createProject(PROJECT_NAME);
  const projectId = created.project_id;
  if (!projectId) throw new Error("createProject did not return a project_id");
  process.stdout.write(`Created scratch project ${PROJECT_NAME} (${projectId})\n\n`);

  const initial = await workspace.tree(projectId, true);
  check("joinProject returns a tree", initial.entries.length > 0, renderTree(initial));
  check("root folder id present", Boolean(initial.rootFolderId));

  await workspace.writeText(projectId, "sections/intro.tex", "\\section{Intro}\nVersion ONE.\n");
  const first = await workspace.readText(projectId, "sections/intro.tex");
  check("write then read a nested doc", first.includes("Version ONE"), first);

  const beforeId = (await workspace.entry(projectId, "sections/intro.tex")).id;
  await workspace.writeText(projectId, "sections/intro.tex", "\\section{Intro}\nVersion TWO.\n");
  const second = await workspace.readText(projectId, "sections/intro.tex");
  const afterId = (await workspace.entry(projectId, "sections/intro.tex")).id;
  check("overwrite updates content", second.includes("Version TWO"), second);
  check("overwrite keeps the same entity id", beforeId === afterId, `${beforeId} vs ${afterId}`);

  await workspace.writeText(projectId, "sections/intro.tex", "\\section{Intro}\nVersion TWO.\n");
  const edited = await workspace.readText(projectId, "sections/intro.tex");
  check("doc still readable after repeat write", edited.includes("Version TWO"));

  await workspace.readText(projectId, "sections/intro.tex");
  const introEntry = await workspace.entry(projectId, "sections/intro.tex");
  await client.uploadFile(
    projectId,
    introEntry.parentFolderId,
    "intro.tex",
    Buffer.from("\\section{Intro}\nEdited by somebody else.\n", "utf8"),
    "text/x-tex",
  );
  workspace.invalidate(projectId);

  let blocked = false;
  try {
    await workspace.writeText(projectId, "sections/intro.tex", "\\section{Intro}\nVersion THREE.\n");
  } catch (err) {
    blocked = err instanceof Error && err.message.includes("changed on Overleaf");
  }
  check("stale write is refused", blocked);

  await workspace.writeText(
    projectId,
    "sections/intro.tex",
    "\\section{Intro}\nVersion THREE.\n",
    { force: true },
  );
  const forced = await workspace.readText(projectId, "sections/intro.tex");
  check("forced write goes through", forced.includes("Version THREE"), forced);

  await workspace.writeBinary(projectId, "figures/dot.png", PNG_1PX);
  const image = await workspace.readBinary(projectId, "figures/dot.png");
  check("upload and read back a png", image.length === PNG_1PX.length, `${image.length} bytes`);
  check("png bytes round trip", image.equals(PNG_1PX));

  await workspace.rename(projectId, "sections/intro.tex", "introduction.tex");
  const renamed = await workspace.tree(projectId, true);
  check(
    "rename moved the path",
    renamed.entries.some((e) => e.path === "sections/introduction.tex"),
    renderTree(renamed),
  );

  await workspace.move(projectId, "sections/introduction.tex", "");
  const moved = await workspace.tree(projectId, true);
  check(
    "move relocated to root",
    moved.entries.some((e) => e.path === "introduction.tex"),
    renderTree(moved),
  );

  await workspace.remove(projectId, "introduction.tex");
  const deleted = await workspace.tree(projectId, true);
  check(
    "delete removed the doc",
    !deleted.entries.some((e) => e.path === "introduction.tex"),
    renderTree(deleted),
  );

  const hits = await workspace.grep(projectId, "documentclass");
  check("grep finds documentclass in main.tex", hits.length > 0, JSON.stringify(hits.slice(0, 3)));

  const compile = await client.compile(projectId);
  check("compile succeeds", compile.status === "success", compile.status);
  const pdf = compile.outputFiles.find((f) => f.path.endsWith("output.pdf"));
  check("compile produced a pdf", Boolean(pdf));
  if (pdf) {
    const bytes = await client.fetchOutput(pdf.url, compile.clsiServerId);
    check("pdf downloads", bytes.length > 1000, `${bytes.length} bytes`);
  }

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.stdout.write(
    `Scratch project "${PROJECT_NAME}" (${projectId}) is left in your account. Trash it when you are done.\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
