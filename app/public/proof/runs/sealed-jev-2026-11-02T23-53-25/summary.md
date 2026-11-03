# Krai-a beta eval (jev-baseline)

Run 2026-11-02T23:53:26.505Z · corpus/sealed.jsonl · 35 calls / 69 judged turns · 35 Thai, 0 English
Classes: SCAM 20 · LEGIT 10 · UNSURE 5 · engines: Jev jev-latest · Gemini gemini-3.5-flash-lite (escalation)

**Headline:** SCAM recall 100% (20/20 scam calls, 95% CI 83.9%–100%), 0 of 10 legit calls flagged as scam, median 0.26 s per turn (p90 1.3 s), ~฿0.01 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 100% (20/20; 95% CI 83.9%–100%) |
| SCAM precision (all calls) | 100% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 0 |
| LEGIT false scam alarm | 0% (0/10; 95% CI 0%–27.8%) |
| LEGIT left UNSURE (message taken) | 0% |
| UNSURE kept UNSURE | 100% · to SCAM 0 · to LEGIT 0 |
| accuracy (exact class) | 100% |
| safe outcome (class or listed safe alternative) | 100% |
| median turns to correct verdict | all 2 · SCAM 2 · LEGIT 1 |
| SCAM caught by the expert's turn | 100% (median lag 0 turns) |
| scam calls hung up by policy | 100% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 20 | 0 | 0 |
| **LEGIT** | 0 | 10 | 0 |
| **UNSURE** | 0 | 0 | 5 |

Adversarial subsets (correct / safe / n):

- deepfake-voice: 1 / 1 / 1
- negation: 1 / 1 / 1

## Latency (judge, per caller turn)

All turns: median 0.26 s, p90 1.3 s, p95 1.4 s

| path | share of turns | median | p90 |
|---|---|---|---|
| jev | 75.4% (52) | 0.25 s | 0.29 s |
| jev>gemini | 24.6% (17) | 1.3 s | 1.5 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.000271 ≈ ฿0.0095 per call (1.9714 turns/call, Jev 1295 input tokens/turn, 17 Gemini escalations in 69 turns)
- **Total judge cost ≈ $0.00027 ≈ ฿0.010 per call** (฿10 per 1,000 calls). Judge only (Jev + Gemini escalation). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

None.

Service errors during run: none
Total spend of this eval run: $0.0095 ≈ ฿0.33 (35s wall time)
