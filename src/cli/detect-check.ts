import { chunk } from "../detect/engine.js";
import { formatDetection, formatPlagiarism } from "../detect/format.js";
import { longestRun, sample, sentencesOf, visibleText } from "../detect/plagiarism.js";
import { parseZeroGpt } from "../detect/providers/zerogpt.js";
import { decopy } from "../detect/sites/decopy.js";
import type { DetectResult } from "../detect/engine.js";
import { check, report } from "./shared-checks.js";

const ZEROGPT_AI = {
  success: true,
  data: {
    fakePercentage: 100,
    isHuman: 0,
    textWords: 59,
    aiWords: 59,
    feedback: "Your Text is AI/GPT Generated",
    h: ["The mitochondrion is the powerhouse of the cell.", "It stores energy as ATP."],
  },
};

const ZEROGPT_HUMAN = {
  success: true,
  data: {
    fakePercentage: 0,
    isHuman: 100,
    textWords: 40,
    feedback: "Your Text is Human written",
    h: [],
  },
};

const DECOPY_JOB = {
  url: "https://api.decopy.ai/api/decopy/ai-detector/get-job/abc",
  status: 200,
  body: "{}",
  json: {
    code: 100000,
    result: {
      output: {
        totalScore: 0,
        sentences: [
          { content: "A".repeat(100), score: 0.95, text_type: "AI Text" },
          { content: "B".repeat(100), score: 0.05, text_type: "Human Text" },
        ],
      },
    },
  },
};

const WIKI_PAGE =
  "<html><head><style>p{color:red}</style></head><body><script>var x=1;</script>" +
  "<p>Mitochondria have a double membrane structure and use aerobic respiration " +
  "to generate adenosine triphosphate, which is used throughout the cell.</p></body></html>";

const SENTENCE =
  "Mitochondria have a double membrane structure and use aerobic respiration to generate adenosine triphosphate.";

