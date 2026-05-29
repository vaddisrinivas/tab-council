export const FAKE_PROVIDER_MODES = ["normal", "invalid-json", "disagreement", "busy", "stale"];

export const FAKE_PROVIDER_CASES = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    route: "/chatgpt",
    sampleUrl: "https://chatgpt.com/c/fake-model-council",
    selectors: {
      input: "#prompt-textarea",
      response: "[data-message-author-role='assistant']",
      send: "button[data-testid='send-button']",
      busy: "button[data-testid='stop-button']"
    },
    fragments: {
      input: 'id="prompt-textarea"',
      response: 'data-message-author-role="assistant"',
      send: 'data-testid="send-button"',
      busy: 'data-testid="stop-button"'
    }
  },
  {
    id: "claude",
    label: "Claude",
    route: "/claude",
    sampleUrl: "https://claude.ai/chat/fake-model-council",
    selectors: {
      input: ".ProseMirror",
      response: ".font-claude-response",
      send: "button[aria-label*='Send']",
      busy: "button[aria-label*='Stop']"
    },
    fragments: {
      input: 'class="ProseMirror"',
      response: 'class="font-claude-response',
      send: 'aria-label="Send message"',
      busy: 'aria-label="Stop response"'
    }
  },
  {
    id: "gemini",
    label: "Gemini",
    route: "/gemini",
    sampleUrl: "https://gemini.google.com/app/fake-model-council",
    selectors: {
      input: "rich-textarea div[contenteditable='true']",
      response: "message-content",
      send: "button.send-button",
      busy: ".response-container.generating"
    },
    fragments: {
      input: "<rich-textarea",
      response: "<message-content",
      send: 'class="send-button"',
      busy: 'class="response-container generating"'
    }
  },
  {
    id: "perplexity",
    label: "Perplexity",
    route: "/perplexity",
    sampleUrl: "https://www.perplexity.ai/search/fake-model-council",
    selectors: {
      input: "textarea",
      response: "[data-testid*='answer']",
      send: "button[aria-label*='Submit']",
      busy: "[data-testid*='stop']"
    },
    fragments: {
      input: "<textarea",
      response: 'data-testid="answer-0"',
      send: 'aria-label="Submit"',
      busy: 'data-testid="stop-generating"'
    }
  },
  {
    id: "merlin",
    label: "Merlin",
    route: "/merlin",
    sampleUrl: "https://extension.getmerlin.in/chat",
    selectors: {
      input: "[role='textbox']",
      response: "[data-testid*='message']",
      send: "button[type='submit']",
      busy: "[aria-busy='true']"
    },
    fragments: {
      input: 'role="textbox"',
      response: 'data-testid="message-answer"',
      send: 'type="submit"',
      busy: 'aria-busy="true"'
    }
  },
  {
    id: "grok",
    label: "Grok",
    route: "/grok",
    sampleUrl: "https://grok.com/chat/fake-model-council",
    selectors: {
      input: ".ProseMirror",
      response: "[data-testid*='message']",
      send: "button[data-testid*='send']",
      busy: "[data-testid*='stop']"
    },
    fragments: {
      input: 'class="ProseMirror"',
      response: 'data-testid="message-0"',
      send: 'data-testid="send-button"',
      busy: 'data-testid="stop-button"'
    }
  }
];

export const FAKE_PROVIDER_COVERAGE_PLAN = {
  providers: FAKE_PROVIDER_CASES.map((provider) => provider.id),
  modes: FAKE_PROVIDER_MODES,
  checks: [
    "provider DOM exposes adapter input/send/response selectors",
    "invalid-json mode forces parse failure before repair",
    "repair prompts return phase-valid JSON",
    "disagreement mode returns unresolved disagreement JSON",
    "busy mode exposes provider busy indicator",
    "stale mode preloads old transcript before fresh answer"
  ]
};

const PROVIDER_BY_ID = new Map(FAKE_PROVIDER_CASES.map((provider) => [provider.id, provider]));

export function fakeProvider(providerId = "chatgpt") {
  return PROVIDER_BY_ID.get(providerId) ?? FAKE_PROVIDER_CASES[0];
}

export function providerIdFromPath(pathname = "") {
  const firstSegment = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  return PROVIDER_BY_ID.has(firstSegment) ? firstSegment : "";
}

export function normalizeFakeMode(mode = "normal") {
  return FAKE_PROVIDER_MODES.includes(mode) ? mode : "normal";
}

