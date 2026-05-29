# Privacy

Tab Council is local-first: no extension-owned backend service, no analytics, and no tracking pixels.

## What Is Sent to Model Providers

- The extension automates tabs you already opened and authenticated.
- Content is sent by filling prompts into those provider pages, so each provider receives what appears in its own tab.
- Cross-provider sharing is part of the council process:
  - Round 1: each tab gets your original prompt only.
  - Round 2 critique/update: each tab receives other tabs' successful Round 1 outputs.
  - Disagreement check: the judge tab receives successful Round 2 outputs.
  - Optional Round 3: each tab receives other tabs' successful Round 2 outputs.
  - Synthesis: judge tab(s) receive successful Round 1, Round 2, and optional Round 3 outputs.
  - Optional Ratify/Veto: validator tabs or non-judge tabs receive the synthesized verdict and original prompt.
- In short: your prompt and successful round outputs are intentionally shared into other provider tabs during critique, disagreement-check, and synthesis phases.
- Observer and excluded tabs are not automated.

## Local Storage and Retention

- Data is stored in `chrome.storage.local` under these keys:
  - `activeCouncil`
  - `currentRun`
  - `runHistory`
  - `userSettings`
- Local data remains until you:
  - click **Clear Local** in the side panel,
  - remove the extension, or
  - remove/reset the browser profile data.
- Export files are user-created downloads. Those files are stored by your browser/OS download location, not inside extension storage.

## Permissions

- Required extension permissions:
  - `sidePanel`
  - `scripting`
  - `storage`
  - `tabGroups`
  - `tabs`
- Optional host permissions are requested at runtime for known provider origins represented by tabs currently in the active `tab-council` group. Fresh-thread aliases are included before navigation.
- Known provider host patterns include ChatGPT, Claude, Gemini, Perplexity, Merlin, and Grok origins.
- Store-safe builds do not include broad `https://*/*` or `http://*/*` optional host patterns. Local dev fixtures use `localhost` and `127.0.0.1`.

## Exports

- Export output is generated locally.
- With **Raw export** on, export includes structured JSON and raw transcript blocks.
- With **Raw export** off, export omits the original prompt body, raw transcript blocks, raw disagreement output, and parse-failed raw text.

## What This Extension Does Not Do

- No remote server receives run data from this extension itself.
- No hidden telemetry or external logging is included.
