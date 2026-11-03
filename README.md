# Krai-A beta — Thai anti-scam call agent on Meta models

Solo Indie-track build for the **Meta Global AI Developer Hackathon 2026**
(Build for Your World): an automated receptionist that answers suspected scam
calls for elderly Thai parents, says up front that it is automated, judges
every caller turn live, plays for time on scam calls, and ends with a case
report the family can share. Built on **Muse Voice Transcribe + Muse Spark +
Muse Wonder**.

## What's new in this hackathon

The same brand, KRAI-A, has an older build that was entered in the **Google
Cloud AI Builder Cup** (Oct 7–18, 2026). That build is **not part of this
entry**. This repo was started after the Meta kickoff; its first commit is
`323e625` (Oct 27, 02:04 Thai time). Day-by-day evidence is in
[`BUILD-LOG.md`](BUILD-LOG.md).

| | Old build (Google Cloud AI Builder Cup, Oct 7–18) — not part of this entry | This entry (built Oct 27 – Nov 4) | Carried over, used only as … |
|---|---|---|---|
| Speech | Gemini Live | Muse Voice Transcribe, realtime socket through a Durable Object (`app/src/voice*.js`) | — |
| Scam judge | Jev + Gemini escalation | Muse Spark 1.2 on every turn, Muse Wonder for the grey zone, code policy (`spark.js`, `wonder.js`, `policy.js`) | the old judge, copied verbatim into `app/src/baseline/`, **used only as the ruler** by `scripts/eval.mjs`. No live code imports it. |
| Phone line + LINE alert to the family | yes (call forwarding + LINE delivery) | **not in this entry.** This entry is a web demo; at call end the family gets a case report they can copy or share. Nothing is sent automatically. | — |
| Disclosure opener | — | every call opens with "an automated assistant is answering for the owner, this call is recorded" | — |
| Trap mode (10 min) | — | new (`trap.js`, `routes-wonder.js`) | — |
| Case report at call end | — | new (`report.js`, `public/report-card.js`) | — |
| Spend guard (session, rate limits, daily cap, kill switch) | — | new (`abuse.js`, `budget.js`) | — |
| Eval: 35 sealed calls + /proof | — | new (`corpus/sealed.jsonl`, `/proof`) | — |
| Train corpus (120 calls) | 57 of these calls | 63 new train calls + all 35 sealed calls | the 57 ported calls (`"source": "v2-port"`) are **train data only** (few-shot and train eval), never sealed |

"—" means nothing was carried over for that row; this entry's version is new
code. The baseline run in `app/public/proof/runs/train-jev-2026-10-26T19-45-31/`
is the old judge measured on the train set (Oct 26, 19:45 UTC = Oct 27, 02:45
Thai time): a ruler to beat, not work entered here.

## For judges

- **Try it in 60 seconds:** [docs/judge-guide.md](docs/judge-guide.md) —
  open https://beta.krai-a.com/demo-live and play the scammer.
- **Submission write-up** (models used where and why, what is new vs the
  baseline, safety design, results): [docs/SUBMISSION.md](docs/SUBMISSION.md)
- **Architecture:** [docs/architecture.svg](docs/architecture.svg)
- **Measured numbers, baseline beside Meta:** https://beta.krai-a.com/proof
- **Video storyboard:** [docs/video-storyboard.md](docs/video-storyboard.md)

## Status (2026-11-03)

Live on `beta.krai-a.com`: realtime Thai voice (browser → VoiceCall DO → Meta
Voice), Spark verdicts with the 3-tier code policy, Wonder escalation for grey
cases, 10-minute trap mode, a no-mic text/replay mode on `/demo-live`, the
Jev-baseline `/showdown`, and `/proof`. All model routes sit behind a session
token, per-IP rate limits, a daily USD cap and a kill switch.

Added on Nov 3 (see [`BUILD-LOG.md`](BUILD-LOG.md)): the disclosure opener,
the "never claim to be a person" trap guard, the case report at call end
(`POST /api/report`), and a receptionist that answers every caller turn with a
canned, code-chosen line about 1 s after the caller stops (no dead air, no
model call). Its voice is the browser's text-to-speech (`speechSynthesis`,
th-TH), not a Meta model: the Meta Model API has no text-to-speech. In the
browser demo the call is half-duplex: words spoken over the receptionist are
lost.

Verified against live Meta models on 2026-11-01: realtime Thai transcription
(final ~1.8 s after speech ends), a fake-police call judged SCAM 0.98 and a
hospital call LEGIT 0.95. On 2026-11-03 the case report ran against live Muse
Spark on two test calls (fake police → SCAM 0.95 with the mule account and
LINE id quoted; hospital → LEGIT 0.90), about 10 s each. Measured Spark and
Wonder numbers go on `/proof` as each eval run lands.

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
  src/trap.js         disclosure line, trap mode (plays for time), intel extraction
  src/report.js       case report at call end (POST /api/report)
  src/baseline/       old Google-Cloud judge, frozen: eval ruler only, never imported by live code
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
