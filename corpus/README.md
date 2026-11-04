# Corpus — Thai scam-tactic cases (few-shot + eval)

Scripted caller-side calls for the Meta-hackathon build. Everything here is
**synthetic**: all names, numbers (555 range), and organisations are fictional
or generic. Written during the event (Oct 27 – Nov 4, 2026).

## Files

| File | Cases | Use |
|---|---|---|
| `thai-tactics.jsonl` | 150 (57× `v2-port` + 63× `b3-new` + 5× `b27-defense` + 8× `b28-intl` + 13× `b29-final` + 4× `claude-cov-train`) | Few-shot examples (v2-port + b3-new only) + cache memory + dev eval |
| `sealed.jsonl` | 35 (`b3-sealed`) | Held-out eval only (B9 sealed harness + showdown pool) |

Distribution — train: 80 SCAM / 44 LEGIT / 26 UNSURE (122 TH / 19 EN / 9 ZH); the 4 `claude-cov-train` cases (Nov 4, written by Claude claude-opus-5-5 for the train-only coverage set, shape/adversarial/realism kept in `tags`) are a pushy real bank fraud desk and three slow-burn Mandarin scams that open warm (the owner "on a friend's phone", a dating-app friend, a hospital nurse) and ask late;
the 5 `b27-defense` cases (Nov 3) are the LINE/video channel-switch scams and
genuine "check it yourself, nothing to pay" prize notices; the 8 `b28-intl` cases (Nov 3) cover utility cut-off, recovery and document scares and pranks; the 13 `b29-final` cases (Nov 4, train only) add bank "fraud team" calls that refuse a message (TH/EN/ZH) with real card-security desks that accept one, cold invitations to private trading groups, a Mandarin police witness request, prankster and rude loan collector, an English wrong number, an embassy appointment and an insurance telemarketer;
sealed: 20 SCAM / 10 LEGIT / 5 UNSURE (all TH).

## Schema (`schema.json`)

```jsonc
{
  "id": "scam-bank-frozen",      // unique across BOTH files
  "class": "SCAM",               // whole-call expert verdict: SCAM | LEGIT | UNSURE
  "lang": "th",                  // th | en | zh
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
