# KRAI-A beta: submission (Meta Global AI Developer Hackathon 2026)

Paste-ready answers for the Cerebral Valley submission form (20 fields, in
form order). Every number here is measured and published on
https://beta.krai-a.com/proof or https://beta.krai-a.com/arena.html.

---

## Form fields, in form order (1–20)

Long answers are kept under about 1,500 characters each.

### 1. Team Name*

KRAI-A

### 2. Team Members

Suansinphut Jairukchan (solo). The form pre-fills the surname from the CV
profile as "Jairukchab"; fix it in the profile before submitting.

### 3. Which track?*

Indie Developer Track

### 4. Which problem statement?*

Build for Your World

### 5. X post link (Most Viral, optional)

{{X_POST_URL}} (pending: paste after the clip is posted)

### 6. Project Description*

They don't pick an age. They pick whoever picks up. On Nov 2, 2026 in Bangkok, a 19-year-old student was told her number was used to promote online gambling, passed to a fake "officer" on a LINE video call, and lost about ฿400,000 (Thairath, Nov 3). Worldwide, 57% of adults met a scam in the past year and 23% lost money (GASA × Feedzai, 2025). Gangs switch numbers, so a blocklist misses the first call from a new number; the script is what gives them away.

KRAI-A picks up instead. It says up front that it is an automated assistant and that the call is recorded. It answers in Thai, English or Mandarin and judges every caller sentence. A scammer gets a polite hang-up or a stalling trap; a real caller leaves a message. Every call ends with a report for the family: who the caller claimed to be, the tactic, and the accounts, LINE IDs and links they gave, in their own words.

Blocklists know numbers. Call screeners hand the decision back to you. KRAI-A judges the script and hangs up itself — and every number behind that is on /proof, misses included: 0/116 real callers judged scam across 4 sealed sets; scams blocked 34/34 (Thai/English), 57/59 (9 languages), and 31/59 on an adversarial stress set, where 24 more were held as a message and 4 slipped through.

Try it (recorded calls, or be the scammer on your mic): https://beta.krai-a.com/demo-live

Built during the hackathon; our pre-hackathon prototype is a frozen baseline, not part of this entry.

### 7. Public GitHub Repository*

https://github.com/ilGentEAcutoO/krai-a-beta

### 8. 3-Minute Demo Video*

{{VIDEO_URL}} (pending: upload as Unlisted and check it opens in a private window)

### 9. Use of Meta products*

Every decision in the product is made by Meta models, called directly through the Meta Model API, plus code.

- Muse Voice Transcribe 1.0: the ear. Realtime transcription through a Cloudflare Durable Object, so the key stays server-side; final text arrives ~1.8 s after speech ends.
- Muse Spark 1.2 (effort minimal): judges every caller sentence as strict JSON (verdict, tactic, 9 risk signals). 2.5 s p50, $0.0081 per call. Code (policy.js) is the only place a verdict becomes an action, and it never closes a non-scam call before turn 4.
- Muse Wonder 1.0: a second opinion on grey-zone sentences only (16 of 267, 6%, on sealed-intl). It also plays adaptive scammers in our AI-vs-AI arena: 504 games, 1 of 185 real callers wrongly hung up, 0/57 on the holdout after fixes.
- Muse Spark 1.3: writes the trap-mode stalling lines and the end-of-call case report.
- Muse Code: wrote the Day-1 build (scaffold, corpus, eval harness, Spark judge, policy, voice relay).

No fine-tuning. Gemini TTS only speaks the lines our server wrote, because the Meta Model API has no text-to-speech; it decides nothing.

### 10. Why are Meta's models important?

One API covers the whole call: realtime speech recognition, a fast judge on every sentence, a deeper second opinion only for the grey zone, and an adaptive scammer to train against. Strict JSON output lets code, not the prompt, own every decision, so the system can be measured honestly.

Measured against our older Google-based prototype on the same real-audio calls (10 calls, TTS voices): scams flagged 6/6 vs 1/6, with 0 wrong hang-ups, and the longest silence in a call went from 4.4 s to ≤0.74 s.

Screeners protect you and let you decide. KRAI-A protects someone you love — the person who decides worst under pressure — and tells you afterwards. That needs a judge good enough to hang up on its own: 0/116 real callers judged scam across 4 sealed sets, each hash-pre-registered and run once. We publish the misses too: on the adversarial stress set, 4 of 59 scams slipped through.

The honest trade-off: Spark judges in 2.5 s per sentence, slower than the old build's 0.27 s, at $8.14 per 1,000 calls. We accept that because Spark reads the script, not keywords. Every number is on https://beta.krai-a.com/proof.

### 11. Partner technologies feedback

We used the Meta Model API directly (Muse Voice Transcribe, Muse Spark, Muse Wonder) and Muse Code, and did not use any partner inference or partner technologies, so we have no partner feedback to give.

### 12–20. Survey

These are the builder's own survey answers, carried over from the draft in
`submit-form.html`; only the facts behind them were updated.

**12. How likely are you to build with the Meta Model API?** Somewhat likely

**13. Overall opinion of the Meta Model API?** Somewhat favorable

**14. How likely to recommend the Meta Model API (0–5)?** 4

**15. How likely to recommend Muse Code (0–5)?** 4

**16. Biggest obstacle?** Getting access or setting up our account; slow
responses. The API answered HTTP 402 (billing not configured) until Nov 1, so
live model tests started five days into the build, and Spark's 2.5 s per
sentence is slow for a live call.

**17. Compared with other models you've used?** Somewhat better. On real
audio it flagged 6 of 6 scams against 1 of 6 for our older stack, but it is
slower and costs more per call.

**18. What matters most when choosing a model?** Quality of the answers and
code; speed; price. A missed scam is a loss, a slow reply lets the scammer
hang up, and the cost per call has to work every day.

**19. Hardest part of switching models?** Our product is tuned to our
current model's behavior and prompts; testing a new model takes too long. The
few-shot set and prompt are tuned to Spark, and every change needs a new train
run and a new pre-registered sealed run.

**20. What would stop production use of Meta's models?** Something else:
latency. Spark takes about 2.5 s per caller sentence (p50), and a grey-zone
sentence that goes to Wonder waits longer; on a live phone call that is the
limit. Price ($8.14 per 1,000 calls to judge) is acceptable.

---

# Reference material

- Measured results, every sealed set side by side: https://beta.krai-a.com/proof
- How it works, models, scope, limits and privacy: [`README.md`](../README.md)
- Every dated measurement and who built what: [`BUILD-LOG.md`](../BUILD-LOG.md)
- Judge walkthrough: [`docs/judge-guide.md`](judge-guide.md)
