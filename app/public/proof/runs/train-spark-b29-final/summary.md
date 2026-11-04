# Krai-a beta eval (spark)

Run 2026-11-04T09:00:42.155Z · corpus/thai-tactics.jsonl · 146 calls / 295 judged turns · 122 Thai, 18 English
Classes: SCAM 77 · LEGIT 43 · UNSURE 26 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 100% (77/77 scam calls, 95% CI 95.2%–100%), 0 of 43 legit calls flagged as scam, median 2.4 s per turn (p90 4.3 s), ~฿0.26 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (77/77; 95% CI 95.2%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/43; 95% CI 0%–8.2%) |
| LEGIT left UNSURE (message taken) | 7% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 97.9% |
| safe outcome (class or listed safe alternative) | 98.6% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 85.7% (median lag 0 turns) |
| scam calls hung up by policy | 98.7% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 77 | 0 | 0 |
| **LEGIT** | 0 | 40 | 3 |
| **UNSURE** | 0 | 0 | 26 |

Adversarial subsets (correct / safe / n):

- no-otp-word: 1 / 1 / 1
- polite-no-keyword: 10 / 10 / 10
- slow-burn: 2 / 2 / 2
- injection: 6 / 6 / 6
- code-switch: 1 / 1 / 1
- money-but-legit: 6 / 6 / 6
- negation: 3 / 3 / 3
- looks-like-scam-opener: 1 / 1 / 1
- authority-but-legit: 7 / 7 / 7
- channel-switch: 3 / 3 / 3
- safe-verification: 2 / 2 / 2
- pressure: 2 / 2 / 2

## Latency (judge, per caller turn)

All turns: median 2.4 s, p90 4.3 s, p95 12.0 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 93.6% (276) | 2.3 s | 3.6 s |
| spark>wonder | 6.4% (19) | 14.9 s | 19.2 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.007358 ≈ ฿0.2575 per call (2.0205 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 295 turns)
- **Total judge cost ≈ $0.00736 ≈ ฿0.258 per call** (฿258 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **legit-wrong-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.5/spark > UNSURE@0.85/spark
  - last caller turn: "อ้าว ไม่ใช่เหรอครับ ขอโทษครับ สงสัยโทรผิด"
  - Jev P: n/a · signals ≥0.5: none · reason: Wrong number asking for P'Tom, no request made.
- **legit-neighbor-car** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.75/spark > UNSURE@0.78/spark
  - last caller turn: "รบกวนช่วยเลื่อนให้หน่อยได้ไหมครับ ผมต้องเอารถออกไปรับลูกครับ"
  - Jev P: n/a · signals ≥0.5: none · reason: Neighbor asks to move a car blocking the driveway; no money, code or threat.
- **legit-telco-promo-app** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.65/spark > UNSURE@0.78/spark
  - last caller turn: "สนใจกดสมัครเองในแอปของค่ายได้เลยนะคะ ไม่ต้องแจ้งข้อมูลอะไรกับดิฉันค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Unsolicited telco promo that asks nothing and directs to the carrier's own app.

Service errors during run: none
Total spend of this eval run: $1.0742 ≈ ฿37.60 (244s wall time)
