# Krai-a beta eval (spark)

Run 2026-11-03T07:59:27.394Z · corpus/thai-tactics.jsonl · 120 calls / 241 judged turns · 112 Thai, 8 English
Classes: SCAM 64 · LEGIT 37 · UNSURE 19 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 98.4% (63/64 scam calls, 95% CI 91.7%–99.7%), 0 of 37 legit calls flagged as scam, median 2.0 s per turn (p90 6.1 s), ~฿0.30 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 98.4% (63/64; 95% CI 91.7%–99.7%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/37; 95% CI 0%–9.4%) |
| LEGIT left UNSURE (message taken) | 8.1% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 96.7% |
| safe outcome (class or listed safe alternative) | 98.3% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 82.8% (median lag 0 turns) |
| scam calls hung up by policy | 96.9% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 63 | 0 | 1 |
| **LEGIT** | 0 | 34 | 3 |
| **UNSURE** | 0 | 0 | 19 |

Adversarial subsets (correct / safe / n):

- no-otp-word: 1 / 1 / 1
- polite-no-keyword: 4 / 4 / 4
- slow-burn: 1 / 1 / 1
- injection: 4 / 4 / 4
- code-switch: 1 / 1 / 1
- money-but-legit: 5 / 5 / 5
- negation: 3 / 3 / 3
- looks-like-scam-opener: 0 / 1 / 1
- authority-but-legit: 3 / 3 / 3

## Latency (judge, per caller turn)

All turns: median 2.0 s, p90 6.1 s, p95 14.9 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 90.5% (218) | 1.9 s | 3.2 s |
| spark>wonder | 9.5% (23) | 13.8 s | 18.4 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.008453 ≈ ฿0.2959 per call (2.0083 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 241 turns)
- **Total judge cost ≈ $0.00845 ≈ ฿0.296 per call** (฿296 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **scam-telco-suspend** expected SCAM, got UNSURE, ended by script-end
  - trail: UNSURE@0.6/spark > UNSURE@0.78/spark
  - last caller turn: "เพื่อไม่ให้เบอร์ถูกระงับ ขอทราบเลขบัตรประชาชนกับวันเดือนปีเกิดของเจ้าของเบอร์ แล้วดิฉันจะโอนสายไปที่ตำรวจไซเบอร์ให้ค่ะ"
  - Jev P: n/a · signals ≥0.5: authority=0.85, urgency=0.75, identityProbe=0.9 · reason: Claims mobile network will suspend number and asks for ID card and birthdate.
- **legit-wrong-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.5/spark > UNSURE@0.9/spark
  - last caller turn: "อ้าว ไม่ใช่เหรอครับ ขอโทษครับ สงสัยโทรผิด"
  - Jev P: n/a · signals ≥0.5: none · reason: Caller asked for the wrong person, apologised and gave no request.
- **legit-relative-new-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.5/spark > UNSURE@0.5/spark > UNSURE@0.6/spark
  - last caller turn: "แล้วแม่ฝากบอกว่าวันอาทิตย์นี้ชวนน้าไปทำบุญที่วัดด้วยกันนะคะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Claims to be a niece with a new number inviting to merit, asks for no money or codes.
- **legit-telco-promo-app** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.72/spark > UNSURE@0.62/spark
  - last caller turn: "สนใจกดสมัครเองในแอปของค่ายได้เลยนะคะ ไม่ต้องแจ้งข้อมูลอะไรกับดิฉันค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Unsolicited mobile package offer but asks for nothing, just points to carrier app.

Service errors during run: meta-timeout, meta-timeout
Total spend of this eval run: $1.0144 ≈ ฿35.50 (208s wall time)
