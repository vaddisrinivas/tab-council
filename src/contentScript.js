(function installModelCouncilContentScript() {
  if (globalThis.__MODEL_COUNCIL_CONTENT_SCRIPT__) return;
  globalThis.__MODEL_COUNCIL_CONTENT_SCRIPT__ = true;

  const KNOWN_HOSTS = {
    claude: ["claude.ai"],
    chatgpt: ["chatgpt.com", "chat.openai.com"],
    perplexity: ["perplexity.ai", "www.perplexity.ai"],
    merlin: ["getmerlin.in", "www.getmerlin.in", "extension.getmerlin.in"],
    gemini: ["gemini.google.com"],
    grok: ["grok.com", "x.com", "x.ai"]
  };

  const COMMON_INPUT_SELECTORS = [
    "[data-model-council-input]",
    "#prompt-textarea",
    "textarea",
    "div[contenteditable='true']",
    "[contenteditable='true']",
    ".ProseMirror",
    "rich-textarea div[contenteditable='true']"
  ];

  const COMMON_RESPONSE_SELECTORS = [
    "[data-model-council-response]",
    "[data-message-author-role='assistant']",
    "[data-testid='message-content']",
    "[data-testid*='answer']",
    "[data-testid*='conversation-turn']",
    "message-content",
    ".model-response-text",
    ".markdown",
    ".prose",
    "article"
  ];

  const MODEL_LABEL_SELECTORS = [
    "[data-model-council-model]",
    "[data-testid*='model']",
    "[aria-label*='Model']",
    "[aria-label*='model']",
    "button",
    "[role='button']"
  ];

  const ADAPTERS = {
    chatgpt: {
      label: "ChatGPT",
      input: ["#prompt-textarea", "textarea[data-id='root']", "textarea", "div[contenteditable='true']", ".ProseMirror"],
      responses: ["[data-message-author-role='assistant']", "[data-testid*='conversation-turn']", ".markdown", ".prose"],
      send: ["button[data-testid='send-button']", "button[aria-label*='Send']", "button[aria-label*='send']"],
      busy: ["button[data-testid='stop-button']", "button[aria-label*='Stop']"]
    },
    claude: {
      label: "Claude",
      input: ["div[contenteditable='true']", ".ProseMirror", "textarea"],
      responses: [
        "[data-testid='message-content']",
        ".font-claude-response",
        ".font-claude-response-body",
        ".font-claude-message",
        ".standard-markdown",
        ".prose",
        ".markdown"
      ],
      send: ["button[aria-label*='Send']", "button[data-testid*='send']"],
      busy: ["button[aria-label*='Stop']", "[data-testid*='stop']"]
    },
    gemini: {
      label: "Gemini",
      input: ["rich-textarea div[contenteditable='true']", "div[contenteditable='true']", "textarea"],
      responses: ["message-content", ".model-response-text", ".markdown", ".prose"],
      send: ["button[aria-label*='Send']", "button[aria-label*='Submit']", "button.send-button"],
      busy: ["button[aria-label*='Stop']", ".response-container.generating"]
    },
    perplexity: {
      label: "Perplexity",
      input: ["textarea", "div[contenteditable='true']", ".ProseMirror"],
      responses: ["[data-testid*='answer']", ".prose", ".markdown", "article"],
      send: ["button[aria-label*='Submit']", "button[aria-label*='Send']", "button[data-testid*='submit']"],
      busy: ["button[aria-label*='Stop']", "[data-testid*='stop']"]
    },
    merlin: {
      label: "Merlin",
      input: [
        "textarea",
        "div[contenteditable='true']",
        ".ProseMirror",
        "[role='textbox']",
        "input[placeholder*='Ask']"
      ],
      responses: [
        "[data-testid*='message']",
        "[data-testid*='answer']",
        ".markdown",
        ".prose",
        "article"
      ],
      send: [
        "button[aria-label*='Send']",
        "button[aria-label*='Submit']",
        "button[type='submit']",
        "button[data-testid*='send']"
      ],
      busy: ["button[aria-label*='Stop']", "[data-testid*='stop']", "[aria-busy='true']"]
    },
    grok: {
      label: "Grok",
      input: ["textarea", "div[contenteditable='true']", ".ProseMirror"],
      responses: ["[data-testid*='message']", ".markdown", ".prose", "article"],
      send: ["button[aria-label*='Send']", "button[data-testid*='send']"],
      busy: ["button[aria-label*='Stop']", "[data-testid*='stop']"]
    },
    generic: {
      label: "Generic AI Tab",
      input: COMMON_INPUT_SELECTORS,
      responses: COMMON_RESPONSE_SELECTORS,
      send: ["[data-model-council-submit]", "button[type='submit']", "button[aria-label*='Send']", "button[aria-label*='Submit']"],
      busy: ["[data-model-council-busy='true']", "[aria-busy='true']"]
    }
  };

  const state = {
    lastPrompt: "",
    baselineCount: 0,
    submittedAt: 0,
    activeRunId: "",
    abortedRunIds: new Set()
  };

  const PROBE_COMPOSER_TIMEOUT_MS = 8000;
  const PROMPT_COMPOSER_TIMEOUT_MS = 10000;
  const COMPOSER_POLL_INTERVAL_MS = 250;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function providerIdFromLocation() {
    const host = location.hostname.toLowerCase();
    for (const [id, hosts] of Object.entries(KNOWN_HOSTS)) {
      if (hosts.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`))) return id;
    }
    return "generic";
  }

  function adapter() {
    return ADAPTERS[providerIdFromLocation()] ?? ADAPTERS.generic;
  }

  function normalizeModelLabel(value = "") {
    return value
      .replace(/\s+/g, " ")
      .replace(/\b(model|selected|current|switch|choose|dropdown)\b:?/gi, "")
      .trim()
      .slice(0, 80);
  }

  function looksLikeModelLabel(value = "", providerId = providerIdFromLocation()) {
    const text = normalizeModelLabel(value);
    if (text.length < 2 || text.length > 80) return false;

    const common = /\b(gpt|o[134]|claude|sonnet|opus|haiku|gemini|flash|pro|perplexity|sonar|grok|merlin|deepseek|llama|qwen|mistral)\b/i;
    if (common.test(text)) return true;

    const providerTerms = {
      chatgpt: /\b(gpt|o[134]|chatgpt)\b/i,
      claude: /\b(claude|sonnet|opus|haiku)\b/i,
      gemini: /\b(gemini|flash|pro)\b/i,
      perplexity: /\b(perplexity|sonar|pro)\b/i,
      grok: /\b(grok)\b/i,
      merlin: /\b(merlin|gpt|claude|gemini|llama|mistral)\b/i
    };
    return Boolean(providerTerms[providerId]?.test(text));
  }

  function modelTextFromElement(element) {
    return [
      element.getAttribute("data-model-council-model"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      elementText(element)
    ]
      .filter(Boolean)
      .join(" ");
  }

  function detectModelLabel() {
    const providerId = providerIdFromLocation();
    for (const selector of MODEL_LABEL_SELECTORS) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          if (!visible(element)) continue;
          const label = normalizeModelLabel(modelTextFromElement(element));
          if (looksLikeModelLabel(label, providerId)) return label;
        }
      } catch {
        // Ignore selector failures.
      }
    }

    const titleLabel = normalizeModelLabel(document.title);
    return looksLikeModelLabel(titleLabel, providerId) ? titleLabel : "";
  }

  function pageBlockReason(providerId = providerIdFromLocation()) {
    const bodyText = elementText(document.body).toLowerCase();
    if (providerId === "grok" && bodyText.includes("please confirm your age")) {
      return "Grok age confirmation is blocking the composer. Confirm age in the tab, then rerun.";
    }
    return "";
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      try {
        const match = [...document.querySelectorAll(selector)].find(visible);
        if (match) return match;
      } catch {
        // Ignore brittle third-party selector failures.
      }
    }
    return null;
  }

  function elementText(element) {
    return (element?.innerText || element?.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function responseNodes(currentAdapter = adapter()) {
    const nodes = [];
    for (const selector of currentAdapter.responses) {
      try {
        for (const element of document.querySelectorAll(selector)) {
          const text = elementText(element);
          if (visible(element) && text.length > 20) nodes.push({ element, text });
        }
      } catch {
        // Ignore selector failures.
      }
    }

    const seen = new Set();
    return nodes.filter((node) => {
      const key = node.text.slice(0, 500);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function findComposer() {
    return queryFirst(adapter().input) ?? queryFirst(COMMON_INPUT_SELECTORS);
  }

  async function waitForComposer(timeoutMs) {
    const startedAt = Date.now();
    let input = findComposer();
    while (!input && Date.now() - startedAt < timeoutMs) {
      await sleep(COMPOSER_POLL_INTERVAL_MS);
      input = findComposer();
    }
    return input;
  }

  function findSendButton() {
    const adapterButton = queryFirst(adapter().send ?? []);
    if (adapterButton) return adapterButton;

    const buttons = [...document.querySelectorAll("button, [role='button']")].filter((button) => {
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
      return visible(button) && !disabled;
    });

    const preferred = ["send", "submit", "ask", "arrow", "up"];
    return (
      buttons.find((button) => {
        const label = [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.getAttribute("data-testid"),
          button.textContent
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return preferred.some((word) => label.includes(word));
      }) ?? null
    );
  }

  function dispatchInput(element) {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: element.value ?? elementText(element) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  async function fillPrompt(text) {
    const input = findComposer() ?? await waitForComposer(PROMPT_COMPOSER_TIMEOUT_MS);
    if (!input) throw new Error("Composer not found.");

    input.focus();

    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      setNativeValue(input, text);
      dispatchInput(input);
      await sleep(150);
      return;
    }

    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("delete");
      document.execCommand("insertText", false, text);
      dispatchInput(input);

      if (!elementText(input).includes(text.slice(0, 80))) {
        input.textContent = text;
        dispatchInput(input);
      }

      await sleep(150);
      return;
    }

    throw new Error("Unsupported composer type.");
  }

  async function submitPrompt() {
    await sleep(300);
    const button = findSendButton();
    if (button) {
      button.click();
      return;
    }

    const input = findComposer();
    if (!input) throw new Error("Composer not found for submit.");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  function busy() {
    const busySelectors = [
      ...(adapter().busy ?? []),
      "[aria-busy='true']",
      "[data-testid='stop-button']",
      "button[aria-label*='Stop']",
      "button[title*='Stop']",
      ".result-streaming"
    ];

    return Boolean(queryFirst(busySelectors));
  }

  function latestAnswer() {
    const runMarker = state.lastPrompt.match(/\[MODEL_COUNCIL_RUN=[^\]]+\]/)?.[0] ?? "";
    const nodes = responseNodes().filter((node) => {
      if (!runMarker) return true;
      return !(node.text.includes(runMarker) && node.text.length < state.lastPrompt.length + 300);
    });
    if (!nodes.length) return "";

    const afterBaseline = nodes.slice(state.baselineCount);
    if (!afterBaseline.length) return "";

    const candidate = afterBaseline[afterBaseline.length - 1];
    return candidate.text;
  }

  function stopGeneration() {
    const stopButton = queryFirst([
      ...(adapter().busy ?? []),
      "[data-testid='stop-button']",
      "button[aria-label*='Stop']",
      "button[title*='Stop']"
    ]);
    if (stopButton instanceof HTMLElement) stopButton.click();
  }

  async function waitForStableAnswer(timeoutMs) {
    const startedAt = Date.now();
    let lastText = "";
    let stableSince = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (state.abortedRunIds.has(state.activeRunId)) throw new Error("Run aborted.");
      const text = latestAnswer();
      if (text && text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      }

      if (lastText.length > 20 && !busy() && Date.now() - stableSince > 3500) {
        return lastText;
      }

      await sleep(1000);
    }

    if (lastText.length > 20) return lastText;
    throw new Error("Timed out waiting for answer.");
  }

  async function probe() {
    const currentAdapter = adapter();
    const blockedReason = pageBlockReason();
    if (blockedReason) {
      return {
        providerId: providerIdFromLocation(),
        providerLabel: currentAdapter.label,
        ready: false,
        reason: blockedReason
      };
    }

    const input = findComposer() ?? await waitForComposer(PROBE_COMPOSER_TIMEOUT_MS);
    return {
      providerId: providerIdFromLocation(),
      providerLabel: currentAdapter.label,
      modelLabel: detectModelLabel(),
      ready: Boolean(input),
      reason: input ? "" : "Composer not found."
    };
  }

  async function runPrompt({ prompt, timeoutMs, runId }) {
    const currentAdapter = adapter();
    const blockedReason = pageBlockReason();
    if (blockedReason) throw new Error(blockedReason);

    state.activeRunId = runId || "";
    state.lastPrompt = prompt;
    state.baselineCount = responseNodes(currentAdapter).length;
    state.submittedAt = Date.now();

    await fillPrompt(prompt);
    await submitPrompt();
    const text = await waitForStableAnswer(timeoutMs);

    return {
      providerId: providerIdFromLocation(),
      providerLabel: currentAdapter.label,
      modelLabel: detectModelLabel(),
      text,
      url: location.href,
      submittedAt: state.submittedAt,
      extractedAt: Date.now()
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || typeof message.type !== "string" || !message.type.startsWith("MC_")) return false;

    (async () => {
      if (message.type === "MC_PROBE") {
        sendResponse({ ok: true, ...(await probe()) });
        return;
      }

      if (message.type === "MC_RUN_PROMPT") {
        const result = await runPrompt(message.payload);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message.type === "MC_ABORT") {
        if (message.payload?.runId) state.abortedRunIds.add(message.payload.runId);
        stopGeneration();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "MC_EXTRACT") {
        sendResponse({ ok: true, text: latestAnswer() });
        return;
      }

      sendResponse({ ok: false, error: `Unknown content message: ${message.type}` });
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

    return true;
  });
})();
