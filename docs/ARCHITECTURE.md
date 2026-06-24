# Architecture

Tab Council is a Chrome MV3 extension.

## Pieces

- `manifest.json`: permissions, side panel, service worker, host allowlist.
- `src/background.js`: tab-group discovery, run state machine, permissions assumptions, prompt orchestration, storage.
- `src/contentScript.js`: provider page automation adapter.
- `src/sidepanel.*`: operator UI, permission request, run controls, transcript/export display.
- `src/prompts.js`: council prompt builders and Markdown export.
- `src/shared.js`: provider registry, settings, structured parsing, helper contracts.
- External API: companion extensions can read/refresh active council state through `TC_GET_STATE` and `TC_PREPARE_COUNCIL`.

## Run Flow

1. User creates a tab group named `tab-council`.
2. Side panel scans grouped tabs and requests needed host permissions.
3. Background creates one locked run.
4. Known providers optionally navigate to fresh-thread URLs.
5. Content scripts probe each provider page.
6. Ready tabs run Round 1, Round 2, disagreement check, optional Round 3, and synthesis.
7. Structured JSON is parsed and stored in `chrome.storage.local`.
8. Side panel renders final verdict, rounds, run log, and local Markdown export.

## Adapter Contract

Content adapters expose:

- provider detection by host,
- composer selection,
- send button selection,
- response extraction,
- busy/stop detection,
- abort stop-click best effort.

Adapters must fail loudly when composer or response extraction breaks.

## Privacy Boundary

The extension has no backend. It still sends data to third-party AI providers by automating their pages. Round 2 and later intentionally share successful model outputs across selected provider tabs.
