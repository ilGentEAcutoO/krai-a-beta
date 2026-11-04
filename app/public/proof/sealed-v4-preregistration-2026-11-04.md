# Sealed v4: a held-out set, pre-registered before the round-2 tuning (2026-11-04)

This file was committed before the set was used for anything, and before any of the round-2 tuning that runs after it (B30: real callers left UNSURE, and adversarial callers). The git history shows it landing first. Nobody on the KRAI-A side has opened the data file. It was copied into the repo by its hash only.

## The set

| | |
|---|---|
| File (local until the run) | `eval/sealed-v4/sealed-v4.jsonl` (gitignored) |
| sha256 of the file bytes | `d08d264c976ae865025e9c001741630ac183763cde24457a530118c4b34e4a83` |
| eval.mjs `datasetHash` | `d08d264c976ae865` (first 16 hex of the same sha256) |
| Size | 414,184 bytes, 236 calls |
| Classes | 128 SCAM, 68 LEGIT, 40 UNSURE |

| Language | SCAM | LEGIT | UNSURE | Calls |
|---|---|---|---|---|
| Thai (`th`) | 52 | 36 | 8 | 96 |
| English (`en`) | 16 | 8 | 16 | 40 |
| Mandarin (`zh`) | 16 | 12 | 8 | 36 |
| Vietnamese (`vi`) | 16 | 8 | 0 | 24 |
| Indonesian (`id`) | 12 | 4 | 8 | 24 |
| Malay (`ms`) | 8 | 0 | 0 | 8 |
| Tagalog (`tl`) | 8 | 0 | 0 | 8 |

By axis (from the generator's own pre-registration):

- shape: pushback 68, one-shot 60, slow-burn 84, slow-burn with no ask 16, early hang-up 8
- adversarial: none 172, transfer-to-owner 16, prompt injection 16, emergency bypass 16, impersonating the owner 16
- realism: dialect 40, Cantonese-flavoured Mandarin 20, elderly 8, code-switching 88, ASR noise 76, child 4
- legit look-alikes vs scam tactics: 88 legit-type briefs, 148 scam-tactic briefs

## How it was made, stated plainly

The calls were written by **Claude (`claude-opus-5-5`, Anthropic)** through the Message Batches API on 2026-11-04, from one brief per call. The label comes from the brief and is fixed by construction: no judge model filtered the set. The judge being measured is **Meta's** (Muse Spark, with Muse Wonder for the grey zone), so the generator and the judge come from different model families. It is still synthetic speech written by a model, not recorded calls. It was deduplicated against the train corpus and the other Claude-generated train batches (character 3-gram Jaccard ≥ 0.6; 0 dropped).

## Who may read it

Nobody tunes against it. The data file stays out of git and out of every prompt, few-shot, cache seed, keyword list and arena persona until the run below. After the run it is committed unchanged, so anyone can check the sha256 above.

## The run, fixed in advance

**One run, on the final round-2 build**, committed and declared final before the run, from a clean checkout of that commit, by 22:30 Thai time on Nov 4:

```
node scripts/eval.mjs --sealed-file eval/sealed-v4/sealed-v4.jsonl --backend spark --pipeline full --max-usd 3 --concurrency 4
```

Default models (Spark `muse-spark-1.2`, Wonder for the grey zone). If the $3 cap stops the run, it is resumed with `--resume` under the same cap rules, never restarted. A run that dies on service errors is reported as such and resumed. There is no baseline run on this set: the Meta credits left cover one run. Whatever the result, it is published on `/proof` with the raw per-call results, and nothing is tuned after it.
