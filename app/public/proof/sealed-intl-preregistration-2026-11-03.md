# Sealed-intl: a held-out multilingual set, pre-registered before any multilingual tuning (2026-11-03)

This file was committed before the set was used for anything, and before any work to make KRAI-A handle English, Mandarin Chinese or other Asian languages better. The git history shows it landing first. A first version (commit 4be00fb, 115 calls) was replaced the same day, before any run, to add the nuisance and disruptive calls below; the hash in this file is the only one that counts. The goal it measures: Thai and English excellent, Mandarin Chinese as a third language, and a small probe of seven more Asian languages.

## The set

| | |
|---|---|
| File (local until the run) | `eval/sealed-intl/sealed-intl.jsonl` (gitignored) |
| sha256 of the file bytes | `66603339401e91af545c480eaba0f3e852e8100cb56cc40548696056ca622900` |
| eval.mjs `datasetHash` | `66603339401e91af` (first 16 hex of the same sha256) |
| Size | 87,910 bytes, 121 calls, 347 caller turns |
| Classes | 59 SCAM, 62 LEGIT (no UNSURE). LEGIT means "not a scam". 12 of the LEGIT calls are everyday, nuisance or disruptive calls (see below) and also accept UNSURE (`alsoOk: ["UNSURE"]`). 19 are "hard legit" (real bank fraud desks, real police, real prize, lawful debt collectors, a real embassy appointment) |
| Turns per call | 2 to 5 (41 two-turn, 59 three-turn, 17 four-turn, 4 five-turn) |

| Language (`lang`) | Calls | SCAM | LEGIT | of which nuisance/disruptive | Caller turns | Role |
|---|---|---|---|---|---|---|
| English (`en`), SG/MY/PH/IN/HK/AU-style | 44 | 18 | 26 | 8 | 135 | main |
| Mandarin Chinese, simplified (`zh`), mainland/TW/SG/MY/diaspora | 42 | 20 | 22 | 4 | 122 | main |
| Vietnamese (`vi`) | 5 | 3 | 2 | 0 | 13 | probe |
| Bahasa Indonesia (`id`) | 5 | 3 | 2 | 0 | 12 | probe |
| Malay (`ms`) | 5 | 3 | 2 | 0 | 13 | probe |
| Tagalog (`tl`) | 5 | 3 | 2 | 0 | 13 | probe |
| Japanese (`ja`) | 5 | 3 | 2 | 0 | 13 | probe |
| Korean (`ko`) | 5 | 3 | 2 | 0 | 13 | probe |
| Hindi (`hi`) | 5 | 3 | 2 | 0 | 13 | probe |

Same shape as `corpus/sealed.jsonl` (`corpus/schema.json`), with `source: "b27-sealed-intl"` and the language codes above in `lang`. No caller line is shared with `thai-tactics.jsonl` or `sealed.jsonl`.

**Everyday, nuisance and disruptive calls (12, added at the user's request before any run).** Each is labelled LEGIT (not a scam), accepts UNSURE, and carries a `call-type:` tag with the report call type we expect: English wrong number (`normal`), rambling lonely caller, giggling prankster asking for the system prompt, garbled pocket dial, caller asking only about the AI (all `nuisance`), abusive but genuine debt collector who gives no account (`debt-harassment`), insurance telemarketer (`sales`), angry neighbour over a blocked driveway (`harassment`); Mandarin wrong number, abusive online-loan collector, renovation telemarketer and garbled line. To keep the size near 115, six scam calls that repeated another call's pattern were removed before the set was frozen (a second voice-clone grandchild, a second recovery law firm, utility cut-off, advance-fee loan, a second fake consulate, a small re-delivery fee).

**How it was made.** One brief per call, written by hand: who calls, what they claim, and how the call unfolds turn by turn. Scam briefs cover digital arrest with a continuous video call, courier-to-"police" call handover, voice-cloned relatives, recovery scams, bank "safe account" transfers, courier refunds with a screen-sharing app, customs, telecom disconnection, tax and utility threats, investment and task-job scams, a wrong-number slow burn, fake embassy and public-security calls for Chinese speakers abroad, virtual kidnapping, boss impersonation, fake membership cancellation and student-loan "credit record" scams, and one prompt-injection call aimed at the AI receptionist in each of English and Chinese. Legit briefs cover real bank fraud desks that ask only yes/no and say "call the number on your card", clinics, delivery riders, schools, real prize winners told to check the official site, lawful debt collectors offering payment plans, real police asking for a witness statement, a real embassy appointment reminder, landlords, workshops and family calling from a borrowed phone. `muse-wonder-1.0` wrote the caller lines for each brief. **The label comes from the brief**: a scam persona's call is SCAM, a legit persona's call is LEGIT. No judge model filtered the set. Code checks covered format, turn count, script per language (simplified-only for Chinese), fictional 555-range numbers, no real brand names and no overlap with the existing corpus. Every English call and every Chinese call was then read in full by a person; the probe calls were skimmed. None needed dropping.

Every English and Chinese call, including all 12 nuisance calls, was read in full by a person.

Generation cost: 136 Wonder calls (121 kept; 6 trimmed scam calls; 6 drafts failed the code checks and were regenerated; 3 pilot drafts were discarded after a code-check bug was fixed), 63,407 input + 143,942 output tokens, **$3.01** at the price table in `app/src/wonder.js`.

## Who may read it

Nobody tunes against it. The data file stays out of git and out of every prompt, few-shot, cache seed, keyword list and arena persona until the run below. After the run it is committed unchanged, so anyone can check the sha256 above.

## The run, fixed in advance

Two builds, **one run each**, after code freeze (Nov 4, about 12:00 Thai time), same command:

```
node scripts/eval.mjs --sealed-file eval/sealed-intl/sealed-intl.jsonl --backend spark --pipeline full --max-usd 5
```

- **Baseline build:** current main before any multilingual change, commit `62d7c8b` (few-shot hash `bb0e0dd200bd6434`).
- **Multilingual build:** main at code freeze with the multilingual changes merged.

Default models (Spark `muse-spark-1.2`, Wonder for the grey zone). Dry-run estimate: $3.49 expected per run, $18.58 worst case, so each run is capped at $5. A run the cap stops is resumed with `--resume`, not restarted. A run that dies on service errors (fallback turns) is reported as such and resumed, never rerun from scratch. Whatever receptionist lines each build's eval harness plays between caller turns for a given `lang` are part of that build.

## Decision rule

**Legit false alarm** = a LEGIT call whose final verdict is SCAM. This includes the 12 nuisance and disruptive calls: calling an abusive collector, a prankster or a telemarketer a scam counts as a false alarm.

- **Ship the multilingual changes** unless the multilingual build has **more** legit false alarms on sealed-intl than the baseline build.
- If it has more, the multilingual pipeline changes are reverted and the baseline pipeline ships.

Both runs are published on /proof with dates, configs and this file, whichever way the rule falls. Scams caught, accuracy and scams caught by the expert's turn are reported too, overall, per language (English, Chinese, probe languages) and for the nuisance calls (verdict and report call type vs the `call-type:` tag), but they do not change the decision. After these two runs, sealed-intl counts as spent.