export function answerFor(prompt = "", options = {}) {
  const provider = fakeProvider(options.providerId);
  const mode = normalizeFakeMode(options.mode);
  const phase = phaseForPrompt(prompt);

  if (mode === "invalid-json" && !phase.repair) {
    return `${provider.label} fixture response: answer is 4, confidence is five.`;
  }

  const response = structuredAnswerFor({ provider, mode, phase });
  return JSON.stringify(response, null, 2);
}

export function renderFakeProviderBody(options = {}) {
  const provider = fakeProvider(options.providerId);
  const mode = normalizeFakeMode(options.mode);
  const stale = mode === "stale" ? renderResponse(provider, staleTranscript(provider), { stale: true }) : "";
  const busy = mode === "busy" ? renderBusy(provider) : "";

  return `
    <main data-fake-provider="${provider.id}" data-fake-mode="${mode}">
      <h1>${provider.label} Fake AI</h1>
      <button type="button" data-model-council-model>${provider.label} Test Model</button>
      <form id="chat">
        ${renderComposer(provider)}
        ${renderSendButton(provider)}
      </form>
      ${busy}
      ${stale}
      ${renderResponse(provider, "", { live: true })}
    </main>
  `;
}

export function wireFakeProviderPage(options = {}) {
  const provider = fakeProvider(options.providerId);
  const mode = normalizeFakeMode(options.mode);
  const form = document.querySelector("#chat");
  const input = document.querySelector("[data-model-council-input]");
  const response = document.querySelector("[data-fake-live-response]");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    response.textContent = answerFor(inputText(input), { providerId: provider.id, mode });
    clearInput(input);
  });
}

function phaseForPrompt(prompt) {
  const repairMatch = prompt.match(/ROUND=([^;\]]+):REPAIR/);
  if (repairMatch) return { name: normalizePhase(repairMatch[1]), repair: true };
  if (prompt.includes("ROUND=2")) return { name: "round2", repair: false };
  if (prompt.includes("ROUND=3")) return { name: "round3", repair: false };
  if (prompt.includes("DISAGREEMENT_CHECK")) return { name: "disagreement-check", repair: false };
  if (prompt.includes("SYNTHESIS")) return { name: "synthesis", repair: false };
  if (prompt.includes("RATIFICATION")) return { name: "ratification", repair: false };
  return { name: "round1", repair: false };
}

function normalizePhase(phase) {
  if (phase === "1") return "round1";
  if (phase === "2") return "round2";
  if (phase === "3") return "round3";
  if (phase === "DISAGREEMENT_CHECK") return "disagreement-check";
  if (phase === "RATIFICATION") return "ratification";
  return phase;
}

function structuredAnswerFor({ provider, mode, phase }) {
  const label = provider.label;
  const suffix = mode === "stale" ? "fresh" : "deterministic";

  if (phase.name === "round2") {
    return {
      agree: ["2+2 is 4"],
      disagree: mode === "disagreement" ? [`${label} keeps a fixture disagreement`] : [],
      updated_answer: mode === "disagreement" ? `${label}: 4, with unresolved fixture caveat.` : "4",
      changed: mode === "disagreement",
      confidence: mode === "disagreement" ? 3 : 5
    };
  }

  if (phase.name === "round3") {
    return {
      final_answer: mode === "disagreement" ? `${label}: final answer is still 4 with caveat.` : "4",
      remaining_disagreement: mode === "disagreement" ? `${label} fixture caveat remains.` : "",
      reasoning: `${label} ${suffix} round 3 response.`,
      confidence: mode === "disagreement" ? 3 : 5
    };
  }

  if (phase.name === "disagreement-check") {
    return {
      disagree: mode === "disagreement",
      reason: mode === "disagreement" ? `${label} fixture reports unresolved disagreement.` : "All fake members agree."
    };
  }

  if (phase.name === "synthesis") {
    return {
      final_answer: "4",
      verdict_table: [
        {
          model: label,
          agree: true,
          disagree: mode === "disagreement",
          confidence: mode === "disagreement" ? 3 : 5,
          reasoning_trace: `${label} fixture synthesis.`
        }
      ],
      agreements: ["2+2 is 4"],
      disagreements: mode === "disagreement" ? [`${label} fixture caveat`] : [],
      confidence: mode === "disagreement" ? 3 : 5,
      open_questions: []
    };
  }

  if (phase.name === "ratification") {
    return {
      verdict: mode === "disagreement" ? "VETO" : "RATIFY",
      veto_clause: mode === "disagreement" ? `${label} fixture clause` : "",
      reason: mode === "disagreement" ? `${label} fixture veto.` : `${label} fixture ratifies.`,
      confidence: mode === "disagreement" ? 3 : 5
    };
  }

  return {
    answer: "4",
    key_points: [`${label} ${suffix} fixture answer`, "2 plus 2 equals 4"],
    uncertainty: "",
    confidence: 5
  };
}

