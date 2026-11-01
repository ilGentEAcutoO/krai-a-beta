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

Once a call is SCAM the page offers **เปิดกับดัก / Start trap**. Instead of
hanging up, the receptionist plays a slow, confused elderly helper. Every
minute a scammer spends here is a minute not spent on a real victim, and what
the scammer volunteers becomes intel for the family or the bank report.

`POST /api/trap/reply` per caller final:

1. **Reply** (`muse-spark-1.3`, effort `low`): one short Thai stalling line.
   Spark, not Wonder: the task is shallow, Spark is several times cheaper per
   token and faster on a live line. Safety comes from code: every line must
   pass `policy.guardReply` (no agreeing to pay, no codes, no digit runs in
   ASCII, Thai or spelled-out words, no owner facts, no self-name, no
   line-problem claims; a refusal is stripped only as the negated verb phrase,
   so "ไม่ให้หรอก โอนเงินให้แล้ว" is still caught) plus the stricter trap guard:
   no digit at all, no 3+ number words, no money verb outside a refusal, and
   no AI / trap / scam / recording words. A blocked line becomes a rotating
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

The page speaks the reply with browser `speechSynthesis` (th-TH, rate 0.85)
and drops mic frames while it speaks, so its own voice is never judged as the
caller.

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

Input caps on both routes: last 40 lines, 2000 chars per line, 12k chars
total after trimming (else 413).

Both routes call `c.get('settle')(usd)` when the context provides it, with the
real cost from `COST_PER_M` in `app/src/wonder.js` (Wonder $4 / $20 / cached
$0.20 per 1M; Spark $1.25 / $4.25 / $0.15).

Mount: `registerWonderRoutes(app, { protect, getKey })` from `app/src/routes-wonder.js`.
