# KRAI-A live call demo (`/demo-live`)

## The page today (Nov 4, voice-first)

- **The hero is a call console.** It shows caller and KRAI-A tiles with live
  level rings, a waveform drawn from the real audio, live captions, a
  scam-risk needle and one chip per judged sentence with its measured Spark
  latency (T1 and Wonder chips too). A models strip shows Muse Voice
  Transcribe → T1 code rules → Muse Spark 1.2 → Muse Wonder, and a hang-up
  card closes the call.
- **Recorded calls tab:** six calls.
  - Scam: English fake bank with a prompt injection, Thai fake bank asking
    for the OTP, Mandarin fake police with a "safe account", and a
    Vietnamese fake bank (a probe language).
  - Legit: an English courier and a Thai hospital.
  - The audio is synthetic voices. The verdicts, replies and timings are
    played back from one real run of this pipeline (`demo-calls.json`),
    unedited.
  - Filter chips: All / EN / TH / 中文 / VI.
- **Live: be the scammer tab:** the realtime mic flow below, plus typing,
  text samples and the 10-minute trap.
- **Report language follows the call.**
  - English and Vietnamese calls get an English, region-neutral report:
    local police, the national anti-scam authority and the bank's official
    number.
  - Mandarin calls get a Chinese report.
  - Thai calls on the Thai page get the Thai report. Both a scam and an
    unsure Thai report name the Thai police website (thaipoliceonline.go.th)
    and the 1441 (anti-online-scam centre, 24 h) and 1213 (Bank of Thailand)
    hotlines, all fixed in code (`report.js`).
- **The English page shows no Thai.** Thai calls get English captions marked
  "translated from Thai".

## The realtime voice leg (B4)

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

## No microphone: type instead / replay a sample call

For judges without a mic and for a repeatable demo-video run, the page has a
second card under the mic button:

- **พิมพ์แทนพูด / Type instead** — the visitor plays the *caller*. Enter feeds
  the line to `onEvent()` as `speech-start` + `final`, i.e. the exact events the
  relay sends. Everything after that is the voice path, unforked: pinned band →
  `/api/verdict/turn` on the whole call (`recentLines()`) → Wonder escalation
  for grey verdicts → trap offer; with the trap on, the reply comes from
  `/api/trap/reply` and is spoken by browser TTS.
- **เล่นสายตัวอย่าง / Replay a sample call** — a picker over
  `app/public/samples.json`. Each line appears as growing `partial` events for
  ~1.5 s + length, then the same `final`; the next line waits for the verdict
  (and Wonder / trap reply + TTS) to finish. Starting a replay resets the page's
  call (transcript, trap, intel). **■ Stop** cancels between steps.
- `samples.json` is generated, not hand-edited:
  `node scripts/build-samples.mjs`. Ids are listed explicitly in the script
  (fake police, bank security, injection EN, Thai/English code-switch, slow
  burn, legit hospital, grey debt collector) and come from
  `corpus/thai-tactics.jsonl` only. The script reads `sealed.jsonl` solely to
  throw on a sealed id or a repeated sealed caller line;
  `app/test/samples.test.mjs` checks the committed file equals the build.

### Paused / budget / rate-limited

A 503 (`paused`, `budget`, `misconfigured`) or 429 from any model route shows
the server's `messageTh` + `messageEn` inline in `#apiNotice` (with the
`retryAfter` seconds for 429), and a running replay stops cleanly. The turn
row says why it was not judged. No `alert` / `confirm` / `prompt` anywhere —
`pages.test.mjs` fails the build if one appears in `app/public`.

### Local check without spending anything

Serve `app/public` with any static server that answers `/api/*` with canned
JSON (or intercept `/api/*` with Playwright `page.route`). Never point the page
at the production model routes or a `wrangler dev` holding real keys.

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
