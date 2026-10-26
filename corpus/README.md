# Corpus — Thai scam-tactic cases (few-shot + eval)

Scripted caller-side calls for the Meta-hackathon build. Everything here is
**synthetic**: all names, numbers (555 range), and organisations are fictional
or generic. Written during the event (Oct 27 – Nov 4, 2026).

## Files

| File | Cases | Use |
|---|---|---|
| `thai-tactics.jsonl` | 120 (57× `v2-port` + 63× `b3-new`) | Few-shot examples + cache memory + dev eval |
| `sealed.jsonl` | 35 (`b3-sealed`) | Held-out eval only (B9 sealed harness + showdown pool) |

Distribution — train: 64 SCAM / 37 LEGIT / 19 UNSURE (112 TH / 8 EN);
sealed: 20 SCAM / 10 LEGIT / 5 UNSURE (all TH).

## Schema (`schema.json`)

```jsonc
{
  "id": "scam-bank-frozen",      // unique across BOTH files
  "class": "SCAM",               // whole-call expert verdict: SCAM | LEGIT | UNSURE
  "lang": "th",                  // th | en
  "category": "bank-security",   // tactic/domain label (see below)
  "expertTurn": 2,               // caller turn (1-based) by which an expert would know
  "why": "…",                    // one-line expert rationale (English)
  "turns": ["…"],                // caller lines only; receptionist filled in by harness
  "tags": [],                    // injection | slow-burn | polite-no-keyword | code-switch |
                                 // money-but-legit | authority-but-legit | negation |
                                 // looks-like-scam-opener | no-otp-word | deepfake-voice
  "source": "v2-port",           // v2-port | b3-new | b3-sealed
  "alsoOk": ["UNSURE"]           // optional: other verdicts that are still safe outcomes
}
```

Conventions:

- `turns` are caller-side only; a line in `(parentheses)` is a harness
  annotation for non-speech audio (silence, line dropped), not spoken words.
- `class` is what a Thai phone-fraud expert concludes from the WHOLE call.
- `expertTurn` measures early-stopping: a good system converges by this turn.

## Sealed rules (enforced by the B9 harness, not by secrecy)

1. Nothing from `sealed.jsonl` (ids, turns, or paraphrases) may appear in
   prompts, few-shot sets, cache seeds, or keyword lists during the build.
2. Sealed cases are disjoint from train by id AND exact turn text
   (verified at merge; re-verify in CI before judging runs).
3. The live showdown adds red-team + judge-picked cases on top of sealed.

## Runtime loading

Workers can't read repo files at runtime; the app bundles a compiled
`fewshot.json` generated from `thai-tactics.jsonl` (see B5). Regenerate it
whenever this corpus changes — never hand-edit the bundle.
