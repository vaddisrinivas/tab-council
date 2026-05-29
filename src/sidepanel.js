import {
  ACTIVE_COUNCIL_KEY,
  CURRENT_RUN_KEY,
  RUN_HISTORY_KEY,
  RUN_PORT_NAME,
  MEMBER_ROLES,
  canAutomateRole,
  isRoundRole,
  normalizeMemberRole,
  permissionOriginsForTabs
} from "./shared.js";
import { buildMarkdownExport } from "./prompts.js";

const elements = {
  heading: document.querySelector("#heading"),
  refresh: document.querySelector("#refresh"),
  status: document.querySelector("#status"),
  readiness: document.querySelector("#readiness"),
  memberCount: document.querySelector("#memberCount"),
  members: document.querySelector("#members"),
  form: document.querySelector("#runForm"),
  prompt: document.querySelector("#prompt"),
  councilMode: document.querySelector("#councilMode"),
  viewMode: document.querySelector("#viewMode"),
  forceRound3: document.querySelector("#forceRound3"),
  isolateThreads: document.querySelector("#isolateThreads"),
  includeRawInExport: document.querySelector("#includeRawInExport"),
  ratifyEnabled: document.querySelector("#ratifyEnabled"),
  judgeMode: document.querySelector("#judgeMode"),
  judgeTabWrap: document.querySelector("#judgeTabWrap"),
  judgeTab: document.querySelector("#judgeTab"),
  startRun: document.querySelector("#startRun"),
  abortRun: document.querySelector("#abortRun"),
  phase: document.querySelector("#phase"),
  progress: document.querySelector("#progress"),
  workspaceMeta: document.querySelector("#workspaceMeta"),
  phaseTabs: document.querySelector("#phaseTabs"),
  phaseSummary: document.querySelector("#phaseSummary"),
  phaseContent: document.querySelector("#phaseContent"),
  historyCount: document.querySelector("#historyCount"),
  history: document.querySelector("#history"),
  rerunSynthesis: document.querySelector("#rerunSynthesis"),
  clearRun: document.querySelector("#clearRun"),
  exportRun: document.querySelector("#exportRun")
};

const MODE_PRESETS = {
  quick: {
    label: "Quick",
    description: "Fast compare, current threads, no forced final round.",
    forceRound3: false,
    isolateThreads: false,
    ratifyEnabled: false,
    judgeMode: "auto"
  },
  balanced: {
    label: "Balanced",
    description: "Fresh threads, independent answers, critique, judge synthesis.",
    forceRound3: false,
    isolateThreads: true,
    ratifyEnabled: false,
    judgeMode: "auto"
  },
  thorough: {
    label: "Thorough",
    description: "Fresh threads plus forced final statements before synthesis.",
    forceRound3: true,
    isolateThreads: true,
    ratifyEnabled: false,
    judgeMode: "auto"
  },
  rigorous: {
    label: "Rigorous",
    description: "Forced final round plus non-judge ratify/veto review.",
    forceRound3: true,
    isolateThreads: true,
    ratifyEnabled: true,
    judgeMode: "auto"
  }
};

const PHASES = [
  { id: "overview", label: "Overview" },
  { id: "round1", label: "I Independent" },
  { id: "round2", label: "II Critique" },
  { id: "round3", label: "III Final" },
  { id: "synthesis", label: "IV Judge" },
  { id: "ratification", label: "V Ratify" },
  { id: "log", label: "Log" }
];

const ROLE_OPTIONS = [
  [MEMBER_ROLES.MEMBER, "Member"],
  [MEMBER_ROLES.JUDGE, "Judge"],
  [MEMBER_ROLES.VALIDATOR, "Validator"],
  [MEMBER_ROLES.OBSERVER, "Observer"],
  [MEMBER_ROLES.EXCLUDE, "Exclude"]
];

let state = { activeCouncil: null, run: null, settings: {}, history: [] };
let runPort = null;
let selectedPhase = "overview";
let controlsHydrated = false;

