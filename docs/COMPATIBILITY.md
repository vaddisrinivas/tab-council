# Provider Compatibility

Last local no-token fixture check: 2026-05-29.

| Provider | Hosts | Fresh thread | Fixture coverage | Live status |
| --- | --- | --- | --- | --- |
| ChatGPT | `chatgpt.com`, `chat.openai.com` | `https://chatgpt.com/` | yes | needs live smoke |
| Claude | `claude.ai` | `https://claude.ai/new` | yes | needs live smoke |
| Gemini | `gemini.google.com` | `https://gemini.google.com/app` | yes | needs live smoke |
| Perplexity | `perplexity.ai`, `www.perplexity.ai` | `https://www.perplexity.ai/` | yes | needs live smoke |
| Merlin | `getmerlin.in`, `www.getmerlin.in`, `extension.getmerlin.in` | `https://extension.getmerlin.in/chat` | yes | needs live smoke |
| Grok | `grok.com`, `x.com`, `*.x.ai` | `https://grok.com/` | yes | needs live smoke |

## Live Smoke Criteria

- Composer probe succeeds.
- Round 1 returns valid structured JSON.
- Round 2 excludes the model's own Round 1 answer.
- Disagreement check returns valid JSON.
- Synthesis returns final answer plus verdict table.
- Failed tabs show a visible reason.
