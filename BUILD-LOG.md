# Build log — KRAI-A beta (Meta Global AI Developer Hackathon 2026)

What was built each day, with commit hashes and times (Thai time, UTC+7,
from `git log`), and how it was built. Solo entry, no other contributors: Suansinphut Jairukchan
(GitHub [@ilGentEAcutoO](https://github.com/ilGentEAcutoO)) wrote the
briefs, reviewed every change and ran the checks; the code was written by AI
coding agents under that review: **Muse Code** (Meta's Muse CLI, `muse-spark`)
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
| (this commit) | — | `/arena` per-language section, README "Regional readiness", these rows |

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
- **No tuning commits** for English/Mandarin misses: the B27 Meta budget
  ($40) was used up by measurement. The misses are listed on `/arena` and in
  the README.

## Nov 4: to be filled at code freeze

<!-- Add each Nov 3 (later) and Nov 4 commit with its time before submitting. -->

## How to check this log

```bash
git log --reverse --format='%h %ad %s' --date=iso
git show --stat <hash>
```

Commit times are local to the builder's machine (UTC+7) and are not signed.
The session transcripts and the Muse session log cited above are local files
on the builder's machine; they are not in this repo.