function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function text(value) {
  return value == null || value === "" ? "-" : String(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function statusPill(status, label = status) {
  const pill = document.createElement("span");
  pill.className = `pill ${status}`;
  pill.textContent = label;
  return pill;
}

function listBlock(label, values = []) {
  if (!values?.length) return "";
  return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
}

function verdictTableText(rows = []) {
  if (!rows.length) return "";
  return [
    "Verdict table:",
    ...rows.map((row) => {
      const agree = row.agree ? "agree" : "no-agree";
      const disagree = row.disagree ? "disagree" : "no-disagree";
      const confidence = row.confidence == null ? "-" : `${row.confidence}/5`;
      return `- ${row.model}: ${agree}, ${disagree}, confidence ${confidence}. ${row.reasoning_trace || ""}`.trim();
    })
  ].join("\n");
}

function structuredText(output) {
  const data = output.structured;
  if (!data) return "";

  if (output.phase === "synthesis") {
    return [
      data.final_answer,
      data.confidence == null ? "" : `Confidence: ${data.confidence}/5`,
      verdictTableText(data.verdict_table),
      listBlock("Agreements", data.agreements),
      listBlock("Disagreements", data.disagreements),
      listBlock("Open questions", data.open_questions)
    ].filter(Boolean).join("\n\n");
  }

  if (output.phase === "round1") {
    return [
      data.answer,
      listBlock("Key points", data.key_points),
      data.uncertainty ? `Uncertainty: ${data.uncertainty}` : "",
      data.confidence == null ? "" : `Confidence: ${data.confidence}/5`
    ].filter(Boolean).join("\n\n");
  }

  if (output.phase === "round2") {
    return [
      data.updated_answer,
      listBlock("Agree", data.agree),
      listBlock("Disagree", data.disagree),
      `Changed: ${data.changed ? "yes" : "no"}`,
      data.confidence == null ? "" : `Confidence: ${data.confidence}/5`
    ].filter(Boolean).join("\n\n");
  }

  if (output.phase === "round3") {
    return [
      data.final_answer,
      data.remaining_disagreement ? `Remaining disagreement: ${data.remaining_disagreement}` : "",
      data.reasoning ? `Reasoning: ${data.reasoning}` : "",
      data.confidence == null ? "" : `Confidence: ${data.confidence}/5`
    ].filter(Boolean).join("\n\n");
  }

  if (output.phase === "ratification") {
    return [
      `Verdict: ${data.verdict}`,
      data.veto_clause ? `Veto clause: ${data.veto_clause}` : "",
      `Reason: ${data.reason || "-"}`,
      data.confidence == null ? "" : `Confidence: ${data.confidence}/5`
    ].filter(Boolean).join("\n\n");
  }

  if (output.phase === "disagreement-check") {
    return `Disagreement: ${data.disagree ? "yes" : "no"}\nReason: ${data.reason || "-"}`;
  }

  return JSON.stringify(data, null, 2);
}

function outputText(output) {
  if (!output.ok) return `Failed: ${output.error || "Unknown error"}`;
  if (output.structured) return structuredText(output);
  if (output.parseError) return `Structured parse failed: ${output.parseError}\n\n${output.text || ""}`;
  return output.text || "";
}

function memberLabel(member) {
  const model = member.modelLabel ? ` · ${member.modelLabel}` : "";
  return `${member.label || member.providerLabel || "Tab"}${model} #${member.tabId}`;
}

function allOutputs(run = state.run) {
  if (!run) return [];
  return [
    ...(run.rounds?.round1?.outputs ?? []),
    ...(run.rounds?.round2?.outputs ?? []),
    ...(run.rounds?.round3?.outputs ?? []),
    ...(run.disagreementCheck?.rawOutput ? [run.disagreementCheck.rawOutput] : []),
    ...(run.synthesis?.outputs ?? []),
    ...(run.ratification?.outputs ?? [])
  ];
}

function parseHealth(output) {
  if (!output.ok) return { status: "failed", label: output.parseError ? "parse failed" : "failed" };
  const repairAttempt = output.attempts?.find((attempt) => attempt.kind === "repair");
  if (repairAttempt && !repairAttempt.parseError) return { status: "repaired", label: "repaired JSON" };
  if (output.structured) return { status: "valid", label: "valid JSON" };
  return { status: "raw", label: "raw text" };
}

function hasDissent(output) {
  const data = output.structured;
  if (!output.ok) return true;
  if (!data) return false;
  if (output.phase === "round2") return Boolean(data.disagree?.length || data.changed);
  if (output.phase === "round3") return Boolean(data.remaining_disagreement);
  if (output.phase === "synthesis") {
    return Boolean(data.disagreements?.length || data.verdict_table?.some((row) => row.disagree));
  }
  if (output.phase === "ratification") return data.verdict === "VETO";
  if (output.phase === "disagreement-check") return Boolean(data.disagree);
  return false;
}

function bestSynthesis(run = state.run) {
  return (run?.synthesis?.outputs ?? []).find((output) => output.ok && output.structured)
    ?? (run?.synthesis?.outputs ?? []).find((output) => output.ok)
    ?? null;
}

function roleForMember(member) {
  return normalizeMemberRole(
    state.settings?.memberRoles?.[String(member.tabId)] ?? member.role ?? MEMBER_ROLES.MEMBER
  );
}

function phaseOutputs(phaseId) {
  const run = state.run;
  if (!run) return [];
  if (phaseId === "round1") return run.rounds?.round1?.outputs ?? [];
  if (phaseId === "round2") return run.rounds?.round2?.outputs ?? [];
  if (phaseId === "round3") return run.rounds?.round3?.outputs ?? [];
  if (phaseId === "synthesis") return run.synthesis?.outputs ?? [];
  if (phaseId === "ratification") return run.ratification?.outputs ?? [];
  if (phaseId === "log") return run.events ?? [];
  return [];
}

function phaseCount(phaseId) {
  return phaseOutputs(phaseId).length;
}

function outputTitle(prefix, output) {
  const model = output.modelLabel ? ` · ${output.modelLabel}` : "";
  return `${prefix} - ${output.label || output.providerId || "Tab"}${model}`;
}

async function refreshState() {
  const windowId = await currentWindowId();
  const response = await sendMessage("GET_STATE", { windowId });
  if (!response?.ok) throw new Error(response?.error || "Could not load state.");
  state = {
    activeCouncil: response.activeCouncil,
    run: response.run,
    settings: response.settings ?? {},
    history: response.history ?? []
  };
  hydrateControls();
  render();
  return state;
}

async function currentWindowId() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    return currentWindow?.id ?? null;
  } catch {
    return null;
  }
}

