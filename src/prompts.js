function roundHeader(runId, round) {
  return `[MODEL_COUNCIL_RUN=${runId}; ROUND=${round}]`;
}

function memberName(member) {
  const model = member.modelLabel ? `, selected model: ${member.modelLabel}` : "";
  return `${member.label} (${member.providerLabel}${model})`;
}

function jsonContract(schema) {
  return `Respond ONLY with valid JSON. Do not use markdown fences, prose, headings, or tables.
Escape double quotes inside string values, or rephrase with apostrophes/no quotes.
Use this exact shape:
${schema}`;
}

const ROUND_1_SCHEMA = `{
  "answer": "one clear answer",
  "key_points": ["short reason or evidence"],
  "uncertainty": "known caveat or empty string",
  "confidence": 1
}`;

const ROUND_2_SCHEMA = `{
  "agree": ["specific points you agree with"],
  "disagree": ["specific points you disagree with"],
  "updated_answer": "your revised answer",
  "changed": false,
  "confidence": 1
}`;

const ROUND_3_SCHEMA = `{
  "final_answer": "your final answer",
  "remaining_disagreement": "remaining substantive disagreement or empty string",
  "reasoning": "short reasoning trace",
  "confidence": 1
}`;

const DISAGREEMENT_SCHEMA = `{
  "disagree": false,
  "reason": "one short sentence"
}`;

const SYNTHESIS_SCHEMA = `{
  "final_answer": "synthesized final answer",
  "verdict_table": [
    {
      "model": "model label",
      "agree": true,
      "disagree": false,
      "confidence": 1,
      "reasoning_trace": "short trace"
    }
  ],
  "agreements": ["where models agreed"],
  "disagreements": ["where models disagreed"],
  "confidence": 1,
  "open_questions": ["remaining unknowns"]
}`;

const RATIFICATION_SCHEMA = `{
  "verdict": "RATIFY",
  "veto_clause": "specific clause to change, or empty string",
  "reason": "one short reason",
  "confidence": 1
}`;

const PHASE_SCHEMAS = {
  round1: ROUND_1_SCHEMA,
  round2: ROUND_2_SCHEMA,
  round3: ROUND_3_SCHEMA,
  "disagreement-check": DISAGREEMENT_SCHEMA,
  synthesis: SYNTHESIS_SCHEMA,
  ratification: RATIFICATION_SCHEMA
};

function outputBodyForPrompt(output) {
  if (output.structured) return JSON.stringify(output.structured, null, 2);
  return output.text.trim();
}

function formatOutputs(outputs, excludeTabId = null) {
  return outputs
    .filter((output) => output.ok && output.tabId !== excludeTabId)
    .map((output) => `### ${output.modelLabel ? `${output.label} (${output.modelLabel})` : output.label}\n\n${outputBodyForPrompt(output)}`)
    .join("\n\n---\n\n");
}

export function buildRound1Prompt({ runId, prompt, member }) {
  return `${roundHeader(runId, "1")}

You are one member of a browser-tab Tab Council.

Task:
1. Answer independently.
2. Do not assume or invent other council members' answers.
3. Be concrete about uncertainty.
4. Use a numeric confidence from 0 to 5.

${jsonContract(ROUND_1_SCHEMA)}

Your seat: ${memberName(member)}

Original prompt:
${prompt}`;
}

export function buildRound2Prompt({ runId, prompt, member, round1Outputs }) {
  const otherAnswers = formatOutputs(round1Outputs, member.tabId);
  return `${roundHeader(runId, "2")}

You are in Round 2 of a browser-tab Tab Council.

Task:
1. Read the other members' Round 1 answers.
2. State where you agree.
3. State where you disagree and why.
4. Update your answer only where another member made a valid point.
5. Use a numeric confidence from 0 to 5.

${jsonContract(ROUND_2_SCHEMA)}

Your seat: ${memberName(member)}

Original prompt:
${prompt}

Other Round 1 answers:
${otherAnswers || "No other successful Round 1 answers were available."}`;
}

export function buildDisagreementPrompt({ runId, prompt, round2Outputs }) {
  return `${roundHeader(runId, "DISAGREEMENT_CHECK")}

You are the Tab Council referee. Decide whether unresolved substantive disagreement remains after Round 2.

${jsonContract(DISAGREEMENT_SCHEMA)}

Return true only for substantive disagreement about the answer, not tone, length, or wording.

Original prompt:
${prompt}

Round 2 answers:
${formatOutputs(round2Outputs)}`;
}

export function buildRound3Prompt({ runId, prompt, member, round2Outputs }) {
  const otherAnswers = formatOutputs(round2Outputs, member.tabId);
  return `${roundHeader(runId, "3")}

You are in Round 3 of a browser-tab Tab Council. This final statement was triggered because disagreement may remain.

Task:
1. Give your final answer.
2. Name the strongest disagreement you still hold.
3. Explain why you hold it.
4. Use a numeric confidence from 0 to 5.

${jsonContract(ROUND_3_SCHEMA)}

Your seat: ${memberName(member)}

Original prompt:
${prompt}

Other Round 2 answers:
${otherAnswers || "No other successful Round 2 answers were available."}`;
}

