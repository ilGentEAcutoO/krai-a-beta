# Krai-a beta eval (spark)

Run 2026-11-04T08:16:11.920Z · eval/sealed-v2/sealed-v2.jsonl · 60 calls / 145 judged turns · 51 Thai, 9 English
Classes: SCAM 34 · LEGIT 26 · UNSURE 0 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 100% (34/34 scam calls, 95% CI 89.8%–100%), 0 of 26 legit calls flagged as scam, median 2.4 s per turn (p90 4.5 s), ~฿0.29 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (34/34; 95% CI 89.8%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/26; 95% CI 0%–12.9%) |
| LEGIT left UNSURE (message taken) | 3.8% |
| UNSURE kept UNSURE | n/a · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 98.3% |
| safe outcome (class or listed safe alternative) | 98.3% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 88.2% (median lag 0 turns) |
| scam calls hung up by policy | 100% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 34 | 0 | 0 |
| **LEGIT** | 0 | 25 | 1 |
| **UNSURE** | 0 | 0 | 0 |

Adversarial subsets (correct / safe / n):

- negation: 4 / 4 / 4
- looks-like-scam-opener: 3 / 3 / 3
- money-but-legit: 7 / 7 / 7
- code-switch: 6 / 6 / 6
- authority-but-legit: 2 / 2 / 2
- slow-burn: 5 / 5 / 5
- no-otp-word: 2 / 2 / 2
- deepfake-voice: 1 / 1 / 1
- injection: 1 / 1 / 1
- polite-no-keyword: 1 / 1 / 1

## Latency (judge, per caller turn)

All turns: median 2.4 s, p90 4.5 s, p95 12.8 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 94.5% (137) | 2.3 s | 3.8 s |
| spark>wonder | 5.5% (8) | 16.0 s | 24.8 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.008272 ≈ ฿0.2895 per call (2.4167 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 145 turns)
- **Total judge cost ≈ $0.00827 ≈ ฿0.290 per call** (฿290 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **v2-legit-water-meter-access** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.6/spark > UNSURE@0.62/spark
  - last caller turn: "เดือนนี้ยอดในบิลจะเป็นการประเมินจากค่าเฉลี่ยไปก่อนนะครับ รอบจดครั้งต่อไปประมาณวันที่ 20 รบกวนช่วยเปิดทางให้เข้าถึงมิเตอร์ไว้ให้หน่อยนะครับ"
  - Jev P: n/a · signals ≥0.5: authority=0.5 · reason: Claims to be water meter reader and asks to open access for next visit.

Service errors during run: none
Total spend of this eval run: $0.4963 ≈ ฿17.37 (138s wall time)