function hydrateControls() {
  if (controlsHydrated) return;
  const settings = state.settings ?? {};
  elements.councilMode.value = settings.councilMode || "balanced";
  elements.viewMode.value = settings.viewMode || "grid";
  applyModePreset(elements.councilMode.value, { save: false });
  elements.includeRawInExport.checked = settings.includeRawInExport === true;
  controlsHydrated = true;
}

function applyModePreset(mode, { save = true } = {}) {
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.balanced;
  elements.forceRound3.checked = preset.forceRound3;
  elements.isolateThreads.checked = preset.isolateThreads;
  elements.ratifyEnabled.checked = preset.ratifyEnabled;
  elements.judgeMode.value = preset.judgeMode;
  renderMembers();
  renderReadiness();
  if (save) void saveSettings();
}

function renderMembers() {
  const tabs = state.activeCouncil?.tabs ?? [];
  const runMembers = new Map((state.run?.members ?? []).map((member) => [member.tabId, member]));
  const members = tabs.map((tab) => runMembers.get(tab.tabId) ?? tab);

  elements.memberCount.textContent = `${members.length} tab${members.length === 1 ? "" : "s"}`;
  elements.members.replaceChildren(
    ...members.map((member) => {
      const card = document.createElement("article");
      card.className = "member";
      const role = roleForMember(member);

      const top = document.createElement("div");
      top.className = "memberTop";

      const title = document.createElement("h3");
      title.className = "memberName";
      title.textContent = memberLabel(member);

      top.append(title, statusPill(member.status ?? (member.injectable && canAutomateRole(role) ? "pending" : role)));

      const url = document.createElement("p");
      url.className = "meta wrap";
      url.textContent = member.url || "URL hidden";

      const model = document.createElement("p");
      model.className = "meta wrap";
      model.textContent = member.modelLabel ? `Model: ${member.modelLabel}` : "Model: selected in provider tab";

      const reason = document.createElement("p");
      reason.className = "meta wrap";
      reason.textContent = member.reason || member.providerLabel || "Tab-selected model";

      const roleLabel = document.createElement("label");
      roleLabel.className = "roleSelect";
      roleLabel.textContent = "Role";
      const roleSelect = document.createElement("select");
      roleSelect.dataset.tabId = String(member.tabId);
      roleSelect.setAttribute("aria-label", `${memberLabel(member)} role`);
      for (const [value, label] of ROLE_OPTIONS) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = value === role;
        roleSelect.append(option);
      }
      roleSelect.addEventListener("change", () => {
        state.settings.memberRoles = {
          ...(state.settings.memberRoles ?? {}),
          [String(member.tabId)]: roleSelect.value
        };
        void saveSettings();
        renderMembers();
        renderReadiness();
      });
      roleLabel.append(roleSelect);

      card.append(top, url, model, reason, roleLabel);
      return card;
    })
  );

  elements.judgeTab.replaceChildren(
    ...members
      .filter((member) => member.injectable !== false && isRoundRole(roleForMember(member)))
      .map((member) => {
        const option = document.createElement("option");
        option.value = String(member.tabId);
        option.textContent = memberLabel(member);
        return option;
      })
  );

  const manual = elements.judgeMode.value === "manual";
  elements.judgeTabWrap.hidden = !manual;
}

