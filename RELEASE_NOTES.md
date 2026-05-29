# Tab Council v0.1.0-alpha

First public alpha for Tab Council, a Chrome MV3 extension that turns a Chrome tab group named `tab-council` into a structured multi-model council.

## Highlights

- Supports ChatGPT, Claude, Gemini, Perplexity, Merlin, and Grok tabs.
- Uses provider-side model selection: choose the model inside each AI tab.
- Adds explicit roles: Member, Judge, Validator, Observer, Exclude.
- Runs Round 1 independent answers, Round 2 polite critique, optional Round 3, judge synthesis, and optional Ratify/Veto.
- Parses strict structured JSON for every phase.
- Adds one JSON repair prompt for almost-valid model output.
- Stores run state and history locally in Chrome storage only.
- Exports Markdown locally from the side panel.
- Includes a canvas-only demo video with locally generated story narration.

## Install

1. Download `tab-council-v0.1.0-alpha.zip`.
2. Unzip it.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the unzipped folder containing `manifest.json`.
7. Create a Chrome tab group named `tab-council` with your logged-in AI tabs.

## Alpha Notes

Web UI automation is best-effort. If a provider changes its composer, send button, or response markup, that tab fails visibly instead of silently producing a bad transcript.
