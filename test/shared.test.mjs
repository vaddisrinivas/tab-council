import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseJudgeMember,
  canAutomateRole,
  detectProviderFromUrl,
  getNewThreadUrl,
  isCouncilGroup,
  normalizeSettings,
  roleForTab,
  isRoundRole,
  originPatternForUrl,
  parseCouncilOutput,
  parseDisagreement,
  permissionOriginsForTabs,
  permissionOriginsForUrl
} from "../src/shared.js";

test("normalizes tab-council tab group names", () => {
  assert.equal(isCouncilGroup({ title: "tab-council" }), true);
  assert.equal(isCouncilGroup({ title: "  TAB-COUNCIL  " }), true);
  assert.equal(isCouncilGroup({ title: "tab council" }), false);
  assert.equal(isCouncilGroup({ title: "model-council" }), false);
});

test("detects known providers and generic AI tabs by URL", () => {
  assert.equal(detectProviderFromUrl("https://chatgpt.com/c/123").id, "chatgpt");
  assert.equal(detectProviderFromUrl("https://claude.ai/chat/123").id, "claude");
  assert.equal(detectProviderFromUrl("https://gemini.google.com/app").id, "gemini");
  assert.equal(detectProviderFromUrl("https://www.perplexity.ai/search/foo").id, "perplexity");
  assert.equal(detectProviderFromUrl("https://extension.getmerlin.in/chat").id, "merlin");
  assert.equal(detectProviderFromUrl("https://www.getmerlin.in/chat").id, "merlin");
  assert.equal(detectProviderFromUrl("https://grok.com/chat").id, "grok");
  assert.equal(detectProviderFromUrl("https://example.com/ai").id, "generic");
  assert.equal(detectProviderFromUrl("chrome://extensions"), null);
});

test("creates host permission patterns", () => {
  assert.equal(originPatternForUrl("https://chatgpt.com/c/123"), "https://chatgpt.com/*");
  assert.equal(originPatternForUrl("https://www.perplexity.ai/search/foo"), "https://www.perplexity.ai/*");
  assert.equal(originPatternForUrl("https://extension.getmerlin.in/chat"), "https://extension.getmerlin.in/*");
  assert.equal(originPatternForUrl("https://example.com/path"), "https://example.com/*");
  assert.equal(originPatternForUrl("http://localhost:5173/fake-ai"), "http://localhost/*");
  assert.equal(originPatternForUrl("chrome://extensions"), null);
});

test("returns provider new-thread URLs and normalized settings", () => {
  assert.equal(getNewThreadUrl("chatgpt"), "https://chatgpt.com/");
  assert.equal(getNewThreadUrl("merlin"), "https://extension.getmerlin.in/chat");
  assert.equal(getNewThreadUrl("generic"), "");
  assert.deepEqual(normalizeSettings({ isolateThreads: false }), {
    isolateThreads: false,
    includeRawInExport: false,
    councilMode: "balanced",
    ratifyEnabled: false,
    viewMode: "grid",
    memberRoles: {},
    maxRepairAttempts: 1
  });
});

test("normalizes per-tab roles for model selection", () => {
  const settings = normalizeSettings({
    memberRoles: {
      101: "judge",
      102: "validator",
      103: "wat"
    }
  });

  assert.equal(roleForTab(101, settings), "judge");
  assert.equal(roleForTab(102, settings), "validator");
  assert.equal(roleForTab(103, settings), "member");
  assert.equal(canAutomateRole("validator"), true);
  assert.equal(canAutomateRole("observer"), false);
  assert.equal(isRoundRole("judge"), true);
  assert.equal(isRoundRole("validator"), false);
});

test("permission origins include canonical fresh-thread provider hosts", () => {
  assert.deepEqual(permissionOriginsForUrl("https://chat.openai.com/c/123"), [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*"
  ]);
  assert.deepEqual(permissionOriginsForUrl("https://getmerlin.in/chat"), [
    "https://getmerlin.in/*",
    "https://www.getmerlin.in/*",
    "https://extension.getmerlin.in/*"
  ]);
  assert.deepEqual(permissionOriginsForUrl("https://example.com/chat"), []);
  assert.deepEqual(permissionOriginsForUrl("http://localhost:4173/"), ["http://localhost/*"]);
  assert.deepEqual(permissionOriginsForTabs([
    { url: "https://x.com/i/grok" },
    { url: "https://www.perplexity.ai/search/foo" }
  ]), [
    "https://grok.com/*",
    "https://x.com/*",
    "https://x.ai/*",
    "https://*.x.ai/*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*"
  ]);
});