function renderProgress() {
  const run = state.run;
  elements.phase.textContent = run?.phase ?? "idle";
  elements.abortRun.disabled = run?.status !== "running";
  elements.exportRun.disabled = !run;
  elements.clearRun.disabled = !run || run?.status === "running";
  elements.rerunSynthesis.disabled = !run || run.status === "running" || !(run.rounds?.round2?.outputs?.length);

  const steps = [];
  if (run) {
    steps.push(["Status", run.status]);
    steps.push(["Mode", MODE_PRESETS[run.councilMode || state.settings?.councilMode]?.label || "Balanced"]);
    steps.push(["Judge", run.judgeLabel || "auto"]);
    const readyCount = (run.members ?? []).filter((member) => member.status === "ready").length;
    const blockedCount = (run.members ?? []).filter((member) => ["blocked", "removed"].includes(member.status)).length;
    steps.push(["Members", `${readyCount} ready, ${blockedCount} blocked/removed`]);
    if (run.disagreementCheck) {
      steps.push(["Disagreement", `${run.disagreementCheck.disagree ? "yes" : "no"} - ${run.disagreementCheck.reason}`]);
    }
    const vetoCount = (run.ratification?.outputs ?? []).filter((output) => output.structured?.verdict === "VETO").length;
    if (run.ratification?.outputs?.length) steps.push(["Ratify/Veto", `${vetoCount} veto, ${run.ratification.outputs.length - vetoCount} ratify`]);
    for (const error of run.errors ?? []) steps.push(["Error", error]);
  }

  elements.progress.replaceChildren(
    ...steps.map(([label, value]) => {
      const item = document.createElement("div");
      item.className = "step";
      const name = document.createElement("strong");
      name.textContent = label;
      const detail = document.createElement("span");
      detail.className = "meta wrap";
      detail.textContent = value;
      item.append(name, detail);
      return item;
    })
  );
}