function run(): void {
  const ai = parseZeroGpt(ZEROGPT_AI, "x");
  check("zerogpt reads the ai percentage", ai.aiPercentage === 100, String(ai.aiPercentage));
  check("zerogpt reads the flagged sentences", ai.flagged.length === 2, JSON.stringify(ai.flagged));
  check("zerogpt keeps the verdict", ai.verdict.includes("AI/GPT Generated"), ai.verdict);

  const human = parseZeroGpt(ZEROGPT_HUMAN, "x");
  check("zerogpt reads a human result", human.aiPercentage === 0, String(human.aiPercentage));
  check("zerogpt flags nothing for human text", human.flagged.length === 0);

  let threw = false;
  try {
    parseZeroGpt({ message: "rate limited" }, "x");
  } catch (err) {
    threw = err instanceof Error && err.message === "rate limited";
  }
  check("zerogpt raises the server message on a bad response", threw);

  const site = decopy.parse([DECOPY_JOB], "x");
  check("decopy averages sentence scores by length", site.aiPercentage === 50, String(site.aiPercentage));
  check("decopy flags only the ai sentence", site.flagged.length === 1, JSON.stringify(site.flagged.length));
  check("decopy scales a 0 to 1 score", site.flagged[0]?.score === 95, String(site.flagged[0]?.score));
  check("decopy ignores a zero totalScore", !site.verdict.includes("human written"), site.verdict);

  let decopyThrew = false;
  try {
    decopy.parse([{ url: "x", status: 200, body: "{}", json: {} }], "x");
  } catch {
    decopyThrew = true;
  }
  check("decopy raises when no job finished", decopyThrew);

  const long = `${"a".repeat(90)}.\n\n${"b".repeat(90)}.\n\n${"c".repeat(90)}.`;
  const pieces = chunk(long, 100);
  check("chunk splits on paragraphs", pieces.length === 3, JSON.stringify(pieces.map((p) => p.length)));
  check("chunk keeps every piece within the limit", pieces.every((p) => p.length <= 100));
  check("chunk leaves short text whole", chunk("short text", 100).length === 1);

  const huge = `${"word ".repeat(60)}. ${"other ".repeat(60)}.`;
  check("chunk splits a long paragraph by sentence", chunk(huge, 200).every((p) => p.length <= 200));

  check("longestRun finds the whole phrase", longestRun("one two three four", "zero one two three four five") === 4);
  check("longestRun ignores punctuation and case", longestRun("One, two THREE!", "x one two three y") === 3);
  check("longestRun returns zero for unrelated text", longestRun("alpha beta gamma", "nothing here") === 0);
  check("longestRun stops at a gap", longestRun("one two nine four", "one two three four") === 2);

  const sentences = sentencesOf(
    `${SENTENCE} Short one. ${"Another long sentence that easily clears the minimum length bar for searching."}`,
  );
  check("sentencesOf keeps long sentences", sentences.length === 2, JSON.stringify(sentences));
  check("sentencesOf drops short sentences", !sentences.some((s) => s === "Short one."));

  const picked = sample(["a", "b", "c", "d", "e", "f"], 3);
  check("sample takes the requested count", picked.length === 3, JSON.stringify(picked));
  check("sample spreads across the input", picked[0] === "a" && picked[2] === "e", JSON.stringify(picked));
  check("sample leaves a small list alone", sample(["a", "b"], 5).length === 2);

  const page = visibleText(WIKI_PAGE);
  check("visibleText drops scripts", !page.includes("var x"), page);
  check("visibleText drops styles", !page.includes("color:red"), page);
  check("visibleText keeps the prose", page.includes("double membrane structure"), page);
  check("longestRun confirms a phrase on a fetched page", longestRun(SENTENCE, page) >= 8, String(longestRun(SENTENCE, page)));

  const result: DetectResult = {
    outcomes: [
      { provider: "ZeroGPT", report: { provider: "ZeroGPT", aiPercentage: 92, verdict: "AI", flagged: [{ text: "One flagged line.", line: 12, path: "main.tex" }] } },
      { provider: "Decopy", error: "timed out" },
      { provider: "Sapling", skipped: "set SAPLING_API_KEY to enable this provider" },
    ],
    words: 100,
    chars: 600,
    consensus: 92,
    agreed: [],
  };
  const rendered = formatDetection(result, "main.tex", 10);
  check("report names the source", rendered.includes("main.tex, 100 words"), rendered);
  check("report bands the consensus", rendered.includes("very likely AI"), rendered);
  check("report shows the failed provider", rendered.includes("failed, timed out"), rendered);
  check("report shows the skipped provider", rendered.includes("skipped, set SAPLING_API_KEY"), rendered);
  check("report locates the flagged sentence", rendered.includes("main.tex:12"), rendered);

  const plagiarism = formatPlagiarism(
    {
      provider: "web search",
      checked: 3,
      matches: [
        { sentence: SENTENCE, url: "https://en.wikipedia.org/wiki/Mitochondria", title: "Mitochondria", similarity: "whole sentence", line: 5, path: "main.tex" },
        { sentence: SENTENCE, url: "https://example.org/copy", title: "Copy", similarity: "9 of 15 words in a row", line: 5, path: "main.tex" },
      ],
      exactMatch: 33.3,
      original: 66.7,
    },
    "main.tex",
    10,
  );
  check("plagiarism groups hits by sentence", (plagiarism.match(/Mitochondria have a double/g) ?? []).length === 1, plagiarism);
  check("plagiarism lists every source url", plagiarism.includes("example.org/copy") && plagiarism.includes("wikipedia.org"), plagiarism);
  check("plagiarism counts matched passages", plagiarism.includes("3 passage(s) searched, 1 found"), plagiarism);
  check("plagiarism reports the original share", plagiarism.includes("66.7% appear original"), plagiarism);

  const clean = formatPlagiarism(
    { provider: "web search", checked: 4, matches: [], exactMatch: 0, original: 100 },
    "main.tex",
    10,
  );
  check("plagiarism says so when nothing matched", clean.includes("No searched passage was found verbatim"), clean);

  report();
}

run();
