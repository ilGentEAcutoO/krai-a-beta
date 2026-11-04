# Demo video storyboard (3:00)

Rules for this video:

- **Real UI only.** Every shot is a screen recording of the live app
  (https://beta.krai-a.com), the repo, a terminal, or `docs/architecture.svg`.
  No mockups, no recreated screens. Overlays are captions and highlight boxes
  on top of real footage, nothing more.
- **New work only.** Nothing from the Google-Cloud alpha (demo.krai-a.com)
  appears on screen except as the labelled "Baseline · Jev" column on
  /proof and /showdown.
- **Live model output is recorded live**, not staged. If a take gives a
  different verdict, keep the honest take or re-record; never edit the chip.
- Voiceover (VO) is English. Thai speech from the "caller" stays in Thai with
  English subtitles; Thai UI text gets an English caption where needed.

Legend: **NOW** = can be recorded today (no model spend). **LIVE** = needs Meta
credits and live model output; record after credits are confirmed and the
daily cap is raised for the session.

Rubric: Impact 30% · Use of Meta AI tooling 25% · Technical depth 20% · Demo 25%.

---

| # | Time | On screen (real UI) | Voiceover (EN) / captions | Record | Rubric |
|---|---|---|---|---|---|
| 1 | 0:00–0:15 | /demo-live. Replay the sample **"ตำรวจปลอม: หมายจับคดีฟอกเงิน"** (fake police). Caller lines appear one by one. Hold on the third line ("โอนเงินทั้งหมดในบัญชีมาให้ตรวจสอบ…"). | VO: "This is how Thai parents lose their savings: a 'police officer' says there's a warrant, demands secrecy, then asks for every baht 'for checking'." Caption (EN subtitle of the Thai line): "Transfer all the money in your account to our office for checking." | LIVE (verdict chips need Spark) | Impact |
| 2 | 0:15–0:27 | Same take, verdict chip turns **Block** (SCAM) with "· 98% · … → hangup". Caption overlay with the cited figure and source. | VO: "In eight months of 2026, Thais reported over eleven billion baht lost to online fraud, and people over sixty lost more than a quarter of it." Caption: "฿11,039M reported lost, Jan–Aug 2026 · age 60+: 28.55% of losses · Source: Thai online-fraud reports, via Thairath, 2 Sep 2026". | LIVE (same take as 1) | Impact |
| 3 | 0:27–0:42 | beta.krai-a.com home, then `docs/architecture.svg` full screen; highlight boxes move along the per-turn band: Voice → T1 → Spark → policy → Wonder → trap. | VO: "KRAI-A answers the call instead. Muse Voice Transcribe hears Thai in real time. Muse Spark judges every sentence. Code, not the model, decides what happens. Muse Wonder takes the grey zone." | NOW | Use of Meta AI tooling, Technical depth |
| 4 | 0:42–1:12 | /demo-live, presenter clicks **🎙 เริ่มฟัง** and speaks a scam line into the mic (Thai, own words, e.g. "สวัสดีครับ ผมโทรจากธนาคาร บัญชีคุณถูกระงับ ต้องย้ายเงินไปบัญชีปลอดภัยด่วนครับ"). Show the dashed listening band growing, amber partials replacing each other, the final pinned, then the verdict chip. | VO: "This is live. My voice goes from the browser to a Durable Object, which holds the Meta key and streams to Muse Voice Transcribe. Partials arrive while I speak; about two seconds after I stop, the final text is judged." Caption: Thai line + EN subtitle "Your account is frozen; move your money to a safe account now." | LIVE | Demo, Use of Meta AI tooling |
| 5 | 1:12–1:27 | /demo-live, replay **"สายจริง: โรงพยาบาลยืนยันนัด"** (hospital). Chip: **Allow** (LEGIT) with "· 95% · …". | VO: "A real hospital call goes through. A blocker that hangs up on the hospital is useless, so false alarms count as much as catches." | LIVE | Impact, Demo |
| 6 | 1:27–1:52 | /demo-live, replay **"ก้ำกึ่ง: สำนักงานกฎหมายทวงหนี้บัตร"** (debt collector). Chip shows escalate → Wonder card: verdict, evidence quotes from the caller, rule `wonder` or `wonder-guard`. | VO: "When Spark isn't sure, Muse Wonder gives a second opinion and must quote the caller word for word. Wonder can raise suspicion, but code won't let it clear a call that asked for money or codes." | LIVE | Use of Meta AI tooling, Technical depth |
| 7 | 1:52–2:20 | Back to a SCAM call (live or the fake-police replay). Click **🪤 เปิดกับดัก / Start trap**. Timer counts **mm:ss / 10:00**; the receptionist speaks a slow Thai stalling line (Gemini TTS voice; Meta has no TTS); presenter as scammer gives a fake account number; it appears in the intel list with the caller quote. | VO: "Or we keep them busy. Trap mode plays for time: the assistant, which said at the start that it is automated, asks them to slow down, repeat and spell it out. Every line Spark writes passes a code guard: no digits, no money, no codes, never claiming to be a person. Ten minutes a scammer spends here is ten minutes not spent on a real victim, and the account he gives us goes into the case report." Caption: EN subtitle of the stalling line. | LIVE | Impact, Demo |
| 8 | 2:20–2:38 | /proof: "สามตัวเลขที่สำคัญที่สุด", train tab then **sealed (held-out)** tab; Jev baseline beside Meta. Then /showdown confusion matrix. | VO: "Every number is measured. On 60 held-out calls, pre-registered before tuning and run once on the shipped build, KRAI-A caught 34 of 34 scams and judged none of 26 real callers a scam, at under a cent per call." Show the **Sealed v2** tab (default). | NOW for baseline shots; LIVE after sealed runs land on /proof | Technical depth, Impact |
| 9 | 2:38–2:52 | Terminal: `git log --oneline` (all commits from Oct 27), then `npm test` ending in **pass 251, fail 0** (count on Nov 4; re-check on the day). Quick cut to `/api/health` JSON showing `paused` and `budget`. | VO: "All of it was built during the hackathon: voice relay, policy, trap mode, a spend cap and kill switch, and 251 tests." | NOW | Technical depth |
| 10 | 2:52–3:00 | beta.krai-a.com home with the repo URL visible. | VO: "KRAI-A. Try to scam it yourself at beta.krai-a.com." Caption: "beta.krai-a.com · github.com/ilGentEAcutoO/krai-a-beta". | NOW | Demo |

Total: 3:00. Rubric coverage: Impact (1, 2, 5, 7, 8), Meta tooling (3, 4, 6),
Technical depth (3, 6, 8, 9), Demo (4, 5, 7, 10).

## Recording checklist

**Record now (no credits needed):** scenes 3, 9, 10, and the baseline-only
shots of /proof and /showdown for scene 8.

**Record after credits (LIVE):** scenes 1–2, 4, 5, 6, 7, and the sealed tab of
/proof for scene 8.

Before LIVE takes:

1. Confirm `/api/health` shows `paused: false` and enough room under the
   daily cap for about 10 takes (voice + Spark + Wonder + one trap session).
2. Re-read scene 8 against /proof on the day; never quote from memory.
3. Use a quiet room and a headset for scene 4; trap mode mutes the mic while
   the browser speaks, so the receptionist voice is never judged as the caller.
4. Keep the Thai lines short (one sentence each) so subtitles fit.

Scene 8 numbers are filled from sealed v2 on /proof (B28 `8d58388`, Nov 4).