function renderReadiness() {
  const tabs = state.activeCouncil?.tabs ?? [];
  const settings = {
    ...state.settings,
    isolateThreads: elements.isolateThreads.checked
  };
  const origins = permissionOriginsForTabs(tabs, settings);
  const supportedTabs = tabs.filter((tab) => tab.providerId !== "unsupported");
  const knownTabs = tabs.filter((tab) => !["unsupported", "generic"].includes(tab.providerId));
  const roles = tabs.map(roleForMember);
  const roundTabs = tabs.filter((tab) => isRoundRole(roleForMember(tab)));
  const validatorTabs = tabs.filter((tab) => roleForMember(tab) === MEMBER_ROLES.VALIDATOR);
  const mode = MODE_PRESETS[elements.councilMode.value] ?? MODE_PRESETS.balanced;
  const items = [
    {
      ok: Boolean(state.activeCouncil),
      label: state.activeCouncil ? "tab-council group detected" : "No tab-council group"
    },
    {
      ok: supportedTabs.length >= 2,
      label: `${supportedTabs.length} automatable tab${supportedTabs.length === 1 ? "" : "s"} found`
    },
    {
      ok: knownTabs.length > 0,
      label: knownTabs.length ? `${knownTabs.length} known provider tab${knownTabs.length === 1 ? "" : "s"}` : "No known provider tabs"
    },
    {
      ok: origins.length > 0,
      label: origins.length ? `${origins.length} provider permission origin${origins.length === 1 ? "" : "s"} needed` : "No requestable provider origins"
    },
    {
      ok: roundTabs.length >= 2,
      label: `${roundTabs.length} debate member${roundTabs.length === 1 ? "" : "s"}, ${validatorTabs.length} validator${validatorTabs.length === 1 ? "" : "s"}`
    },
    {
      ok: roles.some((role) => role === MEMBER_ROLES.JUDGE) || elements.judgeMode.value !== "auto",
      label: roles.some((role) => role === MEMBER_ROLES.JUDGE)
        ? "Judge role will be preferred"
        : "Auto judge uses provider priority"
    },
    {
      ok: true,
      label: `${mode.label}: ${mode.description}`
    }
  ];

  elements.readiness.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = `readyItem ${item.ok ? "ok" : "warn"}`;
      const mark = document.createElement("span");
      mark.className = "readyMark";
      mark.textContent = item.ok ? "OK" : "Check";
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(mark, label);
      return row;
    })
  );
}

function renderOutput(title, output) {
  const card = document.createElement("article");
  card.className = `output ${hasDissent(output) ? "hasDissent" : ""}`;

  const top = document.createElement("div");
  top.className = "outputTop";

  const heading = document.createElement("h3");
  heading.className = "outputTitle";
  heading.textContent = title;

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(statusPill(output.ok ? "ready" : "failed", output.ok ? "ready" : "failed"));
  const health = parseHealth(output);
  badges.append(statusPill(health.status, health.label));
  if (output.durationMs) badges.append(statusPill("metric", `${Math.round(output.durationMs / 1000)}s`));

  top.append(heading, badges);

  const body = document.createElement("div");
  body.className = "outputBody";
  body.textContent = outputText(output);

  card.append(top, body);
  return card;
}

function renderMetric(label, value, tone = "neutral") {
  const item = document.createElement("div");
  item.className = `metricCard ${tone}`;
  const number = document.createElement("strong");
  number.textContent = value;
  const caption = document.createElement("span");
  caption.textContent = label;
  item.append(number, caption);
  return item;
}

function renderVerdictHero() {
  const output = bestSynthesis();
  const run = state.run;
  const hero = document.createElement("section");
  hero.className = "verdictHero";

  const title = document.createElement("div");
  title.className = "verdictTitle";
  const h3 = document.createElement("h3");
  h3.textContent = output ? `Final Verdict - ${output.label}` : "Final Verdict";
  const badges = document.createElement("div");
  badges.className = "badges";
  if (output) badges.append(statusPill(output.ok ? "ready" : "failed"));
  if (run?.ratification?.outputs?.length) {
    const vetoCount = run.ratification.outputs.filter((item) => item.structured?.verdict === "VETO").length;
    badges.append(statusPill(vetoCount ? "failed" : "valid", vetoCount ? `${vetoCount} veto` : "ratified"));
  }
  title.append(h3, badges);

  const body = document.createElement("p");
  body.textContent = output ? outputText(output).split("\n\n")[0] : "No synthesis yet.";

  hero.append(title, body);
  return hero;
}

