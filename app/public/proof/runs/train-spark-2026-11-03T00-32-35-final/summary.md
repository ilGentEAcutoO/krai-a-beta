# Krai-a beta eval (spark)

Run 2026-11-03T00:32:36.702Z · corpus/thai-tactics.jsonl · 120 calls / 242 judged turns · 112 Thai, 8 English
Classes: SCAM 64 · LEGIT 37 · UNSURE 19 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SCAM recall 100% (64/64 scam calls, 95% CI 94.3%–100%), 0 of 37 legit calls flagged as scam, median 2.2 s per turn (p90 3.7 s), ~฿0.22 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (64/64; 95% CI 94.3%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/37; 95% CI 0%–9.4%) |
| LEGIT left UNSURE (message taken) | 10.8% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 96.7% |
| safe outcome (class or listed safe alternative) | 98.3% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 84.4% (median lag 0 turns) |
| scam calls hung up by policy | 100% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 64 | 0 | 0 |
| **LEGIT** | 0 | 33 | 4 |
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

All turns: median 2.2 s, p90 3.7 s, p95 7.2 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 95% (230) | 2.2 s | 3.2 s |
| spark>wonder | 5% (12) | 14.5 s | 21.4 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.006211 ≈ ฿0.2174 per call (2.0167 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 242 turns)
- **Total judge cost ≈ $0.00621 ≈ ฿0.217 per call** (฿217 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **legit-wrong-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.65/spark > UNSURE@0.9/spark
  - last caller turn: "อ้าว ไม่ใช่เหรอครับ ขอโทษครับ สงสัยโทรผิด"
  - Jev P: n/a · signals ≥0.5: none · reason: Wrong number looking for P'Tom, no request made.
- **legit-relative-new-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.5/spark > UNSURE@0.62/spark > UNSURE@0.62/spark
  - last caller turn: "แล้วแม่ฝากบอกว่าวันอาทิตย์นี้ชวนน้าไปทำบุญที่วัดด้วยกันนะคะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Claims to be a niece with a new number, invites to the temple, asks for no money or codes.
- **legit-telco-promo-app** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.82/spark > UNSURE@0.82/spark
  - last caller turn: "สนใจกดสมัครเองในแอปของค่ายได้เลยนะคะ ไม่ต้องแจ้งข้อมูลอะไรกับดิฉันค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Unsolicited network promo that asks for nothing and tells caller to apply themselves.
- **legit-temple-merit-invite** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.65/spark > UNSURE@0.65/spark
  - last caller turn: "เชิญมาร่วมงานได้ตามสะดวกเลยนะคะ ไม่มีค่าใช้จ่ายอะไรค่ะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Temple invites to a kathin event with no fee and asks for nothing.

Service errors during run: none
Total spend of this eval run: $0.7454 ≈ ฿26.09 (720s wall time)
