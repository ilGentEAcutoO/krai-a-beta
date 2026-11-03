# Krai-a beta eval (spark)

Run 2026-11-03T00:27:52.314Z · corpus/sealed.jsonl · 35 calls / 68 judged turns · 35 Thai, 0 English
Classes: SCAM 20 · LEGIT 10 · UNSURE 5 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 100% (20/20 scam calls, 95% CI 83.9%–100%), 0 of 10 legit calls flagged as scam, median 2.3 s per turn (p90 12.2 s), ~฿0.32 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (20/20; 95% CI 83.9%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/10; 95% CI 0%–27.8%) |
| LEGIT left UNSURE (message taken) | 10% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 97.1% |
| safe outcome (class or listed safe alternative) | 97.1% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 100% (median lag 0 turns) |
| scam calls hung up by policy | 85% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 20 | 0 | 0 |
| **LEGIT** | 0 | 9 | 1 |
| **UNSURE** | 0 | 0 | 5 |

Adversarial subsets (correct / safe / n):

- deepfake-voice: 1 / 1 / 1
- negation: 0 / 0 / 1

## Latency (judge, per caller turn)

All turns: median 2.3 s, p90 12.2 s, p95 14.0 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 88.2% (60) | 2.2 s | 3.3 s |
| spark>wonder | 11.8% (8) | 13.4 s | 16.1 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.009143 ≈ ฿0.3200 per call (1.9429 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 68 turns)
- **Total judge cost ≈ $0.00914 ≈ ฿0.320 per call** (฿320 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **s-legit-insurance-renewal-channel** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.64/spark > UNSURE@0.64/spark
  - last caller turn: "สนใจต่อผ่านตัวแทนเดิมหรือในแอปของบริษัทได้เลยค่ะ ไม่มีเก็บเงินทางโทรศัพท์ค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Insurance renewal reminder with no payment or data request.

Service errors during run: none
Total spend of this eval run: $0.3200 ≈ ฿11.20 (248s wall time)
