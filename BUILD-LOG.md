# Build log — KRAI-A beta (Meta Global AI Developer Hackathon 2026)

What was built each day, with commit hashes and times (Thai time, UTC+7,
from `git log`), and how it was built. Solo entry, no other contributors: ilGentEAcutoO
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
| 07:34:33 | `ca3e664` | `/demo-live`: end-call button says it makes a report (nothing is sent) |
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
