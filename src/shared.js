export const COUNCIL_GROUP_NAME = "tab-council";
export const ACTIVE_COUNCIL_KEY = "activeCouncil";
export const CURRENT_RUN_KEY = "currentRun";
export const RUN_HISTORY_KEY = "runHistory";
export const USER_SETTINGS_KEY = "userSettings";
export const RUN_PORT_NAME = "model-council-run";
export const CONTENT_SCRIPT_FILE = "src/contentScript.js";
export const EXTERNAL_API_VERSION = 1;

export const EXTERNAL_MESSAGE_TYPES = {
  GET_STATE: "TC_GET_STATE",
  PREPARE_COUNCIL: "TC_PREPARE_COUNCIL"
};

export const MEMBER_ROLES = {
  MEMBER: "member",
  JUDGE: "judge",
  VALIDATOR: "validator",
  OBSERVER: "observer",
  EXCLUDE: "exclude"
};

export const RUN_PHASES = {
  DISCOVERING: "discovering",
  REQUESTING_PERMISSIONS: "requesting-permissions",
  INJECTING: "injecting",
  ROUND_1: "round1",
  ROUND_2: "round2",
  DISAGREEMENT_CHECK: "disagreement-check",
  ROUND_3: "round3",
  SYNTHESIS: "synthesis",
  RATIFICATION: "ratification",
  COMPLETE: "complete",
  FAILED: "failed",
  ABORTED: "aborted"
};

export const ANSWER_TIMEOUT_MS = 180000;
export const JUDGE_TIMEOUT_MS = 180000;
export const NAVIGATION_TIMEOUT_MS = 30000;
export const RUN_STALE_MS = 30 * 60 * 1000;

export const DEFAULT_USER_SETTINGS = {
  councilMode: "balanced",
  isolateThreads: true,
  includeRawInExport: false,
  ratifyEnabled: false,
  viewMode: "grid",
  memberRoles: {},
  maxRepairAttempts: 1
};

export const PROVIDERS = [
  {
    id: "claude",
    label: "Claude",
    hostPatterns: ["claude.ai"],
    permissionPatterns: ["https://claude.ai/*"],
    newThreadUrl: "https://claude.ai/new",
    judgePriority: 1
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    hostPatterns: ["chatgpt.com", "chat.openai.com"],
    permissionPatterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    newThreadUrl: "https://chatgpt.com/",
    judgePriority: 2
  },
  {
    id: "perplexity",
    label: "Perplexity",
    hostPatterns: ["perplexity.ai", "www.perplexity.ai"],
    permissionPatterns: ["https://perplexity.ai/*", "https://www.perplexity.ai/*"],
    newThreadUrl: "https://www.perplexity.ai/",
    judgePriority: 3
  },
  {
    id: "merlin",
    label: "Merlin",
    hostPatterns: ["getmerlin.in", "www.getmerlin.in", "extension.getmerlin.in"],
    permissionPatterns: [
      "https://getmerlin.in/*",
      "https://www.getmerlin.in/*",
      "https://extension.getmerlin.in/*"
    ],
    newThreadUrl: "https://extension.getmerlin.in/chat",
    judgePriority: 4
  },
  {
    id: "gemini",
    label: "Gemini",
    hostPatterns: ["gemini.google.com"],
    permissionPatterns: ["https://gemini.google.com/*"],
    newThreadUrl: "https://gemini.google.com/app",
    judgePriority: 5
  },
  {
    id: "grok",
    label: "Grok",
    hostPatterns: ["grok.com", "x.com", "x.ai"],
    permissionPatterns: ["https://grok.com/*", "https://x.com/*", "https://x.ai/*", "https://*.x.ai/*"],
    newThreadUrl: "https://grok.com/",
    judgePriority: 6
  }
];

export const GENERIC_PROVIDER = {
  id: "generic",
  label: "Generic AI Tab",
  hostPatterns: [],
  permissionPatterns: [],
  newThreadUrl: "",
  judgePriority: 99
};

export function normalizeGroupTitle(title = "") {
  return title.trim().toLowerCase();
}

export function normalizeExternalApiMessage(message = {}) {
  if (!message || typeof message !== "object") return null;
  const type = typeof message.type === "string" ? message.type : "";
  if (!Object.values(EXTERNAL_MESSAGE_TYPES).includes(type)) return null;
  const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
    ? message.payload
    : {};
  return { type, payload };
}

export function isCouncilGroup(group) {
  return normalizeGroupTitle(group?.title) === COUNCIL_GROUP_NAME;
}

