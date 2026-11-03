# Sealed v2: a new held-out set, pre-registered before anyone tunes against it (2026-11-03)

This file was committed before the set was used for anything, and before the arena tuning work (AI-vs-AI callers, train set only) started changing the pipeline. The git history shows it landing first.

## Why a new set

The first sealed set (35 calls) is spent: it was run on 64a963d and again under the pre-registered rerun in `sealed-rerun-2026-11-03.md`. Any later change needs a set that nobody has seen.

## The set

| | |
|---|---|
| File (local until the run) | `eval/sealed-v2/sealed-v2.jsonl` (gitignored) |
| sha256 of the file bytes | `460019af829e5516be564241ee33b7f2a9335c80aae3ceccd9e86b5a79b5eb9c` |
| eval.mjs `datasetHash` | `460019af829e5516` (first 16 hex of the same sha256) |
| Size | 80,180 bytes, 60 calls, 181 caller turns |
| Classes | 34 SCAM, 26 LEGIT (no UNSURE) |
| Language | 51 Thai (6 of them heavy Thai-English code-switch), 9 English |
| Turns per call | 2 to 5 (18 two-turn, 27 three-turn, 11 four-turn, 4 five-turn) |

Same shape as `corpus/sealed.jsonl` (`corpus/schema.json`), with `source: "b17-sealed-v2"`. No id and no caller line is shared with `thai-tactics.jsonl` or `sealed.jsonl`.

**How it was made.** One brief per call, written by hand: who calls, what they claim, and how the call unfolds turn by turn. The briefs cover impersonated bank, police, parcel/customs, family emergency (including a flat, cloned-sounding grandchild voice), job, investment, utility, telco, government, hospital and school calls. There are slow-burn calls that only ask on turn 4 or 5, female callers, one prompt-injection call aimed at the AI receptionist, and legit calls from hospitals, delivery riders, banks, schools, utilities, HR and family. `muse-wonder-1.0` wrote the caller lines for each brief. **The label comes from the brief**: a scam persona's call is SCAM, a legit persona's call is LEGIT. No judge model filtered the set, so it does not lean toward what any of our judges already gets right. Code checks covered format, language, turn count, fictional 555-range numbers, no real brand names and no overlap with the existing corpus. Then all 62 drafts were read in full by a person. Two extra legit drafts were dropped to reach 60.

Generation cost: 66 Wonder calls, 30,370 input + 71,444 output tokens, **$1.48** at the price table in `app/src/eval.js`.

## Who may read it

Nobody tunes against it. The data file stays out of git and out of every prompt, few-shot, cache seed, keyword list and arena persona until the run below. After the run it is committed unchanged, so anyone can check the sha256 above.

## The run, fixed in advance

Two builds, **one run each**, same command:

```
node scripts/eval.mjs --sealed-file eval/sealed-v2/sealed-v2.jsonl --backend spark --pipeline full --max-usd 5
```

- **Baseline build:** main with today's pipeline. Its pipeline files are unchanged since b5fae7a (`promptHash f8eba3dbeffa67af`, `fewshotHash 436a1c020b164513`; blobs: spark.js a6eeffee31a1, policy.js 2bf97130b98c, wonder.js 1b8b8ee0c72a, fewshot.json b4a6047b7415, cache.js 15e9cbe599cd).
- **Tuned build:** main at code freeze (Nov 4, about 12:00 Thai time), with the arena tuning merged.

Default models (Spark `muse-spark-1.2`, Wonder for the grey zone). Dry-run estimate: $1.72 expected per run, $9.45 worst case, so each run is capped at $5. A run the cap stops is resumed with `--resume`, not restarted. A run that dies on service errors (fallback turns) is reported as such and resumed, never rerun from scratch.

## Decision rule

**Legit false alarm** = a LEGIT call whose final verdict is SCAM.

- **Ship the tuned build** unless it has **more** legit false alarms on sealed v2 than the baseline build.
- If it has more, the tuned pipeline changes are reverted and the baseline pipeline ships.

Both runs are published on /proof with dates, configs and this file, whichever way the rule falls. Scams caught, accuracy and scams caught by the expert's turn are reported too, but they do not change the decision. After these two runs, sealed v2 counts as spent.
