import {
  ACTIVE_COUNCIL_KEY,
  ANSWER_TIMEOUT_MS,
  CONTENT_SCRIPT_FILE,
  CURRENT_RUN_KEY,
  JUDGE_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  RUN_HISTORY_KEY,
  RUN_STALE_MS,
  RUN_PHASES,
  RUN_PORT_NAME,
  USER_SETTINGS_KEY,
  canAutomateRole,
  chooseJudgeMember,
  createRunId,
  detectProviderFromUrl,
  getNewThreadUrl,
  getProviderLabel,
  isRoundRole,
  isValidatorRole,
  isCouncilGroup,
  isInjectableUrl,
  normalizeSettings,
  parseCouncilOutput,
  parseDisagreement,
  roleForTab
} from "./shared.js";
import {
  buildDisagreementPrompt,
  buildJsonRepairPrompt,
  buildRatificationPrompt,
  buildRound1Prompt,
  buildRound2Prompt,
  buildRound3Prompt,
  buildSynthesisPrompt
} from "./prompts.js";

const activeAbortRunIds = new Set();
const MAX_OUTPUT_TEXT_LENGTH = 20000;
const MAX_ATTEMPT_TEXT_LENGTH = 8000;
const MAX_EVENT_COUNT = 120;
const MAX_RUN_HISTORY = 12;
const TAB_FOCUS_SETTLE_MS = 250;
let runInFlight = false;