export function isInjectableUrl(url = "") {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function detectProviderFromUrl(url = "") {
  if (!isInjectableUrl(url)) return null;

  const { hostname } = new URL(url);
  const normalizedHost = hostname.toLowerCase();
  return (
    PROVIDERS.find((provider) =>
      provider.hostPatterns.some(
        (host) => normalizedHost === host || normalizedHost.endsWith(`.${host}`)
      )
    ) ?? GENERIC_PROVIDER
  );
}

export function getProviderById(providerId) {
  return [...PROVIDERS, GENERIC_PROVIDER].find((provider) => provider.id === providerId) ?? null;
}

export function isKnownProviderId(providerId) {
  return PROVIDERS.some((provider) => provider.id === providerId);
}

export function isLocalDevUrl(url = "") {
  if (!isInjectableUrl(url)) return false;
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function originPatternForUrl(url = "") {
  if (!isInjectableUrl(url)) return null;
  const provider = detectProviderFromUrl(url);
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  if (provider && provider.id !== GENERIC_PROVIDER.id) {
    const directPattern = [...provider.permissionPatterns]
      .sort((a, b) => b.length - a.length)
      .find((pattern) => {
        const patternHost = pattern.replace(/^https?:\/\//, "").replace(/\/\*$/, "").toLowerCase();
        if (patternHost.startsWith("*.")) {
          const bareHost = patternHost.slice(2);
          return hostname === bareHost || hostname.endsWith(`.${bareHost}`);
        }
        return hostname === patternHost;
      });
    if (directPattern) return directPattern;
  }

  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function permissionOriginsForUrl(url = "", settings = DEFAULT_USER_SETTINGS) {
  if (!isInjectableUrl(url)) return [];
  const provider = detectProviderFromUrl(url);

  if (provider && provider.id !== GENERIC_PROVIDER.id) {
    const origins = [...provider.permissionPatterns];
    const newThreadUrl = settings.isolateThreads ? provider.newThreadUrl : "";
    const newThreadProvider = detectProviderFromUrl(newThreadUrl);
    if (newThreadProvider && newThreadProvider.id !== GENERIC_PROVIDER.id) {
      origins.push(...newThreadProvider.permissionPatterns);
    }
    return [...new Set(origins)];
  }

  if (isLocalDevUrl(url)) return [originPatternForUrl(url)];
  return [];
}

export function permissionOriginsForTabs(tabs = [], settings = DEFAULT_USER_SETTINGS) {
  return [
    ...new Set(
      tabs.flatMap((tab) => permissionOriginsForUrl(tab.url, settings)).filter(Boolean)
    )
  ];
}

export function getProviderLabel(providerId) {
  return getProviderById(providerId)?.label ?? providerId;
}

export function getJudgePriority(providerId) {
  return getProviderById(providerId)?.judgePriority ?? 100;
}

export function getNewThreadUrl(providerId) {
  return getProviderById(providerId)?.newThreadUrl ?? "";
}

export function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined)
    ),
    memberRoles: normalizeMemberRoles(settings.memberRoles)
  };
}

export function normalizeMemberRole(role = MEMBER_ROLES.MEMBER) {
  return Object.values(MEMBER_ROLES).includes(role) ? role : MEMBER_ROLES.MEMBER;
}

export function normalizeMemberRoles(memberRoles = {}) {
  if (!memberRoles || typeof memberRoles !== "object" || Array.isArray(memberRoles)) return {};
  return Object.fromEntries(
    Object.entries(memberRoles)
      .map(([key, value]) => [String(key), normalizeMemberRole(value)])
      .filter(([key]) => key)
  );
}

export function roleForTab(tabId, settings = DEFAULT_USER_SETTINGS) {
  return normalizeMemberRole(settings.memberRoles?.[String(tabId)] ?? MEMBER_ROLES.MEMBER);
}

export function canAutomateRole(role) {
  return [MEMBER_ROLES.MEMBER, MEMBER_ROLES.JUDGE, MEMBER_ROLES.VALIDATOR].includes(normalizeMemberRole(role));
}

export function isRoundRole(role) {
  return [MEMBER_ROLES.MEMBER, MEMBER_ROLES.JUDGE].includes(normalizeMemberRole(role));
}

export function isValidatorRole(role) {
  return normalizeMemberRole(role) === MEMBER_ROLES.VALIDATOR;
}

export function chooseJudgeMember(members, judgeMode = "auto", judgeTabId = null) {
  const readyMembers = members.filter((member) => member.status === "ready" && isRoundRole(member.role));
  if (!readyMembers.length) return null;

  if (judgeMode === "manual" && Number.isInteger(judgeTabId)) {
    const selected = readyMembers.find((member) => member.tabId === judgeTabId);
    return selected ?? null;
  }

  return [...readyMembers].sort((a, b) => {
    const roleDelta = (a.role === MEMBER_ROLES.JUDGE ? 0 : 1) - (b.role === MEMBER_ROLES.JUDGE ? 0 : 1);
    if (roleDelta !== 0) return roleDelta;
    const priorityDelta = getJudgePriority(a.providerId) - getJudgePriority(b.providerId);
    if (priorityDelta !== 0) return priorityDelta;
    return a.tabId - b.tabId;
  })[0];
}

