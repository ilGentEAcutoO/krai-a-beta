# Wonder escalation + trap mode (B8)

## T3: Muse Wonder for the grey zone

`policy.decideSpark` sends a call to Wonder only when Spark is flat or leans
somewhere the policy cannot accept (`escalate: true`). `POST /api/verdict/escalate`
runs `muse-wonder-1.0` (effort `medium`, strict JSON schema) with a deeper
Thai-fraud prompt and returns verdict, tactic, signals, reasons and
`evidence` (caller quotes; any quote not found verbatim in a caller line is
dropped).

Code owns the consequence, not Wonder:

- `policy.guardEscalation` runs on the max of Spark's and Wonder's signals,
  so Wonder can never clear a call Spark saw asking for money, a code, an
  app, secrecy, identity details, or talking to the AI.
- `policy.escalationConfidence` sets the confidence (Wonder is uncalibrated).
- A guarded answer shows code-written reasons (`templateReasons`).
- Any failure (402, timeout, bad JSON) keeps Spark's decision (`wonder-fallback`).
- A call that was not escalated never pays for Wonder (`skipped: not-escalated`).

## Trap mode: กับดัก 10 นาที

Every call opens with a canned disclosure, spoken and shown in the
transcript (`DISCLOSURE_LINE_TH` in `app/src/trap.js`):

> ระบบผู้ช่วยรับสายอัตโนมัติรับสายแทนเจ้าของเบอร์ สายนี้มีการบันทึก ขอทราบชื่อและธุระค่ะ
> (An automated answering assistant is taking this call for the owner. This
> call is recorded. May I have your name and the reason for your call?)

Once a call is SCAM the page offers **เปิดกับดัก / Start trap**. Instead of
hanging up, the receptionist **plays for time**: it stays the automated
assistant, slow and polite, and keeps asking the caller to repeat, spell out
and explain. It never claims to be a real person, the owner or a relative
(prompt rule plus the `human-claim` code guard). Every minute a scammer spends
here is a minute not spent on a real victim, and what the scammer volunteers
goes into the case report at the end of the call (below).

`POST /api/trap/reply` per caller final:

1. **Reply** (`muse-spark-1.3`, effort `low`): one short Thai stalling line.
   Spark, not Wonder: the task is shallow, Spark is several times cheaper per
   token and faster on a live line. Safety comes from code: every line must
   pass `policy.guardReply` (no agreeing to pay, no codes, no digit runs in
   ASCII, Thai or spelled-out words, no owner facts, no self-name, no
   line-problem claims; a refusal is stripped only as the negated verb phrase,
   so "ไม่ให้หรอก โอนเงินให้แล้ว" is still caught) plus the stricter trap guard:
   no digit at all, no 3+ number words, no money verb outside a refusal, no
   trap / scam / police-report words, and no claim to be a person, the owner
   or a relative (`คนจริง`, `ไม่ใช่บอท`, `เป็นเจ้าของ…`, `ลูกหลาน`, …). A blocked line becomes a rotating
   canned stalling line (all canned lines are tested against the guard).
2. **Caps, server-enforced and stateless**: the first reply returns a
   `trapToken` = HMAC-SHA256(SESSION_SECRET) over {server start time, reply
   count}. Every later call sends the latest token; the server verifies it,
   reads elapsed time and count from it, and re-signs with count + 1. At 10
   minutes or 20 replies the answer is the canned closing line with
   `done: true` and no model spend. No token = a new trap (rate limits bound
   that); a bad or future-dated token = 400. Replaying an old token cannot
   move the signed start time.
3. **Intel**: regex pass (bank accounts, phones, LINE ids, URLs, amounts,
   banks; Thai digits and spoken digit words normalised) over **caller lines
   only**, merged with a Spark JSON-schema extraction whose items must quote a
   caller line (digit values must appear in that line). Client-sent intel is
   re-verified the same way. Each item keeps its caller quote.