function renderOverview() {
  const run = state.run;
  if (!run) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = 'Create or rename a Chrome tab group to "tab-council", then run a prompt.';
    elements.phaseSummary.replaceChildren(empty);
    elements.phaseContent.replaceChildren();
    return;
  }

  const outputs = allOutputs(run);
  const successful = outputs.filter((output) => output.ok).length;
  const failed = outputs.length - successful;
  const repaired = outputs.filter((output) => parseHealth(output).status === "repaired").length;
  const dissent = outputs.filter(hasDissent).length;
  const confidenceValues = outputs
    .map((output) => output.structured?.confidence)
    .filter((value) => typeof value === "number");
  const avgConfidence = confidenceValues.length
    ? `${(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(1)}/5`
    : "-";

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.append(
    renderMetric("Outputs", String(outputs.length)),
    renderMetric("Successful", String(successful), failed ? "warn" : "good"),
    renderMetric("Dissent signals", String(dissent), dissent ? "warn" : "good"),
    renderMetric("JSON repaired", String(repaired), repaired ? "warn" : "neutral"),
    renderMetric("Avg confidence", avgConfidence)
  );

  const disagreement = document.createElement("div");
  disagreement.className = "callout";
  disagreement.textContent = run.disagreementCheck
    ? `${run.disagreementCheck.disagree ? "Disagreement remains" : "No substantive disagreement"}: ${run.disagreementCheck.reason || "-"}`
    : "Disagreement check has not run yet.";

  elements.phaseSummary.replaceChildren(renderVerdictHero(), metrics, disagreement);

  const failedOutputs = outputs.filter((output) => !output.ok);
  const dissentOutputs = outputs.filter((output) => output.ok && hasDissent(output));
  const cards = [
    ...failedOutputs.map((output) => renderOutput(outputTitle("Needs attention", output), output)),
    ...dissentOutputs.slice(0, 6).map((output) => renderOutput(outputTitle("Dissent", output), output))
  ];
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No failed tabs or unresolved dissent to review.";
    cards.push(empty);
  }
  elements.phaseContent.className = "phaseContent grid";
  elements.phaseContent.replaceChildren(...cards);
}

function renderPhaseOutputs(phaseId) {
  const labels = {
    round1: "Round 1",
    round2: "Round 2",
    round3: "Round 3",
    synthesis: "Synthesis",
    ratification: "Ratify/Veto"
  };
  const viewMode = elements.viewMode.value;
  const outputs = phaseOutputs(phaseId);
  const visible = viewMode === "dissent" ? outputs.filter(hasDissent) : outputs;

  const summary = document.createElement("div");
  summary.className = "phaseDeck";
  summary.append(
    renderMetric("Total", String(outputs.length)),
    renderMetric("Ready", String(outputs.filter((output) => output.ok).length)),
    renderMetric("Dissent", String(outputs.filter(hasDissent).length)),
    renderMetric("Parse issues", String(outputs.filter((output) => !output.ok || parseHealth(output).status === "repaired").length))
  );
  elements.phaseSummary.replaceChildren(summary);

  if (!outputs.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = `${labels[phaseId]} has not produced outputs yet.`;
    elements.phaseContent.replaceChildren(empty);
    return;
  }

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "No dissent or failed outputs in this phase.";
    elements.phaseContent.replaceChildren(empty);
    return;
  }

  if (viewMode === "unified") {
    const unified = document.createElement("article");
    unified.className = "output unifiedOutput";
    const body = document.createElement("div");
    body.className = "outputBody";
    body.textContent = visible
      .map((output) => `## ${output.label}\n\n${outputText(output)}`)
      .join("\n\n---\n\n");
    unified.append(body);
    elements.phaseContent.className = "phaseContent unified";
    elements.phaseContent.replaceChildren(unified);
    return;
  }

  elements.phaseContent.className = "phaseContent grid";
  elements.phaseContent.replaceChildren(
    ...visible.map((output) => renderOutput(outputTitle(labels[phaseId], output), output))
  );
}

function renderLog() {
  const events = state.run?.events ?? [];
  elements.phaseSummary.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "Run log empty.";
    elements.phaseContent.replaceChildren(empty);
    return;
  }

  const log = document.createElement("article");
  log.className = "output unifiedOutput";
  const body = document.createElement("div");
  body.className = "outputBody";
  body.textContent = events
    .slice(-100)
    .map((event) => {
      const time = new Date(event.at).toLocaleTimeString();
      const label = event.label ? ` ${event.label}` : "";
      const phase = event.phase ? ` ${event.phase}` : "";
      return `${time} [${event.level}]${label}${phase}: ${event.message}`;
    })
    .join("\n");
  log.append(body);
  elements.phaseContent.className = "phaseContent unified";
  elements.phaseContent.replaceChildren(log);
}

