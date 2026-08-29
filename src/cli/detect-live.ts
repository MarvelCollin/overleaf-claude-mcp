import { closeBrowser } from "../detect/browser.js";
import { detect } from "../detect/engine.js";
import { checkPlagiarism } from "../detect/plagiarism.js";
import { defaultProviders } from "../detect/providers/index.js";
import { check, report } from "./shared-checks.js";

const AI_TEXT = [
  "Artificial intelligence has fundamentally transformed the landscape of modern healthcare delivery.",
  "By leveraging advanced machine learning algorithms, clinicians are now able to identify patterns in patient data that would otherwise remain undetected.",
  "Furthermore, predictive analytics enables healthcare providers to anticipate patient deterioration before it occurs, thereby improving outcomes significantly.",
  "In addition, the integration of natural language processing into clinical documentation workflows has substantially reduced administrative burden.",
  "Consequently, it is imperative that healthcare institutions invest strategically in these emerging technologies to remain competitive.",
  "Moreover, the ethical implications of algorithmic decision making must be carefully considered throughout the implementation process.",
].join(" ");

const HUMAN_TEXT = [
  "So I finally got round to fixing the bike on Sunday, which took about four times longer than it should have.",
  "The back wheel had been clicking for weeks and I kept telling myself it was nothing, obviously it was not nothing.",
  "Turns out one of the spokes had gone, and once you take the tyre off you may as well do the whole lot really.",
  "My hands were black by the end of it and I still had to go to the shop for a new inner tube because the old one was shot.",
  "Anyway it rides fine now, though the gears still slip in third if I push it, which is a job for another weekend.",
  "My neighbour watched the entire thing from his garden and offered advice roughly every ninety seconds without once putting his tea down.",
].join(" ");

const COPIED =
  "Mitochondria have a double membrane structure and use aerobic respiration to generate adenosine triphosphate, which is used throughout the cell as a source of chemical energy.";

const ORIGINAL =
  "My neighbour watched the entire bicycle repair from his garden and offered advice roughly every ninety seconds without once putting his tea down.";

async function main(): Promise<void> {
  const ready = defaultProviders();
  process.stdout.write(`live check against: ${ready.map((p) => p.label).join(", ")}\n\n`);
  check("at least one detector is ready", ready.length > 0);

  const ai = await detect({ text: AI_TEXT });
  for (const outcome of ai.outcomes) {
    const score = outcome.report ? `${outcome.report.aiPercentage}%` : (outcome.error ?? "skipped");
    process.stdout.write(`  ai sample   ${outcome.provider}: ${score}\n`);
  }
  check(
    "at least one detector answered on the ai sample",
    ai.outcomes.some((o) => o.report),
    JSON.stringify(ai.outcomes.map((o) => o.error)),
  );
  check("the ai sample scores above 50", (ai.consensus ?? 0) > 50, `consensus ${ai.consensus}`);
  check("the ai sample has flagged sentences", ai.outcomes.some((o) => (o.report?.flagged.length ?? 0) > 0));

  const human = await detect({ text: HUMAN_TEXT });
  for (const outcome of human.outcomes) {
    const score = outcome.report ? `${outcome.report.aiPercentage}%` : (outcome.error ?? "skipped");
    process.stdout.write(`  human sample ${outcome.provider}: ${score}\n`);
  }
  check(
    "at least one detector answered on the human sample",
    human.outcomes.some((o) => o.report),
    JSON.stringify(human.outcomes.map((o) => o.error)),
  );
  check("the human sample scores below 50", (human.consensus ?? 100) < 50, `consensus ${human.consensus}`);
  check(
    "the ai sample scores higher than the human sample",
    (ai.consensus ?? 0) > (human.consensus ?? 0),
    `${ai.consensus} vs ${human.consensus}`,
  );

  const copied = await checkPlagiarism({ text: `${COPIED} ${ORIGINAL}`, maxQueries: 2 });
  for (const match of copied.matches) process.stdout.write(`  match ${match.similarity} ${match.url}\n`);
  check("the copied sentence is found on the web", copied.matches.length > 0, JSON.stringify(copied));
  check(
    "the copied sentence is traced to wikipedia",
    copied.matches.some((m) => /wikipedia\.org/.test(m.url)),
    copied.matches.map((m) => m.url).join(", "),
  );
  check(
    "the original sentence is not reported as copied",
    !copied.matches.some((m) => m.sentence.includes("neighbour watched")),
    copied.matches.map((m) => m.sentence).join(" | "),
  );

  await closeBrowser();
  report();
}

await main();