export function buildSynthesisPrompt({ runId, prompt, round1Outputs, round2Outputs, round3Outputs }) {
  const round3Block = round3Outputs?.length
    ? `\n\nRound 3 final statements:\n${formatOutputs(round3Outputs)}`
    : "";

  return `${roundHeader(runId, "SYNTHESIS")}

You are the Tab Council judge. Produce a synthesized final verdict from all council rounds.

${jsonContract(SYNTHESIS_SCHEMA)}

Original prompt:
${prompt}

Round 1 independent answers:
${formatOutputs(round1Outputs)}

Round 2 critique and updates:
${formatOutputs(round2Outputs)}${round3Block}`;
}

export function buildRatificationPrompt({ runId, prompt, member, synthesisOutput }) {
  return `${roundHeader(runId, "RATIFICATION")}

You are a non-judge reviewer in the Tab Council. Review the final synthesized verdict.

Task:
1. RATIFY if the verdict is faithful to the council record.
2. VETO only if a specific clause is wrong, unsupported, or misses an important unresolved dissent.
3. If vetoing, name the exact clause to change.
4. Use a numeric confidence from 0 to 5.

${jsonContract(RATIFICATION_SCHEMA)}

Your seat: ${memberName(member)}

Original prompt:
${prompt}

Final synthesized verdict:
${outputBodyForPrompt(synthesisOutput)}`;
}

export function buildJsonRepairPrompt({ runId, phase, parseError, badText }) {
  return `${roundHeader(runId, `${phase}:REPAIR`)}

Your previous response could not be parsed by Tab Council.

Parse error:
${parseError || "Invalid JSON"}

Repair task:
1. Return ONLY valid JSON.
2. Do not add markdown fences, headings, or explanation.
3. Preserve the same meaning as your previous answer.
4. Escape double quotes inside JSON string values, or rephrase without inner double quotes.

${jsonContract(PHASE_SCHEMAS[phase] || `{
  "answer": "valid JSON response"
}`)}

Previous response:
${badText || "(empty)"}`;
}

function formatOutputForExport(output, options = {}) {
  if (!output.ok) return `Failed: ${output.error}`;

  const includeRaw = options.includeRaw === true;
  const lines = [];
  if (output.structured) {
    lines.push("Structured:", "", "```json", JSON.stringify(output.structured, null, 2), "```");
    if (includeRaw && output.text?.trim()) {
      lines.push("", "Raw transcript:", "", "```text", output.text.trim(), "```");
    }
    return lines.join("\n");
  }

  if (output.parseError) lines.push(`Structured parse failed: ${output.parseError}`, "");
  if (includeRaw) lines.push(output.text || "");
  else lines.push("Raw transcript omitted because raw export is off.");
  return lines.join("\n").trim();
}

export function buildMarkdownExport(run, options = {}) {
  const includeRaw = options.includeRaw === true;
  const lines = [
    `# Tab Council Run ${run.id}`,
    "",
    `Status: ${run.status}`,
    `Phase: ${run.phase}`,
    `Created: ${new Date(run.createdAt).toISOString()}`,
    "",
    "## Prompt",
    ""
  ];
  if (includeRaw) lines.push(run.prompt, "");
  else lines.push("Prompt omitted because raw export is off.", "");

  if (run.members?.length) {
    lines.push("## Members", "");
    for (const member of run.members) {
      const model = member.modelLabel ? `, model: ${member.modelLabel}` : "";
      const role = member.role ? `, role: ${member.role}` : "";
      lines.push(`- ${member.label || member.providerLabel || "Tab"} (${member.providerLabel || "unknown"}${model}${role}) - ${member.status || "unknown"}`);
    }
    lines.push("");
  }

  for (const [key, label] of [
    ["round1", "Round 1 - Independent"],
    ["round2", "Round 2 - Critique and Update"],
    ["round3", "Round 3 - Final Statements"]
  ]) {
    const outputs = run.rounds?.[key]?.outputs ?? [];
    if (!outputs.length) continue;
    lines.push(`## ${label}`, "");
    for (const output of outputs) {
      lines.push(`### ${output.modelLabel ? `${output.label} (${output.modelLabel})` : output.label}`, "", formatOutputForExport(output, options), "");
    }
  }

  if (run.disagreementCheck) {
    const disagreement = {
      disagree: run.disagreementCheck.disagree,
      reason: run.disagreementCheck.reason,
      judgeTabId: run.disagreementCheck.judgeTabId,
      judgeLabel: run.disagreementCheck.judgeLabel
    };
    if (includeRaw && run.disagreementCheck.rawOutput) {
      disagreement.rawOutput = run.disagreementCheck.rawOutput;
    }
    lines.push("## Disagreement Check", "", JSON.stringify(disagreement, null, 2), "");
  }

  if (run.synthesis?.outputs?.length) {
    lines.push("## Synthesis", "");
    for (const output of run.synthesis.outputs) {
      lines.push(`### ${output.modelLabel ? `${output.label} (${output.modelLabel})` : output.label}`, "", formatOutputForExport(output, options), "");
    }
  }

  if (run.ratification?.outputs?.length) {
    lines.push("## Ratify or Veto", "");
    for (const output of run.ratification.outputs) {
      lines.push(`### ${output.modelLabel ? `${output.label} (${output.modelLabel})` : output.label}`, "", formatOutputForExport(output, options), "");
    }
  }

  if (run.events?.length) {
    lines.push("## Run Log", "", ...run.events.map((event) => `- ${new Date(event.at).toISOString()} ${event.level} ${event.label || ""} ${event.phase || ""}: ${event.message}`), "");
  }

  if (run.errors?.length) {
    lines.push("## Errors", "", ...run.errors.map((error) => `- ${error}`), "");
  }

  return `${lines.join("\n").trim()}\n`;
}