function truncateText(value = "", maxLength = MAX_OUTPUT_TEXT_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`;
}

function tabIdList(tabs) {
  return tabs.map((tab) => tab.id).filter(Number.isInteger);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactTab(tab) {
  const provider = detectProviderFromUrl(tab.url);
  return {
    tabId: tab.id,
    title: tab.title || "Untitled tab",
    url: tab.url || "",
    providerId: provider?.id ?? "unsupported",
    providerLabel: provider?.label ?? "Unsupported",
    modelLabel: "",
    injectable: isInjectableUrl(tab.url)
  };
}

function memberFromTab(tab) {
  const compact = compactTab(tab);
  return {
    ...compact,
    label: compact.providerId === "generic" ? compact.title : compact.providerLabel,
    modelLabel: compact.modelLabel,
    status: compact.injectable ? "pending" : "blocked",
    reason: compact.injectable ? "" : "Only http and https tabs can be automated."
  };
}

function applyMemberRole(member, settings) {
  const role = roleForTab(member.tabId, settings);
  if (!canAutomateRole(role)) {
    return {
      ...member,
      role,
      status: role,
      reason: role === "exclude" ? "Excluded by role selection." : "Observer role; not automated."
    };
  }

  return {
    ...member,
    role,
    status: member.injectable ? member.status : "blocked"
  };
}

function readyRoundMembers(members) {
  return members.filter((member) => member.status === "ready" && isRoundRole(member.role));
}

function readyValidators(members) {
  return members.filter((member) => member.status === "ready" && isValidatorRole(member.role));
}

async function setBadge(active) {
  await chrome.action.setBadgeText({ text: active ? "MC" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2F6BFF" });
}

async function setRun(run) {
  await chrome.storage.local.set({ [CURRENT_RUN_KEY]: run });
  if (["complete", "failed", "aborted"].includes(run?.status)) {
    await archiveRun(run);
  }
}

async function getRun() {
  const { [CURRENT_RUN_KEY]: run } = await chrome.storage.local.get(CURRENT_RUN_KEY);
  return run ?? null;
}

async function getSettings() {
  const { [USER_SETTINGS_KEY]: settings } = await chrome.storage.local.get(USER_SETTINGS_KEY);
  return normalizeSettings(settings);
}

function runHistorySummary(run) {
  const synthesis = (run.synthesis?.outputs ?? []).find((output) => output.ok && output.structured)
    ?? (run.synthesis?.outputs ?? []).find((output) => output.ok);
  const finalAnswer = synthesis?.structured?.final_answer || synthesis?.text || "";
  return {
    id: run.id,
    status: run.status,
    phase: run.phase,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    prompt: truncateText(run.prompt, 280),
    memberCount: run.members?.length ?? 0,
    readyCount: (run.members ?? []).filter((member) => member.status === "ready").length,
    judgeLabel: run.judgeLabel || "",
    confidence: synthesis?.structured?.confidence ?? null,
    finalAnswer: truncateText(finalAnswer, 500),
    disagreement: run.disagreementCheck
      ? {
          disagree: Boolean(run.disagreementCheck.disagree),
          reason: run.disagreementCheck.reason || ""
        }
      : null,
    vetoCount: (run.ratification?.outputs ?? []).filter((output) => output.structured?.verdict === "VETO").length
  };
}

async function archiveRun(run) {
  if (!run?.id) return;
  const { [RUN_HISTORY_KEY]: existing = [] } = await chrome.storage.local.get(RUN_HISTORY_KEY);
  const summary = runHistorySummary(run);
  const next = [
    summary,
    ...existing.filter((item) => item?.id !== run.id)
  ].slice(0, MAX_RUN_HISTORY);
  await chrome.storage.local.set({ [RUN_HISTORY_KEY]: next });
}

function setRunPhase(run, phase) {
  run.phase = phase;
  run.updatedAt = Date.now();
}

function failRun(run, error) {
  run.status = "failed";
  run.phase = RUN_PHASES.FAILED;
  run.updatedAt = Date.now();
  run.errors.push(error);
}

function abortIfRequested(run) {
  if (run.abortRequested || activeAbortRunIds.has(run.id)) {
    run.status = "aborted";
    run.phase = RUN_PHASES.ABORTED;
    run.updatedAt = Date.now();
    throw new Error("Run aborted.");
  }
}

function addEvent(run, { level = "info", tabId = null, label = "", phase = run.phase, message }) {
  run.events ??= [];
  run.events.push({
    at: Date.now(),
    level,
    tabId,
    label,
    phase,
    message
  });
  if (run.events.length > MAX_EVENT_COUNT) run.events = run.events.slice(-MAX_EVENT_COUNT);
  run.updatedAt = Date.now();
}

async function logEvent(run, event) {
  addEvent(run, event);
  await setRun(run);
}

async function scanForCouncilGroup(preferredWindowId = null) {
  const groups = await chrome.tabGroups.query({});
  const currentWindow = Number.isInteger(preferredWindowId)
    ? { id: preferredWindowId }
    : await chrome.windows.getCurrent().catch(() => null);
  const councils = groups.filter(isCouncilGroup);
  const group =
    councils.find((candidate) => candidate.windowId === currentWindow?.id) ??
    councils[0] ??
    null;

  if (!group) {
    await chrome.storage.local.remove(ACTIVE_COUNCIL_KEY);
    await setBadge(false);
    return null;
  }

  const tabs = await chrome.tabs.query({ groupId: group.id });
  const activeCouncil = {
    groupId: group.id,
    windowId: group.windowId,
    title: group.title,
    color: group.color,
    tabIds: tabIdList(tabs),
    tabs: tabs.map(compactTab),
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({ [ACTIVE_COUNCIL_KEY]: activeCouncil });
  await setBadge(true);
  return activeCouncil;
}

async function clearCouncil(groupId) {
  const { [ACTIVE_COUNCIL_KEY]: activeCouncil } = await chrome.storage.local.get(ACTIVE_COUNCIL_KEY);
  if (!activeCouncil || activeCouncil.groupId !== groupId) return;

  await chrome.storage.local.remove(ACTIVE_COUNCIL_KEY);
  await setBadge(false);
}

async function refreshFromTabGroup(tab) {
  if (!Number.isInteger(tab.groupId) || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  try {
    const group = await chrome.tabGroups.get(tab.groupId);
    if (isCouncilGroup(group)) await scanForCouncilGroup();
  } catch {
    await scanForCouncilGroup();
  }
}

async function getState(options = {}) {
  const activeCouncil = await scanForCouncilGroup(options.windowId);
  const run = await getRun();
  const settings = await getSettings();
  const { [RUN_HISTORY_KEY]: history = [] } = await chrome.storage.local.get(RUN_HISTORY_KEY);
  return { activeCouncil, run, settings, history };
}

async function ensureContentScript(member) {
  if (!member.injectable) throw new Error(member.reason || "Tab is not injectable.");
  await chrome.scripting.executeScript({
    target: { tabId: member.tabId },
    files: [CONTENT_SCRIPT_FILE]
  });
}

async function focusTabForAutomation(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(TAB_FOCUS_SETTLE_MS);
}

function tabMessage(tabId, type, payload = {}) {
  return chrome.tabs.sendMessage(tabId, { type, payload });
}

async function waitForTabComplete(tabId, timeoutMs = NAVIGATION_TIMEOUT_MS) {
  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (existing?.status === "complete") return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(true);
    };

    const timeout = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function resetMemberThread(run, member) {
  const newThreadUrl = getNewThreadUrl(member.providerId);
  if (!member.injectable || !newThreadUrl) {
    await logEvent(run, {
      tabId: member.tabId,
      label: member.label,
      message: "No provider-specific new-thread URL; keeping current page."
    });
    return member;
  }

  await logEvent(run, {
    tabId: member.tabId,
    label: member.label,
    message: `Opening fresh ${member.providerLabel} thread.`
  });

  const updated = await chrome.tabs.update(member.tabId, { url: newThreadUrl });
  const loaded = await waitForTabComplete(member.tabId);
  const tab = await chrome.tabs.get(member.tabId).catch(() => updated);
  return {
    ...memberFromTab(tab),
    role: member.role,
    status: loaded ? "pending" : "blocked",
    reason: loaded ? "" : "Timed out opening fresh thread."
  };
}

async function probeMember(member) {
  try {
    await ensureContentScript(member);
    const probe = await tabMessage(member.tabId, "MC_PROBE");
    if (!probe?.ok || !probe.ready) {
      return {
        ...member,
        providerId: probe?.providerId ?? member.providerId,
        providerLabel: probe?.providerLabel ?? member.providerLabel,
        modelLabel: probe?.modelLabel ?? member.modelLabel ?? "",
        status: "blocked",
        reason: probe?.reason || probe?.error || "Adapter probe failed."
      };
    }

    return {
      ...member,
      providerId: probe.providerId ?? member.providerId,
      providerLabel: probe.providerLabel ?? getProviderLabel(member.providerId),
      modelLabel: probe.modelLabel || member.modelLabel || "",
      label: member.providerId === "generic" ? member.title : probe.providerLabel ?? member.label,
      status: "ready",
      reason: ""
    };
  } catch (error) {
    return {
      ...member,
      status: "blocked",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function outputFromResponse({ run, member, response, phase, startedAt, attempts }) {
  const rawText = response.text || "";
  const structured = parseCouncilOutput(rawText, phase);
  const parseError = structured.ok ? "" : structured.error;
  return {
    tabId: member.tabId,
    providerId: response.providerId ?? member.providerId,
    label: member.label,
    modelLabel: response.modelLabel || member.modelLabel || "",
    phase,
    ok: structured.ok,
    text: truncateText(rawText),
    truncated: rawText.length > MAX_OUTPUT_TEXT_LENGTH,
    structured: structured.ok ? structured.data : null,
    parseError,
    error: parseError,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      text: truncateText(attempt.text, MAX_ATTEMPT_TEXT_LENGTH)
    })),
    durationMs: Date.now() - startedAt,
    runId: run.id
  };
}

async function sendPromptToTab({ member, prompt, timeoutMs, run }) {
  return tabMessage(member.tabId, "MC_RUN_PROMPT", { prompt, timeoutMs, runId: run.id });
}

async function runPromptInTab({ run, member, prompt, timeoutMs, phase }) {
  const startedAt = Date.now();
  const attempts = [];
  try {
    abortIfRequested(run);
    await focusTabForAutomation(member.tabId);
    await logEvent(run, { tabId: member.tabId, label: member.label, phase, message: "Sending prompt." });
    const response = await sendPromptToTab({ member, prompt, timeoutMs, run });
    abortIfRequested(run);

    if (!response?.ok) {
      throw new Error(response?.error || "Tab automation failed.");
    }

    attempts.push({
      kind: "primary",
      text: response.text,
      parseError: parseCouncilOutput(response.text, phase).error || ""
    });

    let output = outputFromResponse({ run, member, response, phase, startedAt, attempts });
    if (!output.ok && response.text && (run.settings?.maxRepairAttempts ?? 0) > 0) {
      await logEvent(run, {
        level: "warn",
        tabId: member.tabId,
        label: member.label,
        phase,
        message: `Structured parse failed; sending JSON repair prompt. ${output.parseError}`
      });

      const repairPrompt = buildJsonRepairPrompt({
        runId: run.id,
        phase,
        parseError: output.parseError,
        badText: response.text
      });
      const repairResponse = await sendPromptToTab({ member, prompt: repairPrompt, timeoutMs, run });
      abortIfRequested(run);

      if (repairResponse?.ok) {
        attempts.push({
          kind: "repair",
          text: repairResponse.text,
          parseError: parseCouncilOutput(repairResponse.text, phase).error || ""
        });
        output = outputFromResponse({ run, member, response: repairResponse, phase, startedAt, attempts });
      }
    }

    await logEvent(run, {
      level: output.ok ? "info" : "error",
      tabId: member.tabId,
      label: member.label,
      phase,
      message: output.ok ? "Parsed structured response." : `Structured response failed. ${output.parseError}`
    });

    return output;
  } catch (error) {
    if (error instanceof Error && error.message === "Run aborted.") throw error;
    await logEvent(run, {
      level: "error",
      tabId: member.tabId,
      label: member.label,
      phase,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      tabId: member.tabId,
      providerId: member.providerId,
      label: member.label,
      phase,
      ok: false,
      text: "",
      error: error instanceof Error ? error.message : String(error),
      attempts,
      durationMs: Date.now() - startedAt
    };
  }
}

async function membersStillInGroup(run, members) {
  const tabs = await chrome.tabs.query({ groupId: run.groupId }).catch(() => []);
  const liveIds = new Set(tabs.map((tab) => tab.id));
  const removed = members.filter((member) => !liveIds.has(member.tabId));

  for (const member of removed) {
    const runMember = run.members.find((candidate) => candidate.tabId === member.tabId);
    if (runMember) {
      runMember.status = "removed";
      runMember.reason = "Tab moved out of tab-council group during run.";
    }
    addEvent(run, {
      level: "warn",
      tabId: member.tabId,
      label: member.label,
      message: "Tab moved out of group; excluding from remaining rounds."
    });
  }

  return members.filter((member) => liveIds.has(member.tabId));
}

async function runRound({ run, key, phase, members, promptForMember, timeoutMs }) {
  setRunPhase(run, phase);
  run.rounds[key] = { outputs: [], startedAt: Date.now(), completedAt: null };
  await setRun(run);

  members = await membersStillInGroup(run, members);
  const outputs = [];
  for (const member of members) {
    abortIfRequested(run);
    const output = await runPromptInTab({
      run,
      member,
      prompt: promptForMember(member),
      timeoutMs,
      phase
    });
    outputs.push(output);
    run.rounds[key].outputs = [...outputs].sort((a, b) => a.tabId - b.tabId);
    run.updatedAt = Date.now();
    await setRun(run);
  }

  run.rounds[key].completedAt = Date.now();
  await setRun(run);
  return run.rounds[key].outputs;
}

function successfulMembersForOutputs(members, outputs) {
  const successfulIds = new Set(
    outputs
      .filter((output) => output.ok && output.text?.trim())
      .map((output) => output.tabId)
  );
  return members.filter((member) => successfulIds.has(member.tabId));
}

function memberSucceeded(member, outputs) {
  return outputs.some((output) => output.tabId === member?.tabId && output.ok && output.text?.trim());
}

async function ensureJudgeSucceeded(run, readyMembers, judge, outputs, roundLabel) {
  if (memberSucceeded(judge, outputs)) return judge;

  if (run.judgeMode === "manual") {
    failRun(run, `Selected judge tab did not complete ${roundLabel}.`);
    await setRun(run);
    return null;
  }

  const fallbackJudge = chooseJudgeMember(successfulMembersForOutputs(readyMembers, outputs), "auto");
  if (!fallbackJudge) {
    failRun(run, `No successful judge candidate after ${roundLabel}.`);
    await setRun(run);
    return null;
  }

  addEvent(run, {
    level: "warn",
    tabId: fallbackJudge.tabId,
    label: fallbackJudge.label,
    message: `${judge?.label || "Auto judge"} did not complete ${roundLabel}; using ${fallbackJudge.label} as judge.`
  });
  run.judgeTabId = fallbackJudge.tabId;
  run.judgeLabel = fallbackJudge.label;
  await setRun(run);
  return fallbackJudge;
}

async function runDisagreementCheck(run, judge, round2Outputs) {
  setRunPhase(run, RUN_PHASES.DISAGREEMENT_CHECK);
  await setRun(run);

  const prompt = buildDisagreementPrompt({
    runId: run.id,
    prompt: run.prompt,
    round2Outputs
  });
  const output = await runPromptInTab({
    run,
    member: judge,
    prompt,
    timeoutMs: JUDGE_TIMEOUT_MS,
    phase: RUN_PHASES.DISAGREEMENT_CHECK
  });

  const parsed = output.ok && output.structured
    ? output.structured
    : output.ok
      ? parseDisagreement(output.text)
    : { disagree: false, reason: output.error || "Disagreement check failed." };

  run.disagreementCheck = {
    ...parsed,
    judgeTabId: judge.tabId,
    judgeLabel: judge.label,
    rawOutput: output
  };
  await setRun(run);
  return parsed;
}

async function runSynthesis(run, judges, round1Outputs, round2Outputs, round3Outputs) {
  setRunPhase(run, RUN_PHASES.SYNTHESIS);
  run.synthesis = { outputs: [], startedAt: Date.now(), completedAt: null };
  await setRun(run);

  const outputs = [];
  for (const judge of judges) {
    abortIfRequested(run);
    const output = await runPromptInTab({
      run,
      member: judge,
      prompt: buildSynthesisPrompt({
        runId: run.id,
        prompt: run.prompt,
        round1Outputs,
        round2Outputs,
        round3Outputs
      }),
      timeoutMs: JUDGE_TIMEOUT_MS,
      phase: RUN_PHASES.SYNTHESIS
    });
    outputs.push(output);
    run.synthesis.outputs = [...outputs].sort((a, b) => a.tabId - b.tabId);
    run.updatedAt = Date.now();
    await setRun(run);
  }

  run.synthesis.completedAt = Date.now();
  await setRun(run);
  return run.synthesis.outputs;
}

async function runRatification(run, reviewers, synthesisOutput) {
  if (!reviewers.length || !synthesisOutput) return [];

  setRunPhase(run, RUN_PHASES.RATIFICATION);
  run.ratification = { outputs: [], startedAt: Date.now(), completedAt: null };
  await setRun(run);

  const outputs = [];
  for (const reviewer of reviewers) {
    abortIfRequested(run);
    const output = await runPromptInTab({
      run,
      member: reviewer,
      prompt: buildRatificationPrompt({
        runId: run.id,
        prompt: run.prompt,
        member: reviewer,
        synthesisOutput
      }),
      timeoutMs: JUDGE_TIMEOUT_MS,
      phase: RUN_PHASES.RATIFICATION
    });
    outputs.push(output);
    run.ratification.outputs = [...outputs].sort((a, b) => a.tabId - b.tabId);
    run.updatedAt = Date.now();
    await setRun(run);
  }

  run.ratification.completedAt = Date.now();
  await setRun(run);
  return run.ratification.outputs;
}

async function startRun(options) {
  if (runInFlight) throw new Error("A council run is already active.");

  const existingRun = await getRun();
  if (existingRun?.status === "running") {
    const stale = Date.now() - (existingRun.updatedAt ?? existingRun.createdAt ?? 0) > RUN_STALE_MS;
    if (!stale) throw new Error("A council run is already active.");
    failRun(existingRun, "Previous run marked failed after stale service-worker recovery.");
    await setRun(existingRun);
  }

  runInFlight = true;
  let activeCouncil;
  let tabs;
  let settings;
  try {
    activeCouncil = await scanForCouncilGroup(options.windowId);
    if (!activeCouncil) throw new Error('Create or rename a tab group to "tab-council" first.');

    tabs = await chrome.tabs.query({ groupId: activeCouncil.groupId });
    const storedSettings = await getSettings();
    settings = normalizeSettings({ ...storedSettings, ...(options.settings ?? {}) });
    await chrome.storage.local.set({ [USER_SETTINGS_KEY]: settings });
  } catch (error) {
    runInFlight = false;
    throw error;
  }

  const run = {
    id: createRunId(),
    groupId: activeCouncil.groupId,
    prompt: options.prompt.trim(),
    forceRound3: Boolean(options.forceRound3),
    judgeMode: options.judgeMode || "auto",
    judgeTabId: Number.isInteger(options.judgeTabId) ? options.judgeTabId : null,
    status: "running",
    phase: RUN_PHASES.DISCOVERING,
    members: tabs.map((tab) => applyMemberRole(memberFromTab(tab), settings)),
    rounds: {},
    disagreementCheck: null,
    synthesis: null,
    settings,
    councilMode: settings.councilMode,
    ratifyEnabled: Boolean(options.ratifyEnabled ?? settings.ratifyEnabled),
    abortRequested: false,
    events: [],
    errors: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  activeAbortRunIds.delete(run.id);
  await setRun(run);

  try {
    abortIfRequested(run);
    setRunPhase(run, RUN_PHASES.INJECTING);
    addEvent(run, { message: "Run started." });
    await setRun(run);

    if (run.settings.isolateThreads) {
      addEvent(run, { message: "Thread isolation enabled; opening fresh model pages." });
      await setRun(run);
      run.members = await Promise.all(
        run.members.map((member) => canAutomateRole(member.role) ? resetMemberThread(run, member) : member)
      );
      await setRun(run);
    }

    run.members = await Promise.all(
      run.members.map((member) => canAutomateRole(member.role) ? probeMember(member) : member)
    );
    run.updatedAt = Date.now();
    for (const member of run.members) {
      addEvent(run, {
        level: member.status === "ready" ? "info" : "warn",
        tabId: member.tabId,
        label: member.label,
        message: member.status === "ready" ? "Adapter ready." : member.reason || "Adapter blocked."
      });
    }
    await setRun(run);

    const readyMembers = readyRoundMembers(run.members);
    if (readyMembers.length < 2) {
      failRun(run, "At least two ready debate-member AI tabs are required.");
      await setRun(run);
      return run;
    }

    let judge = chooseJudgeMember(readyMembers, run.judgeMode, run.judgeTabId);
    if (!judge) {
      failRun(run, run.judgeMode === "manual" ? "Selected judge tab is not ready." : "No ready judge tab found.");
      await setRun(run);
      return run;
    }
    run.judgeTabId = judge.tabId;
    run.judgeLabel = judge.label;
    await setRun(run);

    const round1Outputs = await runRound({
      run,
      key: "round1",
      phase: RUN_PHASES.ROUND_1,
      members: readyMembers,
      timeoutMs: ANSWER_TIMEOUT_MS,
      promptForMember: (member) => buildRound1Prompt({ runId: run.id, prompt: run.prompt, member })
    });

    const round1Success = round1Outputs.filter((output) => output.ok && output.text.trim());
    if (round1Success.length < 2) {
      failRun(run, "Fewer than two tabs completed Round 1.");
      await setRun(run);
      return run;
    }

    judge = await ensureJudgeSucceeded(run, readyMembers, judge, round1Success, "Round 1");
    if (!judge) return run;

    const round2Members = readyMembers.filter((member) => round1Success.some((output) => output.tabId === member.tabId));
    const round2Outputs = await runRound({
      run,
      key: "round2",
      phase: RUN_PHASES.ROUND_2,
      members: round2Members,
      timeoutMs: ANSWER_TIMEOUT_MS,
      promptForMember: (member) =>
        buildRound2Prompt({
          runId: run.id,
          prompt: run.prompt,
          member,
          round1Outputs: round1Success
        })
    });

    const round2Success = round2Outputs.filter((output) => output.ok && output.text.trim());
    if (round2Success.length < 2) {
      failRun(run, "Fewer than two tabs completed Round 2.");
      await setRun(run);
      return run;
    }

    judge = await ensureJudgeSucceeded(run, readyMembers, judge, round2Success, "Round 2");
    if (!judge) return run;

    const disagreement = await runDisagreementCheck(run, judge, round2Success);
    let round3Success = [];

    if (run.forceRound3 || disagreement.disagree) {
      const round3Outputs = await runRound({
        run,
        key: "round3",
        phase: RUN_PHASES.ROUND_3,
        members: round2Members,
        timeoutMs: ANSWER_TIMEOUT_MS,
        promptForMember: (member) =>
          buildRound3Prompt({
            runId: run.id,
            prompt: run.prompt,
            member,
            round2Outputs: round2Success
          })
      });
      round3Success = round3Outputs.filter((output) => output.ok && output.text.trim());
    }

    const judges = run.judgeMode === "all"
      ? successfulMembersForOutputs(readyMembers, round2Success)
      : [judge];
    const synthesisOutputs = await runSynthesis(run, judges, round1Success, round2Success, round3Success);

    const synthesisSuccess = synthesisOutputs.find((output) => output.ok && output.text.trim());
    if (run.ratifyEnabled && synthesisSuccess) {
      const judgeIds = new Set(judges.map((member) => member.tabId));
      const validators = readyValidators(run.members);
      const ratifiers = (validators.length ? validators : successfulMembersForOutputs(readyMembers, round2Success))
        .filter((member) => !judgeIds.has(member.tabId));
      if (ratifiers.length) {
        await runRatification(run, ratifiers, synthesisSuccess);
      } else {
        addEvent(run, {
          level: "warn",
          message: "Ratify/veto enabled but no non-judge successful members were available."
        });
        await setRun(run);
      }
    }

    run.status = "complete";
    setRunPhase(run, RUN_PHASES.COMPLETE);
    addEvent(run, { message: "Run complete." });
    await setRun(run);
    return run;
  } catch (error) {
    if (error instanceof Error && error.message === "Run aborted.") {
      run.status = "aborted";
      run.phase = RUN_PHASES.ABORTED;
    } else {
      failRun(run, error instanceof Error ? error.message : String(error));
    }
    await setRun(run);
    return run;
  } finally {
    activeAbortRunIds.delete(run.id);
    runInFlight = false;
  }
}

async function abortCurrentRun() {
  const run = await getRun();
  if (!run || run.status !== "running") return run;
  activeAbortRunIds.add(run.id);
  run.abortRequested = true;
  await Promise.all(
    (run.members ?? []).map((member) =>
      tabMessage(member.tabId, "MC_ABORT", { runId: run.id }).catch(() => null)
    )
  );
  run.status = "aborted";
  run.phase = RUN_PHASES.ABORTED;
  run.updatedAt = Date.now();
  await setRun(run);
  return run;
}

async function rerunCurrentSynthesis() {
  const run = await getRun();
  if (!run) throw new Error("No run to synthesize.");
  if (run.status === "running") throw new Error("Cannot rerun synthesis while a run is active.");

  const round1Success = (run.rounds?.round1?.outputs ?? []).filter((output) => output.ok && output.text.trim());
  const round2Success = (run.rounds?.round2?.outputs ?? []).filter((output) => output.ok && output.text.trim());
  const round3Success = (run.rounds?.round3?.outputs ?? []).filter((output) => output.ok && output.text.trim());
  if (round1Success.length < 2 || round2Success.length < 2) {
    throw new Error("Need at least two successful Round 1 and Round 2 outputs.");
  }

  const members = successfulMembersForOutputs(
    readyRoundMembers(run.members ?? []),
    round2Success
  );
  const judge = chooseJudgeMember(members, run.judgeMode, run.judgeTabId);
  if (!judge) throw new Error("No successful judge tab found.");

  run.status = "running";
  run.judgeTabId = judge.tabId;
  run.judgeLabel = judge.label;
  run.ratification = null;
  addEvent(run, { message: "Rerunning synthesis from stored structured outputs." });
  await setRun(run);

  const judges = run.judgeMode === "all" ? members : [judge];
  const synthesisOutputs = await runSynthesis(run, judges, round1Success, round2Success, round3Success);
  const synthesisSuccess = synthesisOutputs.find((output) => output.ok && output.text.trim());
  if (run.ratifyEnabled && synthesisSuccess) {
    const judgeIds = new Set(judges.map((member) => member.tabId));
    const validators = readyValidators(run.members ?? []);
    const ratifiers = (validators.length ? validators : members).filter((member) => !judgeIds.has(member.tabId));
    await runRatification(run, ratifiers, synthesisSuccess);
  }
  run.status = "complete";
  setRunPhase(run, RUN_PHASES.COMPLETE);
  addEvent(run, { message: "Synthesis rerun complete." });
  await setRun(run);
  return run;
}

async function clearCurrentRun() {
  await chrome.storage.local.remove([CURRENT_RUN_KEY, RUN_HISTORY_KEY]);
  return null;
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await scanForCouncilGroup();
});

chrome.runtime.onStartup.addListener(scanForCouncilGroup);

chrome.tabGroups.onCreated.addListener(async (group) => {
  if (isCouncilGroup(group)) await scanForCouncilGroup();
});

chrome.tabGroups.onUpdated.addListener(async (group) => {
  if (isCouncilGroup(group)) {
    await scanForCouncilGroup();
    return;
  }
  await clearCouncil(group.id);
});

chrome.tabGroups.onRemoved.addListener((group) => {
  clearCouncil(group.id);
});

chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
  refreshFromTabGroup(tab);
});

chrome.tabs.onRemoved.addListener(scanForCouncilGroup);
chrome.tabs.onDetached.addListener(scanForCouncilGroup);
chrome.tabs.onAttached.addListener(scanForCouncilGroup);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "GET_STATE") {
    getState(message.payload ?? {})
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "ABORT_RUN") {
    abortCurrentRun()
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "RERUN_SYNTHESIS") {
    rerunCurrentSynthesis()
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "CLEAR_RUN") {
    clearCurrentRun()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.local
      .set({ [USER_SETTINGS_KEY]: normalizeSettings(message.payload?.settings ?? {}) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RUN_PORT_NAME) return;
  let startedRun = false;

  port.onMessage.addListener((message) => {
    if (message?.type !== "START_RUN") return;

    startedRun = true;
    startRun(message.payload)
      .then((run) => port.postMessage({ type: "RUN_FINISHED", run }))
      .catch((error) => port.postMessage({ type: "RUN_FAILED", error: error instanceof Error ? error.message : String(error) }));
  });

  port.onDisconnect.addListener(async () => {
    if (!startedRun) return;
    const run = await getRun();
    if (run?.status === "running") {
      addEvent(run, {
        level: "warn",
        message: "Side panel disconnected; run may continue if Chrome keeps the service worker alive."
      });
      await setRun(run);
    }
  });
});
