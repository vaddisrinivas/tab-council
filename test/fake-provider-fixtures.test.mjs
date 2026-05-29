import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDisagreementPrompt,
  buildJsonRepairPrompt,
  buildRatificationPrompt,
  buildRound1Prompt,
  buildRound2Prompt,
  buildRound3Prompt,
  buildSynthesisPrompt
} from "../src/prompts.js";
import {
  detectProviderFromUrl,
  parseCouncilOutput,
  parseDisagreement,
  RUN_PHASES
} from "../src/shared.js";
import {
  answerFor,
  FAKE_PROVIDER_CASES,
  FAKE_PROVIDER_COVERAGE_PLAN,
  FAKE_PROVIDER_MODES,
  providerIdFromPath,
  renderFakeProviderBody
} from "./fixtures/fake-provider-cases.mjs";

const REQUIRED_PROVIDERS = ["chatgpt", "claude", "gemini", "perplexity", "merlin", "grok"];

test("fake provider coverage plan names all no-token providers and modes", () => {
  assert.deepEqual(FAKE_PROVIDER_COVERAGE_PLAN.providers, REQUIRED_PROVIDERS);
  assert.deepEqual(FAKE_PROVIDER_COVERAGE_PLAN.modes, [
    "normal",
    "invalid-json",
    "disagreement",
    "busy",
    "stale"
  ]);
  assert.deepEqual(FAKE_PROVIDER_MODES, FAKE_PROVIDER_COVERAGE_PLAN.modes);
});

test("fake provider DOM fixtures expose selectors used by content adapters", async () => {
  const contentScript = await readFile(new URL("../src/contentScript.js", import.meta.url), "utf8");

  assert.deepEqual(FAKE_PROVIDER_CASES.map((provider) => provider.id), REQUIRED_PROVIDERS);

  for (const provider of FAKE_PROVIDER_CASES) {
    assert.equal(detectProviderFromUrl(provider.sampleUrl).id, provider.id);
    assert.equal(providerIdFromPath(provider.route), provider.id);

    const html = renderFakeProviderBody({ providerId: provider.id });
    for (const [kind, fragment] of Object.entries(provider.fragments)) {
      if (kind === "busy") continue;
      assert.ok(html.includes(fragment), `${provider.id} fixture missing ${fragment}`);
    }

    for (const selector of Object.values(provider.selectors)) {
      assert.ok(contentScript.includes(selector), `${provider.id} selector not in contentScript: ${selector}`);
    }
  }
});

test("content adapter waits for late provider composers before blocking", async () => {
  const contentScript = await readFile(new URL("../src/contentScript.js", import.meta.url), "utf8");

    assert.match(contentScript, /PROBE_COMPOSER_TIMEOUT_MS = 8000/);
    assert.match(contentScript, /await waitForComposer\(PROBE_COMPOSER_TIMEOUT_MS\)/);
    assert.match(contentScript, /await waitForComposer\(PROMPT_COMPOSER_TIMEOUT_MS\)/);
});

test("content adapter exposes best-effort model label detection", async () => {
  const contentScript = await readFile(new URL("../src/contentScript.js", import.meta.url), "utf8");
  const html = renderFakeProviderBody({ providerId: "claude" });

  assert.match(contentScript, /function detectModelLabel/);
  assert.match(contentScript, /data-model-council-model/);
  assert.match(contentScript, /modelLabel/);
  assert.ok(html.includes("Claude Test Model"));
});

test("fake provider answers satisfy every prompt phase contract", () => {
  for (const provider of FAKE_PROVIDER_CASES) {
    for (const [phase, prompt] of phasePrompts(provider)) {
      const parsed = parseCouncilOutput(answerFor(prompt, { providerId: provider.id }), phase);
      assert.equal(parsed.ok, true, `${provider.id} ${phase}: ${parsed.error}`);
    }
  }
});

test("invalid-json mode fails first parse then repair returns phase-valid JSON", () => {
  for (const provider of FAKE_PROVIDER_CASES) {
    for (const [phase, prompt] of phasePrompts(provider)) {
      const badText = answerFor(prompt, { providerId: provider.id, mode: "invalid-json" });
      const failed = parseCouncilOutput(badText, phase);
      assert.equal(failed.ok, false, `${provider.id} ${phase} should fail before repair`);

      const repairPrompt = buildJsonRepairPrompt({
        runId: "fixture-run",
        phase,
        parseError: failed.error,
        badText
      });
      const repaired = parseCouncilOutput(
        answerFor(repairPrompt, { providerId: provider.id, mode: "invalid-json" }),
        phase
      );
      assert.equal(repaired.ok, true, `${provider.id} ${phase} repair: ${repaired.error}`);
    }
  }
});

