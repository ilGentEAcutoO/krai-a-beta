# Krai-A beta — Thai anti-scam call agent on Meta models

Solo Indie-track build for the **Meta Global AI Developer Hackathon 2026**
(Build for Your World): an AI receptionist that answers suspected scam calls
for elderly Thai parents, judges every caller turn live, and alerts the family
before money moves — rebuilt from scratch on **Muse Spark + Muse Wonder +
Muse Voice Transcribe**.

> **New work vs. carried over (new-work-only rule).** Everything that runs on
> Meta models — the Worker, voice relay, Spark/Wonder judges, policy, trap
> mode, spend guard, eval harness, `/demo-live`, `/proof` — was written during
> the event (first commit Oct 27, 2026). Two things were carried over **only to
> serve as the baseline to beat**, and are marked as such:
> `app/src/baseline/` (the frozen Google-Cloud alpha judge, verbatim) and 57 of
> the 120 train calls in `corpus/thai-tactics.jsonl` (`"source": "v2-port"`).
> The 35 sealed eval calls and the other 63 train calls are new.

## For judges

- **Try it in 60 seconds:** [docs/judge-guide.md](docs/judge-guide.md) —
  open https://beta.krai-a.com/demo-live and play the scammer.
- **Submission write-up** (models used where and why, what is new vs the
  baseline, safety design, results): [docs/SUBMISSION.md](docs/SUBMISSION.md)
- **Architecture:** [docs/architecture.svg](docs/architecture.svg)
- **Measured numbers, baseline beside Meta:** https://beta.krai-a.com/proof
- **Video storyboard:** [docs/video-storyboard.md](docs/video-storyboard.md)

## Status (2026-11-01)

Live on `beta.krai-a.com`: realtime Thai voice (browser → VoiceCall DO → Meta
Voice), Spark verdicts with the 3-tier code policy, Wonder escalation for grey
cases, 10-minute trap mode, a no-mic text/replay mode on `/demo-live`, the
Jev-baseline `/showdown`, and `/proof`. All model routes sit behind a session
token, per-IP rate limits, a daily USD cap and a kill switch.

Verified against live Meta models on 2026-11-01: realtime Thai transcription
(final ~1.8 s after speech ends), a fake-police call judged SCAM 0.98 and a
hospital call LEGIT 0.95. The measured Spark/Wonder eval on `/proof` is
pending: the kill switch stays on until the event's API credits land, so
model routes currently answer with an honest "paused" message.

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