The page speaks the reply in the receptionist's one AI voice (Gemini
`gemini-3.8-flash-tts`, voice Sulafat) through `POST /api/tts`, which speaks
only a line our own server signed for that caller; canned lines are
pre-recorded static files. Gemini is used only to speak, because the Meta
Model API has no text-to-speech. If the AI voice fails or is capped, the
browser's `speechSynthesis` takes over and a caption always shows the line. While it speaks,
the mic sends silence instead of audio (Meta closes a realtime session whose
audio falls behind real time, and our own voice must never be transcribed as
the caller), so caller words spoken over the receptionist are lost in the
browser demo. Outside trap mode the receptionist still answers every caller
turn, asking only for what the caller has not given yet; code picks each
guarded canned line from Spark's fields (`app/src/receptionist.js`), so the
call has no dead air.

## Case report at call end (G8)

When the call ends (hang-up or trap done) the page posts the transcript to
`POST /api/report` (`app/src/report.js`). One Muse Spark call (strict JSON
schema, effort `low`, no output-token cap because Spark reasons before it
answers) returns who the caller claimed to be, the tactic, intel, verdict and
confidence. Code decides what is shown:

- the claimed identity and every intel item need a quote that appears
  verbatim in a **caller** line, or they are dropped; the regex intel pass
  always runs, so a model failure still gives a report;
- LEGIT becomes UNSURE if the caller made a sensitive demand
  (`policy.t1Demand`) or gave a bank account; a LEGIT report lists no intel;
- the headline and the Thai next steps (call the bank's official number,
  report online at https://thaipoliceonline.go.th) are written by code.

`app/public/report-card.js` renders it with **copy** and **Web Share**, so the
family gets a case report they can share. Nothing is sent to anyone
automatically.

## Route contracts

```text
POST /api/verdict/escalate   protect('wonder')
  body  { lines:[{speaker:'caller'|'receptionist', text}], spark:{verdict,confidence,tactic,signals}, turnCount? }
  200   { ok, wonder:{verdict,wonderVerdict,confidence,tactic,signals,evidence[],reasonTh,reasonEn,guarded,engine,usage,costUsd},
          policy:{verdict,confidence,escalate,rule:'wonder'|'wonder-guard'|'wonder-fallback'}, action, costUsd, latencyMs }
        { ok, skipped:'not-escalated', wonder:null, policy, action, costUsd:0 }   (Spark already decided)
  400 empty-turn · 413 too-large · 500 missing-key

POST /api/trap/reply         protect('trap')
  body  { lines:[...], intel?:[{type,value,quote}], trapToken?:<from the previous reply> }
  200   { ok, reply, guarded, guardReasons[], source:'model'|'canned'|'closing', intel:[{type,value,quote,source}],
          done, trapToken, turnNo, elapsedMs, limits:{maxMs,maxTurns}, callerTurns, costUsd, latencyMs }
  400 empty-turn | bad-trap-token · 413 too-large · 500 missing-key · 503 misconfigured (no SESSION_SECRET)
```

POST /api/report             protect('report')
  body  { lines:[...], intel?:[...], endedBy?:'hangup'|'trap-done', verdict?:<last live verdict, used only if Spark fails> }
  200   { ok, source:'model'|'fallback', report:{verdict,confidence,verdictSource,verdictGuarded,verdictTh,claimedIdentity,
          tactic,tacticTh,intel[],headlineTh,nextSteps:[{id,th,url?}],endedBy,callerTurns,generatedAt}, costUsd, latencyMs }
  400 empty-call | bad-json · 413 too-large (60 lines / 16k chars)

Input caps on the escalate and trap routes: last 40 lines, 2000 chars per line, 12k chars
total after trimming (else 413).

Both routes call `c.get('settle')(usd)` when the context provides it, with the
real cost from `COST_PER_M` in `app/src/wonder.js` (Wonder $4 / $20 / cached
$0.20 per 1M; Spark $1.25 / $4.25 / $0.15).

Mount: `registerWonderRoutes(app, { protect, getKey })` from `app/src/routes-wonder.js`.
