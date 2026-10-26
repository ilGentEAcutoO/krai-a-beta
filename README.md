# Krai-A beta — Thai anti-scam call agent on Meta models

Solo Indie-track build for the **Meta Global AI Developer Hackathon 2026**
(Build for Your World): an AI receptionist that answers suspected scam calls
for elderly Thai parents, judges every caller turn live, and alerts the family
before money moves — rebuilt from scratch on **Muse Spark + Muse Wonder +
Muse Voice Transcribe**.

> New-work-only: every line in this repo was written during the event
> (Oct 27 – Nov 4, 2026). The Google-Cloud version (alpha) lives elsewhere
> and is used solely as the baseline to beat in a sealed live evaluation.

## Status

Day 1 scaffold: Worker + static assets + CI green on `beta.krai-a.com`.
Voice, Spark verdict path, Wonder, trap mode, sealed eval, and `/proof`
land in B4–B10.

## Quickstart

```bash
cd app
cp .dev.vars.example .dev.vars   # fill META_MODEL_API_KEY (gitignored)
npm install
npm run dev                      # http://localhost:8787
```

## Deploy

```bash
cd app
npx wrangler secret put META_MODEL_API_KEY   # production key, never in repo
npm run deploy
```

Live: https://beta.krai-a.com · Health: https://beta.krai-a.com/api/health

## Layout

```text
app/
  src/index.js        Worker entry (Hono, /api/* only; / serves static)
  public/             static demo pages (served by Cloudflare Static Assets)
  test/               node:test suites (npm test)
  wrangler.jsonc      Worker config (SORNKan account, beta.krai-a.com)
  .dev.vars.example   local secret template (copy to .dev.vars, gitignored)
scripts/
  check-public.js     CI gate: no secrets tracked, env files gitignored
```

## Rules we build by

- Meta Model API key stays server-side; the browser never sees it.
- Final verdict lives in code, not in the prompt.
- Every number on `/proof` is measured, with the baseline beside it.

## Links

- Event: https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Meta Model API docs: https://dev.meta.ai/docs/overview

## License

MIT — see [LICENSE](LICENSE).