test("disagreement mode gives round 2 conflict and judge disagreement", () => {
  for (const provider of FAKE_PROVIDER_CASES) {
    const prompts = Object.fromEntries(phasePrompts(provider));

    const round2 = parseCouncilOutput(
      answerFor(prompts[RUN_PHASES.ROUND_2], { providerId: provider.id, mode: "disagreement" }),
      RUN_PHASES.ROUND_2
    );
    assert.equal(round2.ok, true);
    assert.equal(round2.data.changed, true);
    assert.equal(round2.data.disagree.length > 0, true);

    const judge = parseDisagreement(
      answerFor(prompts[RUN_PHASES.DISAGREEMENT_CHECK], { providerId: provider.id, mode: "disagreement" })
    );
    assert.equal(judge.disagree, true);
    assert.match(judge.reason, /unresolved disagreement/i);

    const synthesis = parseCouncilOutput(
      answerFor(prompts[RUN_PHASES.SYNTHESIS], { providerId: provider.id, mode: "disagreement" }),
      RUN_PHASES.SYNTHESIS
    );
    assert.equal(synthesis.ok, true);
    assert.equal(synthesis.data.verdict_table[0].disagree, true);
  }
});

test("busy and stale modes expose deterministic DOM signals", () => {
  for (const provider of FAKE_PROVIDER_CASES) {
    const busyHtml = renderFakeProviderBody({ providerId: provider.id, mode: "busy" });
    assert.ok(busyHtml.includes('data-fake-mode="busy"'));
    assert.ok(busyHtml.includes(provider.fragments.busy), `${provider.id} missing busy fragment`);

    const staleHtml = renderFakeProviderBody({ providerId: provider.id, mode: "stale" });
    assert.ok(staleHtml.includes('data-fake-stale="true"'));
    assert.ok(staleHtml.includes("MODEL_COUNCIL_RUN=old-run"));
    assert.ok(staleHtml.includes(`${provider.label} stale answer`));

    const fresh = parseCouncilOutput(
      answerFor(buildRound1Prompt({ runId: "fresh-run", prompt: "What is 2+2?", member: memberFor(provider) }), {
        providerId: provider.id,
        mode: "stale"
      }),
      RUN_PHASES.ROUND_1
    );
    assert.equal(fresh.ok, true);
    assert.match(fresh.data.key_points[0], /fresh fixture answer/);
  }
});

test("fake AI HTML loads fixture module for route/query driven pages", async () => {
  const html = await readFile(new URL("./fixtures/fake-ai.html", import.meta.url), "utf8");
  assert.match(html, /type="module"/);
  assert.match(html, /fake-provider-cases\.mjs/);
  assert.match(html, /providerIdFromPath\(location\.pathname\)/);
  assert.match(html, /URLSearchParams\(location\.search\)/);
});

function phasePrompts(provider) {
  const member = memberFor(provider);
  const round1Outputs = [
    {
      tabId: 999,
      label: "Other Fixture",
      ok: true,
      text: '{ "answer": "4", "key_points": ["math"], "uncertainty": "", "confidence": 5 }',
      structured: { answer: "4", key_points: ["math"], uncertainty: "", confidence: 5 }
    }
  ];
  const round2Outputs = [
    {
      tabId: 999,
      label: "Other Fixture",
      ok: true,
      text: '{ "updated_answer": "4", "agree": ["math"], "disagree": [], "changed": false, "confidence": 5 }',
      structured: { updated_answer: "4", agree: ["math"], disagree: [], changed: false, confidence: 5 }
    }
  ];

  return [
    [RUN_PHASES.ROUND_1, buildRound1Prompt({ runId: "fixture-run", prompt: "What is 2+2?", member })],
    [
      RUN_PHASES.ROUND_2,
      buildRound2Prompt({ runId: "fixture-run", prompt: "What is 2+2?", member, round1Outputs })
    ],
    [
      RUN_PHASES.ROUND_3,
      buildRound3Prompt({ runId: "fixture-run", prompt: "What is 2+2?", member, round2Outputs })
    ],
    [
      RUN_PHASES.DISAGREEMENT_CHECK,
      buildDisagreementPrompt({ runId: "fixture-run", prompt: "What is 2+2?", round2Outputs })
    ],
    [
      RUN_PHASES.SYNTHESIS,
      buildSynthesisPrompt({
        runId: "fixture-run",
        prompt: "What is 2+2?",
        round1Outputs,
        round2Outputs,
        round3Outputs: []
      })
    ],
    [
      RUN_PHASES.RATIFICATION,
      buildRatificationPrompt({
        runId: "fixture-run",
        prompt: "What is 2+2?",
        member,
        synthesisOutput: {
          tabId: 999,
          label: "Judge Fixture",
          ok: true,
          text: '{ "final_answer": "4", "confidence": 5 }',
          structured: { final_answer: "4", confidence: 5 }
        }
      })
    ]
  ];
}

function memberFor(provider) {
  return {
    tabId: FAKE_PROVIDER_CASES.indexOf(provider) + 1,
    label: provider.label,
    providerLabel: provider.label
  };
}