test("chooses judge by configured priority or manual tab", () => {
  const members = [
    { tabId: 1, providerId: "grok", status: "ready" },
    { tabId: 2, providerId: "chatgpt", status: "ready" },
    { tabId: 3, providerId: "claude", status: "blocked" }
  ];

  assert.equal(chooseJudgeMember(members, "auto").tabId, 2);
  assert.equal(chooseJudgeMember(members, "manual", 1).tabId, 1);
  assert.equal(chooseJudgeMember(members, "manual", 999), null);
});

test("prefers explicit judge role over provider priority", () => {
  const members = [
    { tabId: 1, providerId: "claude", status: "ready", role: "member" },
    { tabId: 2, providerId: "grok", status: "ready", role: "judge" },
    { tabId: 3, providerId: "chatgpt", status: "ready", role: "validator" }
  ];

  assert.equal(chooseJudgeMember(members, "auto").tabId, 2);
});

test("parses disagreement JSON from plain or fenced text", () => {
  assert.deepEqual(parseDisagreement('{ "disagree": true, "reason": "real conflict" }'), {
    disagree: true,
    reason: "real conflict"
  });
  assert.deepEqual(parseDisagreement("```json\n{\"disagree\":false,\"reason\":\"aligned\"}\n```"), {
    disagree: false,
    reason: "aligned"
  });
});

test("parses structured round outputs from noisy model text", () => {
  const round1 = parseCouncilOutput(
    'Sure:\n```json\n{ "answer": "2+2 is 4.", "key_points": ["arithmetic"], "uncertainty": "", "confidence": "5/5" }\n```',
    "round1"
  );

  assert.equal(round1.ok, true);
  assert.deepEqual(round1.data, {
    answer: "2+2 is 4.",
    key_points: ["arithmetic"],
    uncertainty: "",
    confidence: 5
  });

  const synthesis = parseCouncilOutput(
    '{ "final_answer": "Use Postgres.", "verdict_table": [{ "model": "ChatGPT", "agree": "yes", "disagree": "no", "confidence": 4, "reasoning_trace": "Best fit." }], "agreements": ["SQL"], "disagreements": [], "confidence": 4, "open_questions": [] }',
    "synthesis"
  );

  assert.equal(synthesis.ok, true);
  assert.equal(synthesis.data.final_answer, "Use Postgres.");
  assert.deepEqual(synthesis.data.verdict_table[0], {
    model: "ChatGPT",
    agree: true,
    disagree: false,
    confidence: 4,
    reasoning_trace: "Best fit."
  });
});

test("structured output parser returns partial data and an error for missing required fields", () => {
  const parsed = parseCouncilOutput('{ "confidence": 3 }', "round1");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /answer/);
  assert.equal(parsed.data.confidence, 3);
});

test("structured output parser tolerates unescaped quotes inside schema string values", () => {
  const parsed = parseCouncilOutput(
    '{"final_answer":"2 + 2 = 4. Structured JSON helps parsing.","remaining_disagreement":"Merlin said "4" without the JSON reason.","reasoning":"The answer that only says "4" misses part of the prompt.","confidence":5}',
    "round3"
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.final_answer, "2 + 2 = 4. Structured JSON helps parsing.");
  assert.equal(parsed.data.remaining_disagreement, 'Merlin said "4" without the JSON reason.');
  assert.equal(parsed.data.reasoning, 'The answer that only says "4" misses part of the prompt.');
  assert.equal(parsed.data.confidence, 5);
});

test("parses ratify and veto outputs", () => {
  const ratify = parseCouncilOutput(
    '{ "verdict": "RATIFY", "veto_clause": "", "reason": "Faithful to the record.", "confidence": 5 }',
    "ratification"
  );
  assert.equal(ratify.ok, true);
  assert.deepEqual(ratify.data, {
    verdict: "RATIFY",
    veto_clause: "",
    reason: "Faithful to the record.",
    confidence: 5
  });

  const veto = parseCouncilOutput(
    '{ "decision": "veto", "clause": "confidence claim", "reasoning": "Overstated confidence.", "confidence": "4/5" }',
    "ratification"
  );
  assert.equal(veto.ok, true);
  assert.equal(veto.data.verdict, "VETO");
  assert.equal(veto.data.veto_clause, "confidence claim");
});
