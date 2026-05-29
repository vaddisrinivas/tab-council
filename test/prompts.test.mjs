import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDisagreementPrompt,
  buildJsonRepairPrompt,
  buildMarkdownExport,
  buildRatificationPrompt,
  buildRound1Prompt,
  buildRound2Prompt,
  buildSynthesisPrompt
} from "../src/prompts.js";

const memberA = {
  tabId: 1,
  label: "ChatGPT",
  providerLabel: "ChatGPT"
};

const memberB = {
  tabId: 2,
  label: "Claude",
  providerLabel: "Claude"
};

test("round 1 prompt includes run marker and independent instructions", () => {
  const prompt = buildRound1Prompt({ runId: "run-1", prompt: "Pick database.", member: memberA });
  assert.match(prompt, /MODEL_COUNCIL_RUN=run-1/);
  assert.match(prompt, /Answer independently/);
  assert.match(prompt, /Respond ONLY with valid JSON/);
  assert.match(prompt, /"answer"/);
  assert.match(prompt, /"confidence"/);
});

test("round 2 prompt excludes the member's own round 1 answer", () => {
  const prompt = buildRound2Prompt({
    runId: "run-1",
    prompt: "Pick database.",
    member: memberA,
    round1Outputs: [
      { tabId: 1, label: "ChatGPT", ok: true, text: "Use Postgres." },
      {
        tabId: 2,
        label: "Claude",
        ok: true,
        text: "Use SQLite.",
        structured: { answer: "Use SQLite.", confidence: 4 }
      }
    ]
  });

  assert.doesNotMatch(prompt, /Use Postgres/);
  assert.match(prompt, /Use SQLite/);
  assert.match(prompt, /"answer": "Use SQLite."/);
});

test("disagreement prompt asks for exact JSON shape", () => {
  const prompt = buildDisagreementPrompt({
    runId: "run-1",
    prompt: "Pick database.",
    round2Outputs: [{ tabId: 2, label: "Claude", ok: true, text: "Still SQLite." }]
  });

  assert.match(prompt, /"disagree": false/);
  assert.match(prompt, /"reason": "one short sentence"/);
});

test("synthesis prompt includes table contract and available rounds", () => {
  const prompt = buildSynthesisPrompt({
    runId: "run-1",
    prompt: "Pick database.",
    round1Outputs: [{ tabId: 1, label: "ChatGPT", ok: true, text: "Postgres." }],
    round2Outputs: [{ tabId: 2, label: "Claude", ok: true, text: "SQLite." }],
    round3Outputs: []
  });

  assert.match(prompt, /"verdict_table"/);
  assert.match(prompt, /Postgres/);
  assert.match(prompt, /SQLite/);
});

test("ratification prompt asks for ratify or veto JSON", () => {
  const prompt = buildRatificationPrompt({
    runId: "run-1",
    prompt: "Pick database.",
    member: memberB,
    synthesisOutput: {
      label: "ChatGPT",
      ok: true,
      text: '{"final_answer":"Use Postgres."}',
      structured: { final_answer: "Use Postgres.", confidence: 4 }
    }
  });

  assert.match(prompt, /ROUND=RATIFICATION/);
  assert.match(prompt, /"verdict": "RATIFY"/);
  assert.match(prompt, /"veto_clause"/);
  assert.match(prompt, /Use Postgres/);
});

test("markdown export includes structured, raw, failed outputs", () => {
  const markdown = buildMarkdownExport({
    id: "run-1",
    status: "complete",
    phase: "complete",
    createdAt: 0,
    prompt: "Pick database.",
    rounds: {
      round1: {
        outputs: [
          {
            label: "ChatGPT",
            ok: true,
            text: '{ "answer": "Postgres.", "confidence": 4 }',
            structured: { answer: "Postgres.", confidence: 4 }
          },
          { label: "Claude", ok: false, error: "Timed out." }
        ]
      }
    },
    ratification: {
      outputs: [
        {
          label: "Claude",
          ok: true,
          text: '{ "verdict": "RATIFY", "reason": "Accurate.", "confidence": 5 }',
          structured: { verdict: "RATIFY", reason: "Accurate.", confidence: 5 }
        }
      ]
    },
    errors: []
  }, { includeRaw: true });

  assert.match(markdown, /Postgres/);
  assert.match(markdown, /Structured/);
  assert.match(markdown, /Raw transcript/);
  assert.match(markdown, /Failed: Timed out/);
  assert.match(markdown, /Ratify or Veto/);
});

test("markdown export can omit raw transcripts", () => {
  const markdown = buildMarkdownExport({
    id: "run-1",
    status: "complete",
    phase: "complete",
    createdAt: 0,
    prompt: "Pick database.",
    rounds: {
      round1: {
        outputs: [
          {
            label: "ChatGPT",
            ok: true,
            text: '{ "answer": "Postgres.", "confidence": 4 }',
            structured: { answer: "Postgres.", confidence: 4 }
          }
        ]
      }
    },
    disagreementCheck: {
      disagree: false,
      reason: "Aligned.",
      judgeTabId: 1,
      judgeLabel: "ChatGPT",
      rawOutput: {
        label: "ChatGPT",
        ok: true,
        text: "raw disagreement payload",
        structured: { disagree: false, reason: "Aligned." }
      }
    },
    events: [{ at: 0, level: "info", label: "ChatGPT", phase: "round1", message: "Parsed." }],
    errors: []
  }, { includeRaw: false });

  assert.match(markdown, /Structured/);
  assert.doesNotMatch(markdown, /Raw transcript/);
  assert.doesNotMatch(markdown, /Pick database/);
  assert.doesNotMatch(markdown, /raw disagreement payload/);
  assert.match(markdown, /Run Log/);
});

test("JSON repair prompt includes parse error and phase schema", () => {
  const prompt = buildJsonRepairPrompt({
    runId: "run-1",
    phase: "round2",
    parseError: "No valid JSON.",
    badText: "I agree."
  });

  assert.match(prompt, /ROUND=round2:REPAIR/);
  assert.match(prompt, /No valid JSON/);
  assert.match(prompt, /"updated_answer"/);
});