function renderPhaseTabs() {
  elements.phaseTabs.replaceChildren(
    ...PHASES.map((phase) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = phase.id === selectedPhase ? "phaseTab active" : "phaseTab";
      const count = phase.id === "overview" ? "" : ` ${phaseCount(phase.id)}`;
      button.textContent = `${phase.label}${count}`;
      button.addEventListener("click", () => {
        selectedPhase = phase.id;
        renderWorkspace();
      });
      return button;
    })
  );
}

function renderWorkspace() {
  elements.workspaceMeta.textContent = selectedPhase;
  renderPhaseTabs();
  if (selectedPhase === "overview") renderOverview();
  else if (selectedPhase === "log") renderLog();
  else renderPhaseOutputs(selectedPhase);
}

function renderHistory() {
  const history = state.history ?? [];
  elements.historyCount.textContent = `${history.length} run${history.length === 1 ? "" : "s"}`;
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "Completed councils will appear here.";
    elements.history.replaceChildren(empty);
    return;
  }

  elements.history.replaceChildren(
    ...history.map((run) => {
      const item = document.createElement("article");
      item.className = "historyItem";
      const top = document.createElement("div");
      top.className = "memberTop";
      const title = document.createElement("h3");
      title.textContent = run.id;
      top.append(title, statusPill(run.status));

      const meta = document.createElement("p");
      meta.className = "meta wrap";
      meta.textContent = `${new Date(run.createdAt).toLocaleString()} | ${run.readyCount}/${run.memberCount} ready | judge ${run.judgeLabel || "-"}`;

      const answer = document.createElement("p");
      answer.className = "historyAnswer";
      answer.textContent = run.finalAnswer || run.prompt || "No final answer stored.";

      item.append(top, meta, answer);
      return item;
    })
  );
}

function render() {
  const active = state.activeCouncil;
  const run = state.run;
  elements.heading.textContent = active ? text(active.title) : "No council";
  elements.status.textContent = active
    ? `${active.tabs?.length ?? 0} tab${active.tabs?.length === 1 ? "" : "s"} in group.`
    : 'Create or rename a tab group to "tab-council".';
  elements.startRun.disabled = !active || run?.status === "running";
  renderReadiness();
  renderMembers();
  renderProgress();
  renderWorkspace();
  renderHistory();
}

async function requestHostPermissionsForCouncil() {
  const tabs = state.activeCouncil?.tabs ?? [];
  const origins = permissionOriginsForTabs(tabs, {
    ...state.settings,
    isolateThreads: elements.isolateThreads.checked
  });
  if (!origins.length) {
    elements.status.textContent = "No supported provider origins to request.";
    return false;
  }

  const missing = [];
  for (const origin of origins) {
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) missing.push(origin);
  }

  if (!missing.length) return true;
  try {
    const granted = await chrome.permissions.request({ origins: missing });
    if (!granted) elements.status.textContent = `Host permissions denied: ${missing.join(", ")}`;
    return granted;
  } catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function confirmRunStart() {
  const tabs = state.activeCouncil?.tabs ?? [];
  const providers = [...new Set(tabs.map((tab) => tab.providerLabel).filter(Boolean))].join(", ");
  const roundCount = tabs.filter((tab) => isRoundRole(roleForMember(tab))).length;
  const validatorCount = tabs.filter((tab) => roleForMember(tab) === MEMBER_ROLES.VALIDATOR).length;
  const mode = MODE_PRESETS[elements.councilMode.value] ?? MODE_PRESETS.balanced;
  const lines = [
    `Run ${mode.label} Tab Council with: ${providers || "selected tabs"}?`,
    "",
    `${roundCount} debate members. ${validatorCount} validators.`,
    "",
    "Your prompt will be pasted into each ready AI tab. Later rounds share model answers across those providers."
  ];
  if (elements.isolateThreads.checked) lines.push("", "Fresh threads will navigate known provider tabs to new conversations.");
  if (elements.ratifyEnabled.checked) lines.push("", "Ratify/Veto will ask non-judge models to approve or veto the final verdict.");
  return window.confirm(lines.join("\n"));
}