function renderComposer(provider) {
  if (provider.id === "chatgpt") {
    return '<textarea id="prompt-textarea" data-model-council-input placeholder="Message ChatGPT"></textarea>';
  }

  if (provider.id === "claude") {
    return '<div class="ProseMirror" contenteditable="true" data-model-council-input aria-label="Message Claude"></div>';
  }

  if (provider.id === "gemini") {
    return '<rich-textarea><div contenteditable="true" data-model-council-input aria-label="Message Gemini"></div></rich-textarea>';
  }

  if (provider.id === "merlin") {
    return '<div class="ProseMirror" role="textbox" contenteditable="true" data-model-council-input aria-label="Ask Merlin"></div>';
  }

  if (provider.id === "grok") {
    return '<div class="ProseMirror" contenteditable="true" data-model-council-input aria-label="Ask Grok"></div>';
  }

  return '<textarea data-model-council-input placeholder="Ask Perplexity"></textarea>';
}

function renderSendButton(provider) {
  if (provider.id === "chatgpt") {
    return '<button data-testid="send-button" data-model-council-submit type="submit" aria-label="Send prompt">Send</button>';
  }

  if (provider.id === "claude") {
    return '<button data-model-council-submit type="submit" aria-label="Send message">Send</button>';
  }

  if (provider.id === "gemini") {
    return '<button class="send-button" data-model-council-submit type="submit" aria-label="Send message">Send</button>';
  }

  if (provider.id === "perplexity") {
    return '<button data-model-council-submit type="submit" aria-label="Submit">Send</button>';
  }

  if (provider.id === "merlin") {
    return '<button data-testid="send-button" data-model-council-submit type="submit" aria-label="Send">Send</button>';
  }

  return '<button data-testid="send-button" data-model-council-submit type="submit" aria-label="Send">Send</button>';
}

function renderResponse(provider, text, options = {}) {
  const attrs = [
    "data-model-council-response",
    options.live ? "data-fake-live-response" : "",
    options.stale ? "data-fake-stale=\"true\"" : ""
  ].filter(Boolean).join(" ");

  if (provider.id === "chatgpt") {
    return `<article ${attrs} data-message-author-role="assistant" class="markdown">${escapeHtml(text)}</article>`;
  }

  if (provider.id === "claude") {
    return `<article ${attrs} class="font-claude-response"><div class="standard-markdown"><p class="font-claude-response-body">${escapeHtml(text)}</p></div></article>`;
  }

  if (provider.id === "gemini") {
    return `<message-content ${attrs} class="model-response-text">${escapeHtml(text)}</message-content>`;
  }

  if (provider.id === "perplexity") {
    return `<article ${attrs} data-testid="answer-0" class="prose">${escapeHtml(text)}</article>`;
  }

  if (provider.id === "merlin") {
    return `<article ${attrs} data-testid="message-answer" class="markdown">${escapeHtml(text)}</article>`;
  }

  return `<article ${attrs} data-testid="message-0" class="markdown">${escapeHtml(text)}</article>`;
}

function renderBusy(provider) {
  if (provider.id === "chatgpt") {
    return '<button data-model-council-busy="true" data-testid="stop-button" type="button">Stop generating</button>';
  }

  if (provider.id === "claude") {
    return '<button data-model-council-busy="true" aria-label="Stop response" type="button">Stop</button>';
  }

  if (provider.id === "gemini") {
    return '<div data-model-council-busy="true" class="response-container generating" aria-label="Generating"></div>';
  }

  if (provider.id === "perplexity") {
    return '<button data-model-council-busy="true" data-testid="stop-generating" aria-label="Stop generating" type="button">Stop</button>';
  }

  if (provider.id === "merlin") {
    return '<div data-model-council-busy="true" aria-busy="true" data-testid="stop-generating">Generating</div>';
  }

  return '<button data-model-council-busy="true" data-testid="stop-button" aria-label="Stop generating" type="button">Stop</button>';
}

function staleTranscript(provider) {
  return `[MODEL_COUNCIL_RUN=old-run; ROUND=1]\n${JSON.stringify({
    answer: `${provider.label} stale answer`,
    key_points: ["old transcript"],
    uncertainty: "",
    confidence: 1
  }, null, 2)}`;
}

function inputText(input) {
  if (!input) return "";
  return "value" in input ? input.value : input.textContent;
}

function clearInput(input) {
  if (!input) return;
  if ("value" in input) input.value = "";
  else input.textContent = "";
}

function escapeHtml(text = "") {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
