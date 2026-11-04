# KRAI-A beta: an AI receptionist that screens scam calls

**Live:** https://beta.krai-a.com · **Try a call:** https://beta.krai-a.com/demo-live ·
**Measured results:** https://beta.krai-a.com/proof · License: MIT

> KRAI-A is an independent project. Not affiliated with or endorsed by Meta.
> Meta and Muse are trademarks of their respective owners.

Solo Indie-track entry, built for the Meta Global AI Developer Hackathon
(Nov 2026).
KRAI-A answers unknown calls for the people you love. It says up front that
it is automated, listens and answers in the caller's language (Thai, English
or Mandarin), judges every caller sentence as it is spoken, hangs up
on scammers (or stalls them for up to 10 minutes), takes a message
otherwise, and ends with a case report the family can copy or share.

**The problem.** Thais reported about ฿11,039 million lost to online fraud in
eight months of 2026 (221,626 reports, Jan 1 – Aug 31); people aged 60+ filed
8.07% of the reports but lost 28.55% of the money
([Thairath, Sep 2, 2026](https://www.thairath.co.th/news/crime/2956974)).
GASA puts yearly losses including unreported cases at ฿115.3 billion
([State of Scams in Thailand 2025](https://gasa.org/knowledge-base/reports/state-of-scams-in-thailand-report-2025)).
These are online-fraud figures in general, not call scams alone. Call gangs
use a fresh number each time, so blocklists miss them; the script is what
gives them away.

## Results at a glance

| | Result | Where it is from |
|---|---|---|
| All sealed sets | **0/116 real callers judged scam** (v1 0/10, v2 0/26, intl 0/62, v4 0/18) | each set run once, on the build of the day; [`/proof`](https://beta.krai-a.com/proof) opens on the side-by-side table |
| Sealed v4, adversarial stress set, shipped build B30 (`13fcaae`) | **31/59 scams blocked; 24 more held as a message; 4 slipped through as LEGIT**; 0/18 real callers judged scam. Malay 0/4 and Tagalog 0/6 blocked | 100 of 236 calls (hash subset pre-registered at `7675e71`), one run; written by Claude, a different model family from the judge. Much harder than the other sets |
| Sealed-intl, build B29 (`c786af2`) | **57/59 scams caught, 0/62 real callers judged scam**; 24/62 real callers left as a message (UNSURE); no scam cleared | 121 held-out calls in 9 languages (44 English, 42 Mandarin, 5 each vi/id/ms/tl/ja/ko/hi), hash pre-registered at `7886737`, one run, [`/proof`](https://beta.krai-a.com/proof) |
| Sealed v2, build B28 (`8d58388`) | **60/60 exact: 34/34 scams caught, 0/26 real callers judged scam** | 60 held-out calls (51 Thai, 9 English), hash pre-registered at `a1629c8`, one run. Later builds were not re-run on it |
| Train set, B29 | 77/77 scams caught, 0/43 real callers judged scam, 143/146 exact | 146 calls, not held out |
| Judge time per caller sentence (B29, sealed-intl) | 2.5 s p50 · 9.6 s p95 (Spark alone 2.5 s / 4.8 s) | same run |
| Judge cost (B29, sealed-intl) | $0.0081 per call ($8.14 per 1,000 calls) | same run, metered tokens |
| AI vs AI arena | 1 of 185 real callers wrongly hung up in 504 games; holdout after fixes 0/57 | [`/arena`](https://beta.krai-a.com/arena.html) |
| Other languages (arena, text) | English 154/164 and Mandarin 143/150 callers handled as expected; 7 more languages probed with 15 calls each | [`/arena`](https://beta.krai-a.com/arena.html) |
| Real audio (10 calls, TTS voices, Nov 3 build `75c2ede`) | scams flagged 6/6 vs 1/6 for the old build, 0 wrong hang-ups | [`/proof`](https://beta.krai-a.com/proof) |

Small n: 31/59 has a 95% CI (Wilson) of 40–64.7%, 57/59 of 88.5–99.1%, and 34/34 of 89.8–100%. Each set measures the build that was shipping that day; B30 was not re-run on the older sets.
After the sealed runs, the receptionist's wording changed and the T1 code
rules stopped treating call-routing phrases ("put me through", "connect me")
as transfer demands. The Spark and Wonder prompts and the verdict policy are
unchanged; the sealed sets were not re-run (see [`BUILD-LOG.md`](BUILD-LOG.md)).

## Which Meta model does what

| Model | Job | Measured |
|---|---|---|
| **Muse Voice Transcribe 1.0** | the ear: realtime transcription over a Durable Object that keeps the key on the server | final text ~1.8 s after speech ends · $0.18/hour |
| **Muse Spark 1.2** (effort minimal) | judges every caller sentence: verdict, tactic, 9 risk signals in a strict JSON schema | 2.5 s p50 per sentence · $0.0081 per call |
| **Muse Spark 1.3** | writes trap-mode stalling lines and the case report at call end | report ~10 s |
| **Muse Wonder 1.0** | second opinion on grey-zone calls only; plays the adaptive callers in the arena | 16 of 267 sentences (6%) on sealed-intl · 13.3 s p50 |
| code (`policy.js`) | the only place a verdict becomes an action | hard demands (OTP, app install, transfer now) close the call at once |
| Gemini TTS (not Meta) | speaks lines our server wrote; decides nothing. the Meta Model API has no text-to-speech | fixed lines pre-recorded at $0; live lines capped at $1/day |

## Honest limits

- 4 scams slipped through on the adversarial stress set: on 100
  Claude-written adversarial, noisy and dialect calls, the shipped B30 blocked
  31/59 scams, held 24 more as a message, and put 4 through as real callers.
  Malay (0/4) and Tagalog (0/6) are the weakest languages there.
- A web demo, not a phone line: you play the caller in the browser. The demo
  does not send the case report anywhere; chat delivery for forks is
  contract-tested, not live-verified.
- Slower than the old build: 2.5 s per sentence vs about 0.27 s, and the
  first real reply takes 3.0 s vs 1.2 s.
- Test sets are small and mostly Thai; English and Mandarin are measured in
  the text-only arena. Japanese, Korean and Hindi callers get English.
- A real nephew asking to borrow money is blocked like a "family in trouble"
  scam. More limits on [`/proof`](https://beta.krai-a.com/proof) and
  [`/arena`](https://beta.krai-a.com/arena.html).

## Fork it: plug in your family's chat

When a call ends, the case report can be sent to Telegram, LINE (Messaging
API) or WhatsApp (Cloud API).

- **Opt-in and safe by default:** off unless `NOTIFY_ENABLED=1` plus that
  channel's secrets. 5 s timeout, at most one retry, one message per call,
  caller links defanged, an "AI assistant" disclosure on every message.
- **Setup takes about 5 minutes per channel:** [`docs/ADAPTERS.md`](docs/ADAPTERS.md),
  then `npm run notify:test -- --channel telegram` sends a sample to your own
  chat.
- **Status:** contract-tested against the documented APIs, not live-verified
  with real tokens. The public demo has delivery off. WhatsApp outside the
  24 h window needs an approved template; LINE delivers only to users who
  added the Official Account.

## AI disclosure and privacy

Every call opens with "an automated assistant is answering for the owner;
this call is recorded". A code guard replaces any generated line that claims
to be a person. Audio is streamed to the Meta Model API for transcription
and processed under Meta's API terms; we don't store audio. A call's text is
kept server-side only during the call and deleted when the caller hangs up (at
most 15 minutes later), with no outside read path.
No accounts, no phone numbers; IPs are kept only as salted hashes for rate
limits. The Meta key never reaches the browser.

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
| Phone line + LINE alert to the family | yes (call forwarding + LINE delivery) | **not in this entry's demo.** This entry is a web demo; at call end the family gets a case report they can copy or share. Forks can opt in to Telegram, LINE or WhatsApp delivery (new, `app/src/notify/`, contract-tested, not live-verified); the public demo has it off. | — |
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
- **Day-by-day build log:** [BUILD-LOG.md](BUILD-LOG.md)

## Build notes (detail, by milestone)

Live on `beta.krai-a.com`: realtime Thai voice (browser → VoiceCall DO → Meta
Voice), Spark verdicts with the 3-tier code policy, Wonder escalation for grey
cases, 10-minute trap mode, a no-mic text/replay mode on `/demo-live`, the
Jev-baseline `/showdown`, and `/proof`. All model routes sit behind a session
token, per-IP rate limits, a daily USD cap with an hourly ceiling (a sixth of
the daily cap) and a kill switch.

Added on Nov 3 (see [`BUILD-LOG.md`](BUILD-LOG.md)): the disclosure opener,
the "never claim to be a person" trap guard, the case report at call end
(`POST /api/report`), a receptionist that asks only for what the caller has
not given yet (chosen in code from Spark's fields; guarded canned lines, never
generated; 0 of 18 questions asked for something already said, against 4 of
16 for the old build, but its first real reply is slower: 3.0 s vs 1.2 s at
p50), and an instant close by code rules on hard demands (OTP, app install,
transfer now) before Spark answers. In the browser demo the call is
half-duplex: words spoken over the receptionist are lost.

**Voice output only: Gemini TTS, because Meta's Model API has no TTS; every
decision is made by the Muse models and code.** The receptionist speaks in one female AI voice on
every device (Gemini `gemini-3.8-flash-tts`, voice Sulafat, chosen from three
by Muse Voice Transcribe error rate on a phone-band copy). Every fixed line (disclosure,
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

**Regional readiness (B27, Nov 3, measured in the arena only).** KRAI-A now
answers in the caller's language. Thai, English and Mandarin are supported in
full. Any other language gets English with a one-line note ("Sorry, I can
only speak English, Thai or Chinese.").

- **How the language is picked:** code reads the script of the caller's own
  words, with no model. Thai script always wins, so a Thai caller saying
  English brand names, LINE ids or numbers stays Thai. English needs a few
  words before it is chosen. Once chosen, the language stays for the whole
  call. The disclosure is repeated in that language.
- **What switches language:** questions, closes, trap filler and stalling
  lines are the same closed set of guarded lines in each language, and the
  trap prompt follows the caller. Mandarin patterns were added to the reply
  guards.
- **What stays Thai:** the owner's case report, with the caller's original
  quotes.

Callers came from a 110-persona catalog (`scripts/arena-personas/intl.mjs`):
English from SG, MY, PH, IN, HK and AU; Mandarin from CN, TW, SG and MY.
About 2/3 are not scams: everyday callers, emergencies, pushy and rude
callers, drunks and pranksters, harassment, lawful, abusive and fake debt
collectors, sales and real-prize look-alikes. The scam side covers fake
officials, police and embassies, "digital arrest" video custody, safe
accounts, voice clones, recovery scams, refunds with screen-sharing and
instalment cancellation. A 15-caller probe ran in each of 7 more languages.
Everything ran on the code committed as `93c1e0a`, before `867dec8` tightened the language picker; run `arena-b27-intl-v2`, 416 calls,
$24.82. "Didn't understand" counts callers who said so after KRAI-A's first
reply (the opening line is Thai for every call, since nothing is known yet).

| Callers | Calls | Met expected | Scams blocked | Scam closed as legit | Non-scam flagged SCAM | Emergencies met | Didn't understand |
|---|---|---|---|---|---|---|---|
| English, before (Thai-only replies) | 47 | 44 (94%) | 6/9 | 0 | 0/38 | 5/5 | 20/47 |
| English | 164 | 154 (94%) | 42/50 | 0 | 1/114 | 14/15 | 2/164 |
| Mandarin | 150 | 143 (95%) | 39/42 | 0 | 2/108 | 11/12 | 4/150 |
| Probe: vi, id, ms, tl, ja, ko, hi | 102 | 99 (97%) | 36/39 | 0 | 0/63 | 7/7 | not measured |

- **Same 47 English callers, before vs after:** no new wrong hang-up and no
  scam closed as legit. Scams blocked went 6/9 → 8/9.
- **Thai unchanged:** the Thai train gate on the language build is 64/64
  scams caught and 0 of 37 legit flagged as scam. Replaying 653 Thai and
  mixed arena calls plus the Thai corpus through the language picker switched
  none of them away from Thai.
- **Known limits:**
  - A real Malaysian police officer (found motorbike) was blocked as a scam.
    So were two pranksters, one English and one Mandarin, who kept asking for
    the system prompt.
  - Some English and Mandarin scams stay UNSURE (the owner gets a message;
    none was cleared as legit): utility cut-off, "fund recovery", cancel a
    student loan, fake embassy.
  - Probes are 15 calls per language: indicative only.
  - Indonesian, Malay and Tagalog are written in Latin script, so they get
    plain English without the note.
  - Japanese, Korean and Hindi callers get English plus the note, not their
    own language.
  - The opening disclosure is still Thai on every call: nothing is known
    before the caller speaks. The disclosure is repeated in the caller's
    language on the turn that language is first known.
  - The "didn't understand" count matches English and Mandarin phrases
    only. For Japanese, Korean and Hindi callers it is weak.
  - The arena is text only. Live calls depend on transcription.
- **Transcription:** `languageBias` stays `['Thai']` for all calls. Teammate
  `voice` measured it with Meta Voice file mode on phone-band audio, 3 runs ×
  70 clips. The clips are Gemini TTS voices, not human callers.

  | Bias | Thai CER | English WER | Mandarin CER |
  |---|---|---|---|
  | `['Thai']` | 5.2% | 6.4% | 4.9% |
  | Thai + English + Mandarin | 6.2% | 6.2% | 4.3% |
  | No bias | 5.9% | 6.1% | 5.4% |

  - English and Mandarin are within run-to-run noise under every option.
  - Thai is worse under the other two options in 3 of 3 runs.
  - Meta Voice supports Vietnamese, Indonesian, Malay and Tagalog, but not
    Burmese, Khmer or Lao. Those callers cannot be transcribed at all.
- **Not covered:** the sealed-intl held-out set (121 calls, pre-registered at
  `4be00fb`/`7886737`) is not run here.

**Sealed v2, stated plainly (Nov 4).** 60 held-out calls (34 SCAM, 26
LEGIT; 51 Thai, 9 English), hash pre-registered at `a1629c8` before any arena
tuning (`app/public/proof/sealed-v2-preregistration-2026-11-03.md`). Three
builds, one run each, full pipeline, Spark `muse-spark-1.2`, about $0.49 per
run. The B28 rules were written and committed (`8d58388`) before any sealed v2
result was seen, and B28 was declared the shipping build before its run.

| Build | Scams caught | Legit judged SCAM | Legit left UNSURE | Exact |
|---|---|---|---|---|
| Baseline `a1629c8` (prompt before arena tuning) | 34/34 | 0/26 | 1 (`v2-legit-water-meter-access`) | 59/60 |
| Previous production `f22b890` | 34/34 | 0/26 | 1 (`v2-legit-police-wallet-found`) | 59/60 |
| **B28 `8d58388` (shipped on Nov 4; replaced by B29 the same day)** | **34/34** | **0/26** | **0** | **60/60** |

Small n: 34/34 has a 95% CI (Wilson) of 89.8–100% for scam recall, and 0/26
of 0–12.9% for legit judged SCAM. The builds differ by one legit call left
UNSURE, which is within chance. The pre-registration named two builds
(baseline and main at code freeze = B28); previous production was run once
more for comparison. Its decision rule (ship the tuned build unless it has
more legit calls judged SCAM than the baseline) gives 0 vs 0, so B28 ships.
The Jev baseline was not run on this set. The set is now spent and its data
file is committed unchanged (`eval/sealed-v2/sealed-v2.jsonl`, sha256
`460019af…`). All three runs are on `/proof` with raw results.

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
- Every number on `/proof` is measured, with the baseline beside it where it was run.

## Links

- Event: https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Meta Model API docs: https://dev.meta.ai/docs/overview

## License

MIT — see [LICENSE](LICENSE).

KRAI-A is an independent project. Not affiliated with or endorsed by Meta.
Meta and Muse are trademarks of their respective owners. Built for the Meta
Global AI Developer Hackathon, Nov 2026.
