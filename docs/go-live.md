# Go-live: the low-cost sequence for when Meta credits land

Until the free credits show on the account, **nothing here calls the Meta
API**. Every step below has a dry-run line first: `--dry-run` sizes the real
requests (system prompt + all 10 few-shot pairs + JSON schema + the growing
transcript, in UTF-8 bytes) and prices them with `app/src/eval.js` PRICING
(Spark $1.25 in / $0.15 cached / $4.25 out per 1M tokens). It makes zero
network calls and writes nothing.

All commands run from `app/`. Local eval runs read `META_MODEL_API_KEY` from
the shell (not from the Worker secret):

```bash
cd app
export META_MODEL_API_KEY=...   # never commit, never paste in chat
```

## How the estimates are made

| | worst case | expected |
|---|---|---|
| input tokens per turn | = request bytes (byte-level BPE never emits more tokens than bytes) | request bytes / 2.5 (mostly-Thai text) |
| output tokens per turn | 8192 (same bound `src/index.js` reserves; every Spark, Wonder, trap and report call sends `max_completion_tokens: 8192` since `d3b26d4`) | 600 (JSON verdict + low-effort reasoning) |
| prompt cache | none | none (Meta may cache the few-shot prefix at $0.15/1M, which would only lower the real bill) |
| turns per case | every script turn | every script turn (a hang-up ends a call early, so real calls are fewer) |

The expected figure is an assumption until step (c) measures the real cost
per case. After the smoke run, use its measured `spend.usd / 5` instead.

## Safety nets that are always on

- `--max-usd N` is **required** for any spark run (the npm scripts pass one).
  The runner tracks metered USD live and stops **before** the next case would
  likely cross the cap (running average cost per finished case; before the
  first case, that case's expected estimate). The cap is cumulative over the
  whole run directory, resumes included.
- Every finished case is appended to `eval-results/<run>/cases.jsonl` at once.
  A cap stop or Ctrl+C writes `results.json` with `partial: true`; nothing
  measured is lost. Continue with `--resume eval-results/<run> --max-usd <cap>`
  (refused if set, backend, model, few-shot hash or corpus changed).
- Hard kill (terminal closed): `node ../scripts/eval.mjs --finalize ../eval-results/<run>`
  rebuilds `results.json` from `cases.jsonl` with no calls.
- First case never reached Spark (402 billing, bad key) → abort, exit 3, no
  results written. A run of fallbacks is not a measurement.
- `/proof` shows a partial or subset run as **partial n/total**, never as the
  full-set result; a complete run always wins over a partial one.

## The sequence

### (a) Check the balance shows the free credits — $0

Open the Meta developer billing page (dev.meta.ai → billing) and confirm the
credit balance is there and billing is active. The runner's `GET /models`
probe is free but only proves the key, not billing. Do not start (c) until
the balance shows.

### (b) Turn the public kill switch off — $0 by itself

```bash
npx wrangler secret put KILL_SWITCH    # enter: 0
```

Only the deployed demo reads `KILL_SWITCH` (`1/true/yes/on` = paused). Local
evals do not go through the Worker, so this step does not affect eval spend.
Once off, public demo traffic can spend up to `DAILY_USD_CAP` ($5 per UTC
day, `wrangler.jsonc`). If credits are tight, you can move this step to just
before (g) and keep the demo paused while the evals run.

### (c) 5-case smoke — expected $0.10, worst $0.57, cap $0.25

```bash
npm run eval:smoke:spark -- --dry-run
# planned cases: 5 · estimated calls: 11 · expected $0.1019 · worst $0.5676
npm run eval:smoke:spark
```

Cases: `scam-police-summons`, `scam-inject-ignore-en`, `legit-bank-callback`,
`legit-parcel-cod`, `unsure-debt-collector` (Thai + English, all three
classes, one injection). It proves the key, billing, JSON schema and metering
end to end. Read `results.json` → `spend.usd`: that divided by 5 is the real
cost per case to plan (d) and (f) with. The run is marked `SUBSET 5/120` and
`/proof` will never present it as the train result.

### (d) Train run with a cap — expected $2.39, worst $13.30

```bash
npm run eval:train:spark -- --dry-run
# planned cases: 120 · estimated calls: 258 · expected $2.3854 ($0.0199/case)
# worst-case $13.3012 · cap $2: expected completes 99/120, worst stops after 14/120
```

The default cap of $2 is **below** the expected full-run cost, so pick the
cap from the smoke measurement: `measured $/case x 120 x 1.2`. With the
expected figure that is about $3 (`--max-usd 3`: expected completes 120/120,
worst stops after 22/120):

```bash
npm run eval:train:spark -- --max-usd 3
```

If it stops on the cap, it is already saved as partial. Decide, then:

```bash
node ../scripts/eval.mjs --resume ../eval-results/<train-spark-dir> --max-usd 4
```

### (e) Prompt / latency tuning — on TRAIN only

Any change to the few-shots, prompt, thresholds or model is a new
measurement: the few-shot hash changes and `--resume` refuses to mix it into
an old run. Iterate on cheap subsets first:

```bash
node ../scripts/eval.mjs --backend spark --max-usd 0.5 --cases id1,id2,id3   # only the misses
node ../scripts/eval.mjs --backend spark --max-usd 0.5 --limit 10
```

Each 10-case subset costs about $0.20 expected. Re-run the full train set
(d) once at the end. Never look at `corpus/sealed.jsonl` while tuning.

### (f) Sealed: Spark once + Jev once

```bash
npm run eval:sealed:spark -- --dry-run
# planned cases: 35 · estimated calls: 69 · expected $0.6342 ($0.0181/case)
# worst $3.5479 · cap $2: expected completes 35/35, worst stops after 19/35
npm run eval:sealed:spark

npm run eval:sealed:jev -- --dry-run
# planned cases: 35 · estimated calls: 69 · expected $0.0056 · worst $1.4846
npm run eval:sealed:jev
```

Sealed is run **once** per backend, after tuning is frozen. If the cap stops
the sealed Spark run, resume the same directory (that continues the one run;
it is not a re-run). The Jev baseline needs `TYPESAFE_API_KEY` and
`GEMINI_API_KEY`; the last measured full train Jev run cost $0.038.

### (g) Publish /proof and deploy — $0

```bash
npm run proof:build      # lists any partial/unfinalized run; partial = n/total on the page
npm test
npm run deploy
```

### (h) Kill switch back on after the video is recorded (if credits are tight) — $0

```bash
npx wrangler secret put KILL_SWITCH    # enter: 1
```

## Budget at a glance (dry-run, 2026-11-01)

| step | cases | calls | expected | worst case | cap |
|---|---|---|---|---|---|
| (c) smoke | 5 | 11 | $0.10 | $0.57 | $0.25 |
| (d) train Spark | 120 | 258 | $2.39 | $13.30 | ~$3 from smoke |
| (f) sealed Spark | 35 | 69 | $0.63 | $3.55 | $2 |
| (f) sealed Jev | 35 | 69 | $0.006 | $1.48 | none needed |
| **total, one pass each** | | | **≈ $3.13** | $18.90 | |

Plus any (e) tuning subsets (~$0.02 per case expected). Re-run the dry-runs
(`npm run eval:dry -- --backend spark`) after any prompt or few-shot change:
the few-shot prompt is most of every request, so its size drives the cost.
