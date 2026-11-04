# Krai-a beta eval (spark)

Run 2026-11-03T14:23:57.823Z · corpus/thai-tactics.jsonl · 133 calls / 265 judged turns · 121 Thai, 12 English
Classes: SCAM 72 · LEGIT 39 · UNSURE 22 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 100% (72/72 scam calls, 95% CI 94.9%–100%), 0 of 39 legit calls flagged as scam, median 2.1 s per turn (p90 3.6 s), ~฿0.22 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (72/72; 95% CI 94.9%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/39; 95% CI 0%–9%) |
| LEGIT left UNSURE (message taken) | 7.7% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 97.7% |
| safe outcome (class or listed safe alternative) | 98.5% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 86.1% (median lag 0 turns) |
| scam calls hung up by policy | 97.2% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 72 | 0 | 0 |
| **LEGIT** | 0 | 36 | 3 |
| **UNSURE** | 0 | 0 | 22 |

Adversarial subsets (correct / safe / n):

- no-otp-word: 1 / 1 / 1
- polite-no-keyword: 5 / 5 / 5
- slow-burn: 2 / 2 / 2
- injection: 5 / 5 / 5
- code-switch: 1 / 1 / 1
- money-but-legit: 5 / 5 / 5
- negation: 3 / 3 / 3
- looks-like-scam-opener: 1 / 1 / 1
- authority-but-legit: 3 / 3 / 3
- channel-switch: 3 / 3 / 3
- safe-verification: 2 / 2 / 2
- pressure: 2 / 2 / 2

## Latency (judge, per caller turn)

All turns: median 2.1 s, p90 3.6 s, p95 6.6 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 95.5% (253) | 2.1 s | 3.0 s |
| spark>wonder | 4.5% (12) | 13.9 s | 18.9 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.006389 ≈ ฿0.2236 per call (1.9925 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 265 turns)
- **Total judge cost ≈ $0.00639 ≈ ฿0.224 per call** (฿224 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **legit-wrong-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.5/spark > UNSURE@0.75/spark
  - last caller turn: "อ้าว ไม่ใช่เหรอครับ ขอโทษครับ สงสัยโทรผิด"
  - Jev P: n/a · signals ≥0.5: none · reason: Caller asked for the wrong name and hung up as a wrong number.
- **legit-neighbor-car** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.65/spark > UNSURE@0.78/spark
  - last caller turn: "รบกวนช่วยเลื่อนให้หน่อยได้ไหมครับ ผมต้องเอารถออกไปรับลูกครับ"
  - Jev P: n/a · signals ≥0.5: none · reason: Neighbor asks to move a car blocking his way, asks for nothing sensitive.
- **legit-telco-promo-app** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.65/spark > UNSURE@0.65/spark
  - last caller turn: "สนใจกดสมัครเองในแอปของค่ายได้เลยนะคะ ไม่ต้องแจ้งข้อมูลอะไรกับดิฉันค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Unsolicited telco promo but asks for nothing; says to apply in carrier's own app.

Service errors during run: none
Total spend of this eval run: $0.8497 ≈ ฿29.74 (190s wall time)