async function startRun(event) {
  event.preventDefault();
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    elements.status.textContent = "Prompt required.";
    return;
  }

  await refreshState();
  if (!confirmRunStart()) {
    elements.status.textContent = "Run cancelled.";
    return;
  }

  const granted = await requestHostPermissionsForCouncil();
  if (!granted) {
    elements.status.textContent = "Host permissions denied.";
    await refreshState();
    return;
  }

  await saveSettings();
  runPort?.disconnect();
  runPort = chrome.runtime.connect({ name: RUN_PORT_NAME });
  runPort.onMessage.addListener((message) => {
    if (message.type === "RUN_FAILED") elements.status.textContent = message.error;
    refreshState();
  });

  runPort.postMessage({
    type: "START_RUN",
    payload: {
      prompt,
      forceRound3: elements.forceRound3.checked,
      ratifyEnabled: elements.ratifyEnabled.checked,
      judgeMode: elements.judgeMode.value,
      judgeTabId: Number(elements.judgeTab.value) || null,
      settings: {
        councilMode: elements.councilMode.value,
        isolateThreads: elements.isolateThreads.checked,
        includeRawInExport: elements.includeRawInExport.checked,
        ratifyEnabled: elements.ratifyEnabled.checked,
        viewMode: elements.viewMode.value,
        memberRoles: state.settings?.memberRoles ?? {}
      },
      windowId: await currentWindowId()
    }
  });

  elements.status.textContent = "Council running.";
  elements.startRun.disabled = true;
}

async function abortRun() {
  await sendMessage("ABORT_RUN");
  runPort?.disconnect();
  runPort = null;
  await refreshState();
}

async function rerunSynthesis() {
  const response = await sendMessage("RERUN_SYNTHESIS");
  if (!response?.ok) elements.status.textContent = response?.error || "Could not rerun synthesis.";
  await refreshState();
}

async function clearRun() {
  const response = await sendMessage("CLEAR_RUN");
  if (!response?.ok) elements.status.textContent = response?.error || "Could not clear local run.";
  await refreshState();
}

async function saveSettings() {
  await sendMessage("SAVE_SETTINGS", {
    settings: {
      councilMode: elements.councilMode.value,
      isolateThreads: elements.isolateThreads.checked,
      includeRawInExport: elements.includeRawInExport.checked,
      ratifyEnabled: elements.ratifyEnabled.checked,
      viewMode: elements.viewMode.value,
      memberRoles: state.settings?.memberRoles ?? {}
    }
  });
}

function exportRun() {
  if (!state.run) return;
  const blob = new Blob([
    buildMarkdownExport(state.run, { includeRaw: elements.includeRawInExport.checked })
  ], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tab-council-${state.run.id}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

elements.refresh.addEventListener("click", refreshState);
elements.form.addEventListener("submit", startRun);
elements.abortRun.addEventListener("click", abortRun);
elements.rerunSynthesis.addEventListener("click", rerunSynthesis);
elements.clearRun.addEventListener("click", clearRun);
elements.exportRun.addEventListener("click", exportRun);
elements.councilMode.addEventListener("change", () => applyModePreset(elements.councilMode.value));
elements.viewMode.addEventListener("change", () => {
  void saveSettings();
  renderWorkspace();
});
elements.judgeMode.addEventListener("change", () => {
  renderMembers();
  void saveSettings();
});
for (const control of [elements.forceRound3, elements.isolateThreads, elements.includeRawInExport, elements.ratifyEnabled]) {
  control.addEventListener("change", () => {
    void saveSettings();
    renderReadiness();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[ACTIVE_COUNCIL_KEY] || changes[CURRENT_RUN_KEY] || changes[RUN_HISTORY_KEY]) refreshState();
});

refreshState().catch((error) => {
  elements.status.textContent = error instanceof Error ? error.message : String(error);
  render();
});
