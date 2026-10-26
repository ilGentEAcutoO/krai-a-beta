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

Day 1–2: Worker + static assets + CI green on `beta.krai-a.com`.
Live now: realtime voice relay (browser → VoiceCall DO → Meta, `/demo-live.html`),
`POST /api/verdict/turn` (Spark few-shot → 3-tier policy), Jev-baseline showdown
(`/showdown.html`). Wonder, trap mode, sealed eval, and `/proof` land in B7–B10.
Meta billing is not enabled yet, so live-model paths return honest fallbacks
until the $150 credits arrive (B2).

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
  src/voice.js        Meta Voice protocol: handshake, events, TurnAssembler, relay
  src/voice-do.js     VoiceCall Durable Object (Hibernation relay shell)
  src/spark.js        Spark few-shot verdict client (cached, never throws)
  src/policy.js       3-tier policy: the ONLY place verdicts become action
  public/             static demo pages (served by Cloudflare Static Assets)
  test/               node:test suites (npm test)
  wrangler.jsonc      Worker config (SORNKan account, beta.krai-a.com)
  .dev.vars.example   local secret template (copy to .dev.vars, gitignored)
docs/
  demo-live.md        realtime voice demo: wire-up, rules, failure modes
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
