# Krai-a beta eval (jev-baseline)

Run 2026-10-26T19:47:55.747Z · corpus/thai-tactics.jsonl · 120 calls / 248 judged turns · 112 Thai, 8 English
Classes: SCAM 64 · LEGIT 37 · UNSURE 19 · engines: Jev jev-latest (jev-1.14.0) · Gemini gemini-3.5-flash-lite (escalation)

**Headline:** SCAM recall 100% (64/64 scam calls, 95% CI 94.3%–100%), 2 of 37 legit calls flagged as scam, median 0.27 s per turn (p90 1.4 s), ~฿0.01 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (64/64; 95% CI 94.3%–100%) |
| SCAM precision (all calls) | 92.8% |
| SCAM precision vs legit only | 97% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 5.4% (2/37; 95% CI 1.5%–17.7%) |
| LEGIT left UNSURE (message taken) | 10.8% |
| UNSURE kept UNSURE | 73.7% · to SCAM 3 · to LEGIT 2 |
| accuracy (exact class) | 90.8% |
| safe outcome (class or listed safe alternative) | 95% |
| median turns to correct verdict | all 1 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 93.8% (median lag 0 turns) |
| scam calls hung up by policy | 98.4% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 64 | 0 | 0 |
| **LEGIT** | 2 | 31 | 4 |
| **UNSURE** | 3 | 2 | 14 |

Adversarial subsets (correct / safe / n):

- no-otp-word: 1 / 1 / 1
- polite-no-keyword: 4 / 4 / 4
- slow-burn: 1 / 1 / 1
- injection: 4 / 4 / 4
- code-switch: 1 / 1 / 1
- money-but-legit: 1 / 2 / 5
- negation: 3 / 3 / 3
- looks-like-scam-opener: 1 / 1 / 1
- authority-but-legit: 3 / 3 / 3

## Latency (judge, per caller turn)

All turns: median 0.27 s, p90 1.4 s

| path | share of turns | median | p90 |
|---|---|---|---|
| jev>gemini | 27.4% (68) | 1.3 s | 1.6 s |
| jev | 71.8% (178) | 0.27 s | 0.29 s |
| rule | 0.8% (2) | 0.27 s | 0.27 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.000315 ≈ ฿0.0110 per call (2.0667 turns/call, Jev 1324 input tokens/turn, 68 Gemini escalations in 248 turns)
- **Total judge cost ≈ $0.00032 ≈ ฿0.011 per call** (฿11 per 1,000 calls). Judge only (Jev + Gemini escalation). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **legit-parcel-cod** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: LEGIT@0.95/jev > UNSURE@0.52/jev>gemini
  - last caller turn: "ลงมารับที่ล็อบบี้ได้เลยค่ะ จ่ายเงินสดหรือสแกนจ่ายตอนรับของก็ได้ค่ะ ดิฉันรอได้สิบนาทีนะคะ"
  - Jev P: SCAM 0.09, LEGIT 0.87, UNSURE 0.04 · signals ≥0.5: authority=0.89, urgency=0.68, moneyTransfer=0.67 · reason: Not conclusive yet: asks for a money transfer or account number + threatens or rushes the owner + says it is calling from an organisation or company.
