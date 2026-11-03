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
(`POST /api/report`), a receptionist that asks only for what the caller has
not given yet (chosen in code from Spark's fields; guarded canned lines, never
generated; 0 of 18 questions asked for something already said, against 4 of
16 for the old build, but its first real reply is slower: 3.0 s vs 1.2 s at
p50), and an instant close by code rules on hard demands (OTP, app install,
transfer now) before Spark answers. In the browser demo the call is
half-duplex: words spoken over the receptionist are lost.

**Voice output only: Gemini TTS, because Meta's API has no TTS; every
decision is a Meta model.** The receptionist speaks in one female AI voice on
every device (Gemini `gemini-3.8-flash-tts`, voice Sulafat, chosen from three
by Meta ASR error rate on a phone-band copy). Every fixed line (disclosure,
questions, closes, canned trap lines) is pre-generated once into
`app/public/audio/` (`scripts/tts-pregen.mjs`) and plays as a static file at
$0. Only a trap line Spark writes live goes to `POST /api/tts`, which speaks
nothing but a line our own server signed for that caller (HMAC over the
text's hash, the session's IP hash and a 2-minute expiry), behind the same
session / rate-limit / kill-switch guard with its own $1/day cap. If the AI
voice fails or is capped, the browser's `speechSynthesis` takes over, and a
caption always shows the line, so a device with no Thai voice still reads
every word.

**AI vs AI arena (Nov 3, [`/arena`](https://beta.krai-a.com/arena.html)).**
`scripts/arena.mjs` has Muse Wonder play adaptive callers. Each persona hears
KRAI-A's real replies before its next turn, for up to 8 turns. The KRAI-A side
is the production pipeline run in-process: T1 → Spark → policy → Wonder →
receptionist → trap. Every call id goes to train (70%) or holdout (30%) by a
hash of the id, fixed before any tuning. Fixes used train calls only; sealed
v2 was never opened.

- **Main run:** 504 games, 34 scam and 18 legit personas, $33.77 metered.
  - Scams: 251 of 319 blocked; 9 were closed as legit.
  - Legit callers: 1 of 185 wrongly hung up.
- **Fixes from the train misses (`610406b`):**
  - The receptionist no longer closes a call before the caller's purpose is
    heard.
  - A read-out account number counts as a transfer ask.
  - A bare Wonder SCAM needs evidence.
  - "ไม่มีการขอรหัส OTP" is read as a refusal, not a demand.
- **Holdout, same caller lines replayed on the fixed code:**
  - Scams blocked: 74 → 76 of 89. Scams closed as legit: 2 → 1.
  - Legit wrongly hung up: 1 → 0 of 57.
  - Train set: 64/64 scams caught, 0/37 legit flagged.
- **Not a scammer (B25):** a 187-persona catalog with one expected behaviour
  each. Families include wrong numbers, real emergencies, confused or
  regional-dialect relatives, pranks, drunks, lawful and abusive debt
  collectors, sales and surveys.
  - 167 calls played; 155 met the expected behaviour.
  - The case report now names the kind of call: emergency (red URGENT
    banner), harassment, debt harassment, nuisance or sales. The model reports
    the kind; code writes the words and can never override a SCAM verdict.
- **Known limits**, all listed on `/arena`:
  - A slow-burn "bank account upgrade" caller who asks only at turn 5 is still
    closed with an "unverified" message rather than blocked.
  - Abusive collectors who say "transfer today" can be blocked as scams: 2 of
    15 harassment calls were, and 1 more was not recorded as harassment.
  - Silence and noise calls end when the caller gives up, not by a polite
    close from KRAI-A (4 of 18 nuisance calls). One English jailbreak
    prankster was blocked as a scam.
  - A nephew asking to borrow money is blocked like a "family in trouble" scam.
  - The emergency and harassment rules can leave a plain service notice as an
    unverified message instead of LEGIT. A condo fee notice did this in 2 of 4
    train runs.
- **Gate on the shipping wording (B25):**
  - Train set: 114 of 120 calls played before the $1 cap; the 6 unplayed are
    UNSURE-class calls. Scams 64/64 caught, 0/37 legit flagged as scam, no scam
    closed as LEGIT. Exact accuracy 97.4%, safe outcome 99.1%.
  - Holdout legit replay (same caller lines): 0 of 57 wrongly hung up; 51 closed
    as legit, 6 left as a message.

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
