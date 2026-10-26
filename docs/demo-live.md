# KRAI-A realtime Thai-voice demo (B4)

> The voice leg of the demo. The text leg is `showdown.html` (recorded runs;
> live mode opens with B5). Both converge on one verdict pipeline:
> `POST /api/verdict/turn` → Spark few-shot → `policy.js` → call action.

## Wire-up

```
mic (48 kHz float)
  → AudioWorklet resample → PCM S16 mono 24 kHz (exact; WS frame = binary)
  → wss://<us>/api/voice/live?call=<id>     (no key in the browser, ever)
  → VoiceCall DO (app/src/voice-do.js, Hibernation API)
      → wss://api.meta.ai/v1/asr/realtime     (VOICE_WS, key in handshake)
          1. DO sends buildHandshake() JSON FIRST (bearer + ENDPOINTING + bias)
          2. Meta replies { sessionId }                     (ready)
          3. DO relays binary PCM frames up, normalized events down
          4. speechStart / transcript(partial|final) /
             speechEnd / speechComplete / speaker / error
          5. createRelay() feeds the authoritative TurnAssembler (turnId keys)
          6. finals persist to DO storage; client judges via /api/verdict/turn
```

## Rules this page lives by (break one = revert the commit)

1. **No Opus on the Meta hop.** `VOICE_WS` is a raw-PCM socket
   (`audioEncoding: 'PCM_24KHZ'` is not negotiable in the beta). Opus would
   only exist to shrink bytes on a hop we control — there is none here.
2. **Auth is a handshake frame, not a header** (Meta ignores WS headers).
   The frame is sent by the DO. The browser never holds the key — repo rule,
   README §"Rules we build by". `window.META_VOICE_KEY` must never exist.
3. **turnId is the only clock.** Partials for t1 keep arriving while t2
   starts; bands key on `turnId`, never on arrival order. Partials carry no
   turnId — they belong to the most recent `speechStart`.
4. **ENDPOINTING is the live mode.** `PUSH_TO_TALK` exists for the file
   endpoint; `DIARIZATION` labels pass through but both speakers share one
   turn-band (policy judges caller speech).
5. **Hibernation, not `accept()`.** Idle calls must cost no DO duration
   (spike 41 §2). After eviction the relay re-opens Meta transparently
   (`relay.stats.resumed` counts it) and the client replays via
   `{ type:'get-turns' }`.

## What the page shows — and why

| Band | Source event | Render |
|---|---|---|
| Listening (dashed, live width) | `speechStart` → `audioProcessedMs` on partials | width ∝ processed audio, caps at 100% |
| Partials (amber border, replaced) | `partial` per turn | latest text wins, keyed by `turnId` |
| Final (pinned + verdict row) | `final` / `speechComplete` | appended; judged by `/api/verdict/turn` |
| Verdict chip | policy verdict | Allow (LEGIT) / Escalate (UNSURE) / Block (SCAM) + tactic, confidence, rule, action |
| Error (red toast, auto-clear 6 s) | `error` / socket close / 402 billing | human sentence, never the raw code alone |

## Failure modes (all tested server-side, all degrade honestly)

- Relay unreachable / Meta WS down → toast + mic stops; judged turns stay.
- 402 / `billing_not_configured` on file fallback → same honest error the
  API returns; the demo is read-only until credits land (B2).
- Empty mic / permission denied → inline hint on the mic button, not an alert.
- `speechComplete` with no transcript → `(silence)` so the band count stays honest.
- DO evicted mid-call → transparent Meta resume; client keeps pinned finals.

## Sealed discipline

Nothing spoken or uploaded on this page is logged to the corpus, train or
sealed. Turn text lives in DO memory (+ per-call storage for the debug view),
verdicts in page memory, and closing the call wipes the page side. The debug
view (`GET /api/voice/live?call=<id>`, no upgrade) exposes only that call's
turns — no audio, no key.
