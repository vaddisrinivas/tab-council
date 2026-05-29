# Contributing

Thanks for improving Tab Council.

## Setup

```bash
npm install
npm run check
```

Load the repo folder as an unpacked extension from `chrome://extensions`.

## Contribution Rules

- Keep provider automation best-effort and visibly failing.
- Do not add broad host permissions to the default manifest.
- Add or update no-token fixtures for every provider selector change.
- Keep privacy docs aligned with prompt/transcript flow.
- Do not commit secrets, cookies, browser profiles, exported transcripts, or local run data.

## Testing

Run:

```bash
npm run check
npm run fake-ai
```

For provider changes, update `test/fixtures/fake-provider-cases.mjs` and `test/fake-provider-fixtures.test.mjs`.