export function createRunId() {
  return `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function safeJsonFromText(text = "") {
  const trimmed = text.trim();
  const candidates = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const balancedObject = firstBalancedJsonObject(trimmed);
  if (balancedObject) candidates.push(balancedObject);

  candidates.push(trimmed);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function parseDisagreement(text = "") {
  const parsed = safeJsonFromText(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      disagree: false,
      reason: "Judge did not return valid JSON."
    };
  }

  return {
    disagree: normalizeBoolean(parsed.disagree, false),
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}

export function parseCouncilOutput(text = "", phase = "") {
  const parsed = safeJsonFromText(text) ?? relaxedJsonFromText(text, phase);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, data: null, error: "No valid JSON object found." };
  }

  if (phase === RUN_PHASES.ROUND_1) {
    const data = {
      answer: stringValue(parsed.answer ?? parsed.final_answer ?? parsed.response),
      key_points: stringArray(parsed.key_points ?? parsed.keyPoints ?? parsed.points),
      uncertainty: stringValue(parsed.uncertainty ?? parsed.open_questions ?? parsed.openQuestions),
      confidence: normalizeConfidence(parsed.confidence)
    };
    return requireStructuredFields(data, ["answer"]);
  }

  if (phase === RUN_PHASES.ROUND_2) {
    const data = {
      agree: stringArray(parsed.agree ?? parsed.agreements),
      disagree: stringArray(parsed.disagree ?? parsed.disagreements),
      updated_answer: stringValue(parsed.updated_answer ?? parsed.updatedAnswer ?? parsed.answer),
      changed: normalizeBoolean(parsed.changed ?? parsed.changed_answer ?? parsed.changedAnswer, false),
      confidence: normalizeConfidence(parsed.confidence)
    };
    return requireStructuredFields(data, ["updated_answer"]);
  }

  if (phase === RUN_PHASES.ROUND_3) {
    const data = {
      final_answer: stringValue(parsed.final_answer ?? parsed.finalAnswer ?? parsed.answer),
      remaining_disagreement: stringValue(
        parsed.remaining_disagreement ?? parsed.remainingDisagreement ?? parsed.disagreement
      ),
      reasoning: stringValue(parsed.reasoning ?? parsed.reasoning_trace ?? parsed.reasoningTrace),
      confidence: normalizeConfidence(parsed.confidence)
    };
    return requireStructuredFields(data, ["final_answer"]);
  }

  if (phase === RUN_PHASES.DISAGREEMENT_CHECK) {
    const data = {
      disagree: normalizeBoolean(parsed.disagree, false),
      reason: stringValue(parsed.reason)
    };
    return requireStructuredFields(data, ["reason"]);
  }

  if (phase === RUN_PHASES.SYNTHESIS) {
    const data = {
      final_answer: stringValue(parsed.final_answer ?? parsed.finalAnswer ?? parsed.answer),
      verdict_table: verdictRows(parsed.verdict_table ?? parsed.verdictTable ?? parsed.verdict),
      agreements: stringArray(parsed.agreements ?? parsed.where_models_agreed ?? parsed.whereModelsAgreed),
      disagreements: stringArray(parsed.disagreements ?? parsed.where_models_disagreed ?? parsed.whereModelsDisagreed),
      confidence: normalizeConfidence(parsed.confidence),
      open_questions: stringArray(parsed.open_questions ?? parsed.openQuestions)
    };
    return requireStructuredFields(data, ["final_answer"]);
  }

  if (phase === RUN_PHASES.RATIFICATION) {
    const data = {
      verdict: ratificationVerdict(parsed.verdict ?? parsed.decision),
      veto_clause: stringValue(parsed.veto_clause ?? parsed.vetoClause ?? parsed.clause),
      reason: stringValue(parsed.reason ?? parsed.reasoning),
      confidence: normalizeConfidence(parsed.confidence)
    };
    return requireStructuredFields(data, ["verdict", "reason"]);
  }

  return { ok: true, data: parsed, error: "" };
}

const RELAXED_PHASE_FIELDS = {
  [RUN_PHASES.ROUND_1]: [
    ["answer", "string"],
    ["key_points", "stringArray"],
    ["uncertainty", "string"],
    ["confidence", "confidence"]
  ],
  [RUN_PHASES.ROUND_2]: [
    ["agree", "stringArray"],
    ["disagree", "stringArray"],
    ["updated_answer", "string"],
    ["changed", "boolean"],
    ["confidence", "confidence"]
  ],
  [RUN_PHASES.ROUND_3]: [
    ["final_answer", "string"],
    ["remaining_disagreement", "string"],
    ["reasoning", "string"],
    ["confidence", "confidence"]
  ],
  [RUN_PHASES.DISAGREEMENT_CHECK]: [
    ["disagree", "boolean"],
    ["reason", "string"]
  ],
  [RUN_PHASES.SYNTHESIS]: [
    ["final_answer", "string"],
    ["verdict_table", "jsonArray"],
    ["agreements", "stringArray"],
    ["disagreements", "stringArray"],
    ["confidence", "confidence"],
    ["open_questions", "stringArray"]
  ],
  [RUN_PHASES.RATIFICATION]: [
    ["verdict", "string"],
    ["veto_clause", "string"],
    ["reason", "string"],
    ["confidence", "confidence"]
  ]
};

function relaxedJsonFromText(text = "", phase = "") {
  const fields = RELAXED_PHASE_FIELDS[phase];
  if (!fields) return null;

  const objectText = looseOuterJsonObject(text);
  if (!objectText) return null;

  const markers = fields
    .map(([field, type]) => {
      const match = new RegExp(`["']${escapeRegExp(field)}["']\\s*:`).exec(objectText);
      return match ? { field, type, start: match.index, valueStart: match.index + match[0].length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (!markers.length) return null;

  const data = {};
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const rawValue = stripTrailingComma(objectText.slice(marker.valueStart, next?.start ?? objectText.lastIndexOf("}")));
    data[marker.field] = relaxedValue(rawValue, marker.type);
  }

  return data;
}

function looseOuterJsonObject(text = "") {
  const trimmed = text.trim();
  const balanced = firstBalancedJsonObject(trimmed);
  if (balanced) return balanced;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return trimmed.slice(start, end + 1);
}

function stripTrailingComma(value = "") {
  return value.trim().replace(/,\s*$/, "").trim();
}

function relaxedValue(value = "", type = "string") {
  if (type === "string") return relaxedString(value);
  if (type === "stringArray") return relaxedStringArray(value);
  if (type === "boolean") return normalizeBoolean(relaxedString(value) || value, false);
  if (type === "confidence") return normalizeConfidence(value);
  if (type === "jsonArray") return relaxedJsonArray(value);
  return relaxedString(value);
}

function relaxedString(value = "") {
  const trimmed = stripTrailingComma(value);
  if (!trimmed) return "";

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.lastIndexOf(quote);
    const inner = end > 0 ? trimmed.slice(1, end) : trimmed.slice(1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .trim();
  }

  return trimmed.replace(/^`+|`+$/g, "").trim();
}

function relaxedStringArray(value = "") {
  const trimmed = stripTrailingComma(value);
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return stringArray(parsed);
  } catch {
    // Continue with a loose split for schema-shaped but malformed arrays.
  }

  const body = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const quoted = [...body.matchAll(/(["'])([\s\S]*?)\1\s*(?:,|$)/g)].map((match) => relaxedString(match[0]));
  if (quoted.length) return quoted.filter(Boolean);

  return body
    .split(/\n|,(?=\s*\S)/)
    .map(relaxedString)
    .filter(Boolean);
}

function relaxedJsonArray(value = "") {
  const trimmed = stripTrailingComma(value);
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstBalancedJsonObject(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }

  return "";
}

function stringValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function stringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const single = stringValue(value);
  return single ? [single] : [];
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeConfidence(value) {
  if (typeof value === "number" && Number.isFinite(value)) return clampConfidence(value);
  if (typeof value === "string") {
    const match = value.match(/([0-5](?:\.\d+)?)\s*(?:\/\s*5)?/);
    if (match) return clampConfidence(Number(match[1]));
  }
  return null;
}

function clampConfidence(value) {
  return Math.max(0, Math.min(5, Number(value.toFixed(1))));
}

function verdictRows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      model: stringValue(row.model ?? row.label),
      agree: normalizeBoolean(row.agree, false),
      disagree: normalizeBoolean(row.disagree, false),
      confidence: normalizeConfidence(row.confidence),
      reasoning_trace: stringValue(row.reasoning_trace ?? row.reasoningTrace ?? row.reasoning)
    }))
    .filter((row) => row.model || row.reasoning_trace);
}

function ratificationVerdict(value) {
  const normalized = stringValue(value).toUpperCase();
  if (normalized.includes("VETO")) return "VETO";
  if (normalized.includes("RATIFY")) return "RATIFY";
  return normalized;
}

function requireStructuredFields(data, fields) {
  const missing = fields.filter((field) => {
    const value = data[field];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });

  if (missing.length) {
    return {
      ok: false,
      data,
      error: `Structured JSON missing required field(s): ${missing.join(", ")}.`
    };
  }

  return { ok: true, data, error: "" };
}
