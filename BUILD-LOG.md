# Build log — KRAI-A beta (Meta Global AI Developer Hackathon 2026)

What was built each day, with commit hashes and times (Thai time, UTC+7,
from `git log`), and how it was built. Solo entry, no other contributors: Suansinphut Jairukchan
(GitHub [@ilGentEAcutoO](https://github.com/ilGentEAcutoO)) wrote the
briefs, reviewed every change and ran the checks; the code was written by AI
coding agents under that review: **Muse Code** (the Muse CLI, `muse-spark`)
and **Claude Code** (Anthropic, Claude Opus worker agents). Each day below
says which one wrote what.

Event clock: kickoff livestream Oct 26, 23:00 Thai time; building period
Oct 27 – Nov 4; submissions close Nov 5, 09:00 Thai time.

## Before the event: ideas only, no code in this repo

- Oct 15–16: idea research and judging notes (market, rules, Meta platform),
  in a separate planning folder.
- Oct 26 (before kickoff): a written plan for the beta with task briefs
  B1–B14 (repo, corpus, voice relay, Spark judge, policy, eval, trap mode…).
  These were plans and briefs, not code.
- The older KRAI-A build entered in the Google Cloud AI Builder Cup
  (Oct 7–18) is **not part of this entry**; see the table in
  [README.md](README.md#whats-new-in-this-hackathon) for exactly what was
  carried over (the frozen old judge as the eval ruler, 57 train calls).
- The earliest file in this repo is dated Oct 27, 02:03 Thai time.

## Oct 27 (Day 1): first build, 02:04–03:13

| Time | Commit | What |
|---|---|---|
| 02:04:52 | `323e625` | B1: Worker scaffold, static assets, CI, public-tree secret check |
| 02:35:25 | `fe49a2a` | B3: corpus, 120 train + 35 sealed Thai calls (57 train calls ported from the old build, marked `v2-port`) |
| 02:51:32 | `f8a5796` | B9: frozen old judge copied into `app/src/baseline/` as the eval ruler, eval harness, `/showdown` |
| 02:57:14 | `de4abfe` | B5: Spark verdict client, few-shot bundle, eval backend |
| 02:59:19 | `acc9fb8` | B6: 3-tier policy + reply guard |
| 03:13:29 | `db2fd44` | B4: realtime voice relay (browser → VoiceCall DO → Meta), verdict endpoint, `/demo-live` |

**Why six big commits in 69 minutes.** All six were written by **Muse Code**
in one continuous Muse CLI session that ran from 01:37 to 03:14 Thai time
(its local session log). The first ~25 minutes trimmed the plan; from 02:03
it worked through the written briefs B1, B3, B9, B5, B6, B4 in order, and
each task was committed once its tests passed and an evidence check was run
(a local evidence-gate log shows four passing checks at 02:29, 02:35, 02:53 and 02:59). The line
counts look larger than the work: 14,595 of `f8a5796`'s lines are one JSON
file (the old judge's baseline results) and 1,556 of `323e625`'s are
`package-lock.json`. Everything else (code, tests, pages, docs) is about 4,400 lines.

The baseline run `train-jev-2026-10-26T19-45-31` (19:45 UTC = 02:45 Thai
time, Oct 27) is the old judge measured on the train calls during this
session. It is the ruler the Meta pipeline must beat, not work entered here.

## Oct 28 – Oct 31: no commits

Live model tests were blocked: the Meta Model API answered HTTP 402 (billing
not configured) until Nov 1, per the task notes. No code was committed in
these days. Any other work on these days is not recorded here.

## Nov 1: hardening, Meta models live

| Time | Commit | What | Written by |
|---|---|---|---|
| 16:53:26 | `b48f38c` | B10: `/proof` page, measured baseline beside pending Meta runs | Claude Code worker, 16:30–16:38 |
| 16:53:26 | `7763726` | B8: Muse Wonder escalation + 10-minute trap mode | Claude Code worker, 16:30–16:48 |
| 16:53:26 | `14d964c` | B7: spend cap, kill switch, rate limits, session gate | Claude Code worker, 16:29–16:51 |
| 18:00:14 | `08c7871` | B4 fix: send `model` in the realtime Voice handshake (first live voice run) | Claude Code |
| 18:11:14 | `3784dd1` | `/demo-live`: type-instead box and sample-call replay | Claude Code worker, 18:02–18:08 |
| 18:11:14 | `fc4ed4d` | eval: spend cap, checkpoints, resume, dry-run | Claude Code worker, 18:03–18:11 |
| 18:11:14 | `869a5ac` | docs: submission draft, judge guide, video storyboard, architecture | Claude Code worker, 18:03–18:10 |
| 18:37:37 | `315ab4c` | docs: builder handle | Claude Code |
| 18:40:12 | `45c18aa` | docs: Muse Code credit by commit | Claude Code |

**Why three commits share one second (twice).** Three Claude Code worker
agents worked in parallel on separate files (times above, from the session
transcripts). A reviewer agent checked the B7/B8 security diff (16:39–16:43);
then all three were committed as three separate commits by **one chained
shell command** (`git add … && git commit … && git add … && git commit …`),
which runs in well under a second. The 18:11:14 trio is the same pattern.

Live checks that day: realtime Thai transcription (final ~1.8 s after speech
ends), a fake-police call judged SCAM 0.98, a hospital call LEGIT 0.95.

## Nov 2: no commits

Nothing was committed. Any other work on this day is not recorded here.

## Nov 3: measured eval, disclosure, case report

| Time | Commit | What |
|---|---|---|
| 06:44:18 | `f94a303` | eval: measure the app pipeline (Spark → policy → Wonder), concurrency, p95 |
| 06:44:18 | `e2a19df` | `/proof`: four headline numbers with better/worse badges, tuning trail, real-use section |
| 06:44:38 | `de9abf6` | spark: verdict on Spark 1.2, effort minimal; SCAM/LEGIT/UNSURE defined by relationship |
| 06:44:51 | `9937bac` | eval: prompt + schema hash in the run config |
| 06:52:41 | `02569a1` | spark: full-schema few-shot answers with calibrated confidence, 6 pairs |
| 06:52:42 | `64a963d` | `/proof`, `/showdown`: state plainly that the baseline is the frozen pre-hackathon Google Cloud prototype |
| 06:55:33 | `3ecf9b0` | docs: old-vs-new table, this build log, no family-alert claim |
| 06:55:33 | `5bda4ab` | landing page with the built-during-the-event statement |
| 06:57:30 | `2061988` | docs: model ids match what ships; build credit; team name |
| 07:05:45 | `3e7f1cd` | `/proof`: sealed Spark + sealed Jev (one run each) and the final train run, all at `64a963d` |
| 07:06:59 | `96aa642` | `/proof`: name the runs stopped early (never scored) |
| 07:06:59 | `89c508b` | budget: daily Meta cap $15 for the judging window |
| 07:13:21 | `82d5a91` | voice relay: keep a connecting Meta socket, ignore stale sockets, merge tail fragments |
| 07:13:22 | `b7459bb` | `/demo-live`: 100 ms mic frames, merged relay turns |
| 07:13:22 | `b205d65` | real-time audio test: Meta build vs the old build on the same calls |
| 07:13:59 | `a724f63` | `/proof`: real-call test table (totals only) |
| 07:19:15 | `320d9e0` | `/demo-live`: spoken disclosure opener, case report card at call end, silence sent while the page speaks |
| 07:19:16 | `9974159` | real-audio browser test: hang up at the end and capture the report card |
| 07:20:13 | `afe5bd6` | real-audio test: disclosure line opens each call; runs record git, verdict model and effort |
| 07:27:42 | `398eb60` | spark: an authority caller accusing the owner of a crime and threatening arrest or freezing is SCAM before any ask |
| 07:33:30 | `30242ad` | `/proof`: every sealed Spark run listed with its config and the pre-registration; headline = the shipped config |
| 07:34:33 | `ca3e664` | `/demo-live`: end-call button says it makes a report (nothing is sent) |
| 07:34:42 | `99ac831` | Turnstile bot check on; per-IP daily limits sized to about $1.4 worst case per IP; daily Meta cap $15 |
| 07:34:45 | `e8f61e2` | this build log |
| 06:49:04 | `78b39e8` | G3: disclosure opener; trap never claims to be a real person |
| 06:49:04 | `a3398ef` | G8: case report at call end (`POST /api/report`) |

All Nov 3 commits were written by Claude Code agents (no Muse). The eval
work started at about 06:30 (smoke-run folder stamped 23:30 UTC, Nov 2).
Commits that share a second (`f94a303` + `e2a19df`, `78b39e8` + `a3398ef`,
`3ecf9b0` + `5bda4ab`, and the later pairs) are separate commits made by one
chained command; three agents (eval, real-audio test, docs/report) worked in
parallel on separate files. `78b39e8` and `a3398ef` were
committed after the full test suite passed on a clean checkout (161/161). The case report
was tested against live Muse Spark on two calls (about 10 s and $0.006 each).

**Stopped runs (not results).** A sealed Spark run started at 06:45:20 on the
pre-tuning config (`9937bac`: Spark 1.2 minimal → policy → Wonder, the old
10-pair few-shot with a fixed 0.95 confidence) was stopped at about 06:46
after 7 of 35 calls ($0.036). It stopped because the few-shot was to be
fixed first, and the sealed run must measure the config that ships. A train
run on the same old config was stopped at 7 of 120 ($0.040). Both are kept
locally as PARTIAL (`eval-results/sealed-spark-2026-11-02T23-45-18/`,
`train-spark-2026-11-02T23-45-16-final`) and are not shown as results; the one
published sealed Spark run is `sealed-spark-2026-11-02T23-53-01`, on the
config at `64a963d`.

**The verdict prompt changed after the first sealed run.** `398eb60` adds
one rule: an authority caller who accuses the owner of a crime or contraband
and threatens arrest or a frozen account is SCAM before any request for
money. The trigger was the real-audio test and the train set, not the sealed
calls. Because the shipped prompt then differed from the one the sealed set
had measured, a second sealed run was pre-registered first
(`app/public/proof/sealed-rerun-2026-11-03.md`, committed before the run) and
then run once. Result: same accuracy as the first sealed run, 20/20 scams
caught, 0/10 legit calls judged SCAM. The cost: the shipped prompt sends more
turns to Muse Wonder (8 of 68 vs 4 of 69), so a call costs more ($0.0091 vs
$0.0067) and the end-to-end p95 is longer (14.0 s vs 9.2 s); Spark alone is
2.3 s at p50. `/proof` lists both sealed runs with their configs and headlines
the one that ships.

Deployed on Nov 3 at `99ac831`. Checked live afterwards: the landing page and
`report-card.js` match the repo, `/api/health` reports `paused: false` and
`turnstile: true`, and a typed fake-police call on `/demo-live` got Block,
then End call produced the case report (SCAM 95%, claimed identity, mule
account and bank with the caller's words, six next steps).

## Nov 3 (afternoon): AI vs AI arena, tuning, edge cases

| Time | Commit | What |
|---|---|---|
| 13:46:39 | `4a8d5a8` | arena: Muse Wonder plays adaptive callers against the real pipeline in-process (`scripts/arena.mjs`) |
| 13:47:27 | `a1629c8` | sealed v2: a new 60-call held-out set pre-registered (hash only) before any arena tuning |
| 13:48:56 | `0391995` | arena: wave-2 personas (slow burns, convincing officials, EN/mixed, money-adjacent legit callers) |
| 14:33:29 | `ad7b6db` | arena: edge-case caller catalog, 187 personas in 22 families, with research notes |
| 14:36:23 | `610406b` | B19: fixes from the arena train misses (purpose gate, account-number lift, Wonder SCAM needs evidence, OTP refusal) |
| 14:42:37 | `22e6df0` | B25: edge-case scoring against expected behaviour; report card names non-scam call kinds |
| 15:05:37 | `491284a` | `/arena`: static replay page, linked from `/proof` and the landing page |
| (this commit) | — | B25: emergency signal + urgent close line + URGENT report banner; personal-dispute harassment rule |

How it was built: Claude Code agents (`arena`, `scenarios`, `sealer`) on
separate files, all Meta model calls metered by the harness with a hard USD
stop. The main arena run cost $33.77 for 504 games, plus about $1.5 billed for
calls in flight when the run was stopped and restarted (not recorded). Tuning
used arena **train** calls and the train corpus only; the holdout (30%, by a
hash of the call id) and sealed v2 were not used for any change. Every gate run
is in `eval-results/` (gitignored), named in the commit messages:

- **B19:** train 64/64 scams, 0/37 legit flagged, 97.5% exact. Holdout replay:
  scams blocked 74 → 76 of 89, legit hung up 1 → 0 of 57.
- **B25, shipping wording:** train 64/64 scams, 0/37 legit flagged, no scam
  closed as LEGIT. 114 of 120 calls ran before the $1 cap; the 6 unplayed are
  UNSURE-class. Holdout legit replay: 0/57 hung up.
- **Stopped and discarded:** one adaptive holdout re-run ($7.24), stopped when
  its first results showed a regression (fixed by the Wonder evidence guard
  before commit). One partial 17-persona edge run ($1.04), superseded by the
  catalog run.

## Nov 3 (late afternoon): regional callers (B27)

| Time | Commit | What |
|---|---|---|
| 15:38:15 | `4be00fb` | sealed-intl: 115 held-out calls (English, Mandarin, 7 probe languages) pre-registered, hash only, before any multilingual change |
| 15:41:00 | `7886737` | sealed-intl: plus 12 everyday/nuisance calls before any run (121 calls, new hash) |
| 15:54:59 | `93c1e0a` | receptionist, trap and guards answer in the caller's language (Thai, English, Mandarin; others English + note); regional arena catalog |
| 15:59:46 | `867dec8` | language picker: Thai script always keeps a call Thai; English needs a few words |
| 17:15:58 | `75814b1` | voice: English and Mandarin lines in the same voice; ASR language bias measured (stays Thai) |
| 17:17:46 | `809e52f` | `/arena` per-language section, README "Regional readiness", these rows |
| (this commit) | — | README limits: Thai opening line, weak "didn't understand" count for ja/ko/hi, final ASR numbers, no ASR for Burmese/Khmer/Lao. Deployed `68145c50` (voice) |

How it was measured: teammate `arena` ran 110 English/Mandarin personas
(`scripts/arena-personas/intl.mjs`, validated: invented names, 555 numbers, no
real brands) and a 15-caller probe in 7 more languages. All Meta spend was
metered with a hard USD stop:

| Run | Calls | Spend |
|---|---|---|
| Pilot | 6 | $0.38 |
| Mis-launch (defaulted to Thai calls, killed) | 4 | $0.10 |
| Before, Thai-only replies (`arena-b27-before-thaionly`) | 47 | $3.10 |
| After (`arena-b27-intl-v2`) | 416 | $24.82 |
| Thai train gate (`train-spark-b27-lang`) | 120 | $0.85 |

Total metered: $29.25, plus a few cents billed for calls in flight when runs
were stopped (not recorded). The sealed-intl and sealed-v2 sets were not opened.

- **Gate before deploy:**
  - Thai train: 64/64 scams caught, 0 of 37 legit flagged.
  - Same 47 English callers before vs after: no new wrong hang-up and no scam
    closed as legit. Scams blocked went 6/9 → 8/9.
  - Callers saying they didn't understand after the first reply: 20/47 →
    2/164 (English); 4/150 (Mandarin).
- **Defense prompt changes (from teammate `r-defense`'s research), train
  only:**
  - A2: telling the owner to check it themselves on the organisation's own
    app, branch or notice board, with nothing supplied by the caller and no
    fee, is UNSURE, not SCAM.
  - A1: an authority or accusing caller who asks for a LINE add, a video
    call, the camera on, going somewhere alone, showing the bank app or
    keeping it from family is SCAM.
  - A3: 5 train cases.
  - Gate (`train-spark-b27-defense`, $1.02): scams 67/67, 0 of 37 legit
    flagged, 123/125 exact (was 117/120). Both genuine-prize cases ended
    UNSURE.
- **No tuning commits** for English/Mandarin misses: the B27 Meta budget
  ($40) was used up by measurement. The misses are listed on `/arena` and in
  the README.

## Nov 4: B28 and the sealed v2 runs

| Time | Commit | What |
|---|---|---|
| 15:16:11 | — | sealed v2 run started on the baseline build `a1629c8` (`eval-results/sealed-v2-spark-base-a1629c8`) |
| 15:16:12 | — | sealed v2 run started on previous production `f22b890` (`eval-results/sealed-v2-spark-head-f22b890`) |
| 15:18:11 | `8d58388` | B28: utility cut-off, recovery-scam, document-scare and prank rules with 8 train calls (train 72/72 scams, 0/39 legit flagged); declared the shipping build |
| 15:18:16 | — | sealed v2 run started on B28 `8d58388` (`eval-results/sealed-v2-spark-b28-8d58388`) |
| 15:25:40 | `ff5ac60` | `/proof`: sealed v2 tab (headline = B28), all three runs listed with raw results; sealed v2 data file committed unchanged |

The B28 rules were written and train-checked on Nov 3, before any sealed v2
result existed; the commit landed five seconds before the B28 sealed run
started.

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
| **B28 `8d58388` (shipped)** | **34/34** | **0/26** | **0** | **60/60** |

Small n: 34/34 has a 95% CI (Wilson) of 89.8–100% for scam recall, and 0/26
of 0–12.9% for legit judged SCAM. The builds differ by one legit call left
UNSURE, which is within chance. The pre-registration named two builds
(baseline and main at code freeze = B28); previous production was run once
more for comparison. Its decision rule (ship the tuned build unless it has
more legit calls judged SCAM than the baseline) gives 0 vs 0, so B28 ships.
The Jev baseline was not run on this set. The set is now spent and its data
file is committed unchanged (`eval/sealed-v2/sealed-v2.jsonl`, sha256
`460019af…`). All three runs are on `/proof` with raw results.

## Nov 4 (afternoon): B29, sealed intl, family-chat adapters, site for judges

| Time | Commit | What | Written by |
|---|---|---|---|
| 15:57:06 | `ef63716` | site: landing shows the problem with sources, sealed v2 headline, per-model latency and cost, visible limits, old-vs-new and privacy; README and SUBMISSION rewritten for judges; judge guide matches the current UI | Claude Code worker (site) |
| 15:58:42 | `b4ceeb5` | site: demo-live toasts follow the TH/EN toggle, mic-denied state points to typing, Turnstile status clears; storyboard and diagram match the shipped voice and sealed v2 | Claude Code worker (site) |
| 16:01:21 | `11756c2` | notify: opt-in Telegram, WhatsApp and LINE delivery of the case report | Claude Code worker (adapters) |
| 16:02:18 | `b3ba2e3` | notify: hook opt-in family chat delivery after /api/report | Claude Code worker (adapters) |
| 16:03:24 | `fcd923f` | site: hero video slot (video.json per language, click-to-load youtube-nocookie, placeholder until the video exists); EN landing shows no Thai text, Thai hotlines or Thai report; USD figures in EN | Claude Code worker (site) |
| 16:04:30 | `8d160fe` | docs: SUBMISSION.md holds the 20 form fields in form order, paste-ready, numbers from sealed v2 | Claude Code worker (site) |
| 16:05:17 | `c786af2` | B29: bank 'fraud team' that refuses a message and cold invitations to private trading groups are SCAM; 13 train calls (TH/EN/ZH) | Claude Code worker (trainer) |
| 16:07:14 | `470c140` | site: proof, arena and showdown show no Thai script in English mode (USD only, English glosses of KRAI-A's Thai lines, Thai-language replays listed in Thai mode) | Claude Code worker (site) |
| 16:09:46 | `7ade3d3` | site: Fork it section (Telegram, LINE, WhatsApp delivery for forks: opt-in, contract-tested, not live-verified, off on the demo); README and SUBMISSION say the same | Claude Code worker (site) |
| 16:12:13 | `07f79fc` | proof: sealed-intl run once on B29 (c786af2): 57/59 scams, 0/62 legit flagged; train headline B29; sealed-intl data committed unchanged | Claude Code worker (trainer) |
| 16:14:52 | `3d53748` | trap: a word after "LINE" is a chat id only if it looks like one ("Add our LINE and turn on video" no longer reports LINE ID: and) | Claude Code worker (trainer) |
| 16:14:55 | `104d7ec` | site: For judges strip mapped to the rubric with evidence links; OG and Twitter cards from a real page capture; design pass (contrast of muted text, 44px footer and checkbox targets, heading levels, anchor offset) | Claude Code worker (site) |
| 16:17:56 | `d91203e` | site: shipped build is B29; headline adds sealed-intl (57/59 scams, 0/62 real callers flagged, 24/62 left as a message) beside sealed v2 60/60 on B28; latency, cost and Wonder share from the B29 run; OG image recaptured | Claude Code worker (site) |
| 16:20:24 | `8a517da` | proof: sealed intl tab (121 calls, 9 languages, one run on B29) with the stated-plainly notes, per-language table and Wilson CIs; set chips count every set in data.json; unknown default set falls back to train | Claude Code worker (trainer) |
| 16:20:41 | `db36fc6` | B30a: pre-register sealed v4 (236 Claude-generated held-out calls, sha256 d08d264c...) before round-2 tuning | Claude Code worker (trainer) |

**B29 and sealed intl.** B29 (`c786af2`) adds two rules: a "bank fraud team"
caller who refuses to leave a message is SCAM, and so is a cold call inviting
the owner to a private or VIP trading group, plus 13 train calls (TH/EN/ZH).
Train went from 72/72 scams and 0/39 legit flagged (B28) to 77/77 and 0/43
(B29). The sealed-intl set (121 calls in 9 languages, pre-registered at
`7886737`) was then run once from a clean checkout of `c786af2`: 57/59 scams
caught, 0/62 legit judged SCAM, no scam passed as legit, 24/62 legit left
UNSURE. The pre-registered baseline run was not done (credits covered one
run). The judge files are frozen at `c786af2` from here on.

**Deploys.** From this afternoon every deploy is made from a clean git
worktree of `origin/main`, so a teammate's uncommitted edits never ship.

## Nov 4 (evening): B30, sealed v4, voice-first demo

| Time | Commit | What | Written by |
|---|---|---|---|
| 16:22:32 | `0ec3449` | proof: ready for sealed v4 (hidden chip shown once data.json has the set; one-run story shared with sealed intl, Thai row supported) | Claude Code worker (trainer) |
| 16:22:36 | `7675e71` | B30a: amend sealed v4 pre-registration before any run or tuning: run only the first 100 ids by sha256("v4-subset:"+id) (eval.mjs --hash-subset); 136 stay sealed | Claude Code worker (trainer) |
| 16:32:06 | `13fcaae` | B30: LEGIT needs a stated everyday purpose (owner/friend/emotional openers stay UNSURE), LEGIT without a callback is heard to turn 4, real bank fraud desks that say the card is blocked stay LEGIT; 4 coverage train calls | Claude Code worker (trainer) |
| 16:37:43 | `e185043` | demo: voice-first call stage with recorded multilingual calls; report follows the call language and region | Claude Code worker (demo) |
| 16:40:50 | `3af4014` | proof: sealed v4 subset run once on B30 (13fcaae): 31/59 scams blocked, 4 scams ended LEGIT, 0/18 legit flagged; Claude-generated set, 136 calls still sealed | Claude Code worker (trainer) |
| 16:43:04 | `104165b` | samples: add English and Mandarin train picks (bank fraud-team push EN/ZH, courier in the lobby, survey call) so the English demo lists more than one text sample | Claude Code worker (trainer) |
| 16:43:45 | `83754df` | site: shipped build is B30; sealed v4 (hard, Claude-written, 100 of 236) stated plainly beside sealed-intl (B29) and sealed v2 (B28): 31/59 scams blocked, 4 put through, 0/106 real callers judged scam across all three; proof v4 story counts the subset and its UNSURE class; README, SUBMISSION, judge guide and OG image follow | Claude Code worker (site) |
| 16:44:52 | `cfa0eb0` | proof: defaultSet 'overview' (the all-sealed-sets view opens first); headlineSet keeps the newest set with a complete run | Claude Code worker (trainer) |
| 16:46:41 | `fda1542` | site: landing CTAs follow the voice-first demo (hear a recorded scam call, then be the scammer); judge guide walks the new recorded-calls and live tabs; OG image recaptured | Claude Code worker (site) |

**B30 and sealed v4, stated plainly.** B30 (`13fcaae`): a LEGIT verdict needs
a stated everyday purpose (callers who say they are the owner or a friend, or
open emotionally, stay UNSURE); LEGIT calls with no callback number are heard
to turn 4; a real bank fraud desk that says the card is already blocked stays
LEGIT. Sealed v4 is 236 hard calls written by Claude (`claude-opus-5-5`),
pre-registered before round-2 tuning; a 100-call hash subset (rule committed
in `7675e71` before any run) was run once on B30: 31/59 scams blocked, 4 scams
ended LEGIT, the other 24 missed scams ended UNSURE, 0/18 legit judged SCAM.
It is a much harder set and the result is low. Sealed-intl (B29) and sealed v2
(B28) were not re-run on B30. The other 136 v4 calls stay sealed.

**Receptionist conversation flow (after the sealed runs, Nov 4).** Commits
`705d210` and `3f6412d` (`receptionist.js`):
- no slot is asked more than twice, and never once it was given;
- one question per AI turn, with offer-a-message and "anything else?" lines
  (TH/EN/ZH, 9 new pre-generated lines);
- a non-scam goodbye never lands right on top of the AI's own question; it
  waits one caller turn. SCAM still closes at once.

Verdict logic is unchanged: `spark.js`, `wonder.js`, `policy.js` and the B30
close timing (LEGIT heard to turn 4) are untouched, so the sealed numbers
stand. On the demo page, the Thai hospital and English delivery calls were
re-recorded as 4-turn calls where the caller answers the receptionist (real
run, about $0.065 of Meta usage, 17 Gemini TTS requests).

**Closes and T1 routing (`6186260`, deployed as `8c1575b9`).**
- Every close is now one line, "we pass it on", plus a goodbye. It never
  says "the owner is not available" (TH/EN/ZH, for legit, unsure, urgent and
  scam closes). A scam close promises no callback.
- The T1 code rules for transfer-now and account dictation now ignore call
  routing ("transfer me to the owner", "put me through", "connect me",
  โอนสาย, 转接). This changed the T1 code rules after the sealed runs. The
  Spark and Wonder prompts and `decideSpark` are unchanged, but the sealed
  numbers were measured with the earlier T1 rules and were not re-run. One
  visible effect: the English prompt-injection demo call is no longer closed
  by T1 at turn 2.
- The Vietnamese bank demo call's caller clip was re-synthesized with its
  full ending.

## How to check this log

```bash
git log --reverse --format='%h %ad %s' --date=iso
git show --stat <hash>
```

Commit times are local to the builder's machine (UTC+7) and are not signed.
The session transcripts and the Muse session log cited above are local files
on the builder's machine; they are not in this repo.
