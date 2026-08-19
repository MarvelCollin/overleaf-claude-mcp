import fsp from "node:fs/promises";
import path from "node:path";
import { BASE_URL } from "./config.js";
import { loadSessionOrThrow } from "./auth/session.js";
import { OverleafClient } from "./overleaf/client.js";
import { ProjectCache } from "./overleaf/cache.js";
import { listMetaNames, readMeta } from "./overleaf/html.js";

const OUT_DIR = path.resolve("recon-output");

interface Probe {
  name: string;
  ok: boolean;
  detail: unknown;
}

function redact(html: string, secrets: (string | null)[]): string {
  let out = html;
  for (const secret of secrets) {
    if (secret && secret.length > 8) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

async function run(): Promise<void> {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const probes: Probe[] = [];
  const session = await loadSessionOrThrow();
  const client = new OverleafClient(session);

  const projectListHtml = await client.getHtml("/project");
  const csrf = readMeta(projectListHtml, "ol-csrfToken");
  await fsp.writeFile(
    path.join(OUT_DIR, "project-list.html"),
    redact(projectListHtml, [csrf]),
    "utf8",
  );
  probes.push({
    name: "GET /project",
    ok: true,
    detail: { metaTags: listMetaNames(projectListHtml), csrfFound: Boolean(csrf) },
  });

  let projects: Awaited<ReturnType<OverleafClient["listProjects"]>> = [];
  try {
    projects = await client.listProjects();
    probes.push({
      name: "listProjects",
      ok: true,
      detail: { count: projects.length, sample: projects.slice(0, 5) },
    });
  } catch (err) {
    probes.push({ name: "listProjects", ok: false, detail: String(err) });
  }

  const target = process.env.OVERLEAF_RECON_PROJECT_ID ?? projects[0]?.id;
  if (!target) {
    probes.push({ name: "project probes", ok: false, detail: "No project id available" });
  } else {
    try {
      const html = await client.projectPage(target);
      await fsp.writeFile(
        path.join(OUT_DIR, "project-page.html"),
        redact(html, [csrf, readMeta(html, "ol-csrfToken")]),
        "utf8",
      );
      probes.push({
        name: `GET /project/${target}`,
        ok: true,
        detail: { metaTags: listMetaNames(html) },
      });
    } catch (err) {
      probes.push({ name: `GET /project/${target}`, ok: false, detail: String(err) });
    }

    try {
      const cache = new ProjectCache(client);
      const entries = await cache.list(target, true);
      probes.push({
        name: `GET /project/${target}/download/zip`,
        ok: true,
        detail: { entryCount: entries.length, entries: entries.slice(0, 50) },
      });
    } catch (err) {
      probes.push({ name: `GET /project/${target}/download/zip`, ok: false, detail: String(err) });
    }

    for (const candidate of [`/project/${target}/entities`, `/project/${target}/details`]) {
      try {
        const response = await client.request(candidate, { headers: { accept: "application/json" } });
        const body = await response.text();
        probes.push({
          name: `GET ${candidate}`,
          ok: response.ok,
          detail: { status: response.status, body: body.slice(0, 1500) },
        });
      } catch (err) {
        probes.push({ name: `GET ${candidate}`, ok: false, detail: String(err) });
      }
    }

    try {
      const result = await client.compile(target);
      probes.push({
        name: `POST /project/${target}/compile`,
        ok: true,
        detail: {
          status: result.status,
          clsiServerId: result.clsiServerId,
          outputFiles: result.outputFiles.map((f) => ({ path: f.path, url: f.url })),
        },
      });
    } catch (err) {
      probes.push({ name: `POST /project/${target}/compile`, ok: false, detail: String(err) });
    }
  }

  const report = { baseUrl: BASE_URL, ranAt: new Date().toISOString(), probes };
  await fsp.writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");

  for (const probe of probes) {
    process.stdout.write(`${probe.ok ? "OK  " : "FAIL"} ${probe.name}\n`);
  }
  process.stdout.write(`\nFull report: ${path.join(OUT_DIR, "report.json")}\n`);
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