- **legit-wrong-number** expected LEGIT, got UNSURE (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.97/jev > UNSURE@0.75/jev
  - last caller turn: "อ้าว ไม่ใช่เหรอครับ ขอโทษครับ สงสัยโทรผิด"
  - Jev P: SCAM 0, LEGIT 0.25, UNSURE 0.75 · signals ≥0.5: none · reason: Not enough information yet; still listening.
- **unsure-debt-collector** expected UNSURE, got SCAM (listed as a safe alternative), ended by hangup
  - trail: UNSURE@0.9/jev > SCAM@0.875/jev>gemini
  - last caller turn: "ถ้าไม่ติดต่อกลับภายในวันนี้ จะส่งเรื่องฟ้องศาลนะครับ ติดต่อกลับที่ 02-555-0188 ครับ"
  - Jev P: SCAM 0.75, LEGIT 0.02, UNSURE 0.23 · signals ≥0.5: urgency=0.99, callbackGiven=0.99 · reason: The caller claimed to be a law office threatening court action if not contacted back today, which is a suspicious coercive tactic.
- **legit-school-fee-channel** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.635/jev>gemini > UNSURE@0.615/jev>gemini
  - last caller turn: "จ่ายที่การเงินโรงเรียนหรือโอนเข้าบัญชีโรงเรียนตามประกาศหน้าโรงเรียนเท่านั้นค่ะ"
  - Jev P: SCAM 0.27, LEGIT 0.5, UNSURE 0.23 · signals ≥0.5: urgency=0.56, moneyTransfer=0.87 · reason: Not conclusive yet: asks for a money transfer or account number.
- **legit-condo-fee-notice** expected LEGIT, got SCAM, ended by hangup
  - trail: LEGIT@0.675/jev>gemini > SCAM@0.91/jev
  - last caller turn: "โอนเข้าบัญชีนิติบุคคลตามที่ประกาศไว้ที่บอร์ดชั้นหนึ่ง ภายในวันที่สิบค่ะ"
  - Jev P: SCAM 0.7, LEGIT 0.12, UNSURE 0.18 · signals ≥0.5: urgency=0.74, moneyTransfer=0.91 · reason: Scam signals: asks for a money transfer or account number + threatens or rushes the owner.
- **legit-delivery-cod-ordered** expected LEGIT, got SCAM, ended by hangup
  - trail: LEGIT@0.86/jev > SCAM@0.86/jev
  - last caller turn: "ตรวจสอบชื่อผู้รับตรงกับที่สั่งแล้ว จ่ายตอนรับของได้เลยครับ"
  - Jev P: SCAM 0.16, LEGIT 0.78, UNSURE 0.06 · signals ≥0.5: authority=0.92, moneyTransfer=0.86 · reason: Scam signals: asks for a money transfer or account number + says it is calling from an organisation or company.
- **legit-telco-promo-app** expected LEGIT, got UNSURE, ended by script-end
  - trail: UNSURE@0.74/jev > UNSURE@0.675/jev>gemini
  - last caller turn: "สนใจกดสมัครเองในแอปของค่ายได้เลยนะคะ ไม่ต้องแจ้งข้อมูลอะไรกับดิฉันค่ะ"
  - Jev P: SCAM 0.41, LEGIT 0.24, UNSURE 0.35 · signals ≥0.5: appInstall=0.75 · reason: Not conclusive yet: asks to install an app or open a link.
- **unsure-filter-sales-visit** expected UNSURE, got LEGIT, ended by script-end
  - trail: UNSURE@0.68/jev > LEGIT@0.68/jev>gemini
  - last caller turn: "ขอนัดเข้าไปสาธิตที่บ้านได้ไหมคะ สะดวกวันไหนบ้างคะ"
  - Jev P: SCAM 0.03, LEGIT 0.36, UNSURE 0.61 · signals ≥0.5: none · reason: It is a routine sales offer for products and services without pressure or requests for sensitive information.
- **unsure-charity-monthly** expected UNSURE, got SCAM, ended by script-end
  - trail: UNSURE@0.76/jev > SCAM@0.785/jev>gemini
  - last caller turn: "เดือนละสองร้อยบาท หักผ่านบัตรเครดิต สนใจสมัครทางโทรศัพท์ได้เลยค่ะ"
  - Jev P: SCAM 0.57, LEGIT 0.12, UNSURE 0.31 · signals ≥0.5: moneyTransfer=0.92 · reason: Scammers impersonated a foundation to solicit monthly credit card donations, posing a high risk of financial loss.
- **unsure-robocall-press1** expected UNSURE, got SCAM (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.97/jev > SCAM@0.69/jev>gemini
  - last caller turn: "กรุณากดหนึ่งเพื่อติดต่อเจ้าหน้าที่ กดเก้าเพื่อฟังซ้ำค่ะ"
  - Jev P: SCAM 0.38, LEGIT 0.02, UNSURE 0.6 · signals ≥0.5: none · reason: The automated call claimed to have an important matter and asked to press numbers to contact an agent, which is a common scam script.
- **unsure-wrong-name-close** expected UNSURE, got LEGIT (listed as a safe alternative), ended by script-end
  - trail: UNSURE@0.87/jev > LEGIT@0.755/jev>gemini
  - last caller turn: "อ้าว ที่นี่ไม่มีคนชื่อนี้เหรอครับ ขอโทษครับ โทรผิด"
  - Jev P: SCAM 0, LEGIT 0.51, UNSURE 0.49 · signals ≥0.5: none · reason: It was an ordinary wrong number call with no fraudulent behavior or requests for sensitive information.

Service errors during run: none
Total spend of this eval run: $0.0378 ≈ ฿1.32 (143s wall time)
