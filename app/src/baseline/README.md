# Baseline — frozen v2 judge (the ruler, not the entry)

Verbatim copies (2026-10-27) of the Krai-A v2 (Google-Cloud) judge modules,
used ONLY to measure the baseline that the Meta entry must beat:

- `jev.js` — Jev verdict Choice + 9 signal Nouls (question text unchanged)
- `policy.js` — thresholds, `decide`, `nextAction`, template reasons
- `rules.js` — hard-rule demands + keyword fallback
- `gemini.js` — Gemini escalation + reasons (only the escalation path is used)

Do NOT edit these files to improve scores — any change here moves the ruler.
`judge.js` (new, thin) wires them into `judgeTurn` + canned persona lines for
the eval harness. The Meta path (Spark/Wonder/Voice) lives in `app/src/`
outside this folder and shares no code with it.
