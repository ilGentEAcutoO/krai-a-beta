# Second sealed run — pre-registered before it ran (2026-11-03)

Committed before the run: the git history shows this file landing first, together with the prompt change it tests.

## Why a second sealed run

The sealed set (35 calls) was run once, on commit 64a963d. Then a real-audio test on the deployed build (10 TTS calls streamed in real time through `/api/voice/live`) found a miss. Thai parcel-scam caller, turn 2: "illegal goods were found in your parcel; verify your identity today or the police will open a case". Spark answered UNSURE 0.72. The caller claimed authority and made a threat but had not asked for anything yet, so the code policy neither blocked nor escalated.

**Trigger: real audio plus the train set. The sealed set was not consulted.** No sealed case, verdict or transcript was read to make this change.

## The change

One sentence added to the SCAM definition in `app/src/spark.js`:

> an unsolicited caller who claims authority and accuses the owner of a crime, or says their parcel, bank account or ID is linked to one (money laundering, drugs, illegal items, a warrant), and threatens arrest, prosecution or freezing is SCAM before any request is made … A debt reminder or lawsuit threat about the owner's own debt is not this pattern (UNSURE).

Measured on train (120 calls, full app pipeline, `eval-results/train-spark-c6-accuse`), compared with the shipped final train run:

| | shipped (64a963d) | with the sentence |
|---|---|---|
| accuracy | 97.5% | 97.5% |
| scams caught | 64/64 | 64/64 |
| legit calls judged SCAM | 0/37 | 0/37 |
| scams caught by the expert's turn | 75.0% | 87.5% |

## Decision rule, fixed in advance

Run the sealed set **once** on the new commit, Spark backend only. The Jev baseline did not change.

- **Ship the new prompt** unless the new sealed run has **more** legit calls judged SCAM than the 64a963d sealed run (0/10).
- If it has more, revert the sentence. Both sealed runs are still published.

Either way, /proof shows both sealed runs with their dates, configs and this reason, and the headline is whichever config ships. After this run the sealed set counts as spent: any later change is checked on train and real audio only, and labelled as such.
