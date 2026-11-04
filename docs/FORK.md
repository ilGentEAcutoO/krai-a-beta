# Fork KRAI-A

When you deploy KRAI-A to your own Cloudflare account, the whole judging side
runs right away. You can try it in a browser the same day, and family-chat
reports are one setting away. The only piece you write yourself is the bridge
from your phone line to KRAI-A. That piece depends on which phone provider
you already use, so it can't ship ready-made. The contract it has to follow is
small, and it's written out below.

![Three boxes, left to right. 1, your phone line to KRAI-A, dashed: you connect this. 2, KRAI-A on your Cloudflare, works the moment you deploy: Voice Transcribe, Spark, Wonder, a fixed rule in code acts on Spark's verdict, case report. 3, reports to your family's chat, built in and opt-in: Telegram, LINE, WhatsApp. Below, four steps: fork and deploy, try it in your browser, turn on family reports, connect your phone line (not built yet).](../app/public/fork-path.svg)

(Narrow screens: [`fork-path-mobile.svg`](../app/public/fork-path-mobile.svg).)

| | What | Status |
|---|---|---|
| ① | **Your phone line → KRAI-A.** Set call forwarding on your number to send calls to your phone provider (any SIP or programmable-voice provider). The provider then streams the call audio to KRAI-A's voice socket. | **You connect this.** It's a small bridge for the provider you already use. We haven't built or tested one yet. |
| ② | **KRAI-A on your Cloudflare.** Voice Transcribe turns speech into text live → Spark judges every sentence → Wonder takes the grey zone → a fixed rule in code acts on Spark's verdict (hang up · take a message · stall) → case report. | **Works the moment you deploy.** |
| ③ | **Reports to your family's chat:** Telegram, LINE or WhatsApp. | **Built in, opt-in.** Contract-tested, not live-verified. |

## 1. Fork and deploy

You need a Cloudflare account (Workers with Durable Objects) and a Meta Model
API key.

1. In `app/wrangler.jsonc`, change three things to match your account:
   `account_id` (it is pinned to ours), `routes` (your own hostname, or remove
   it to use `*.workers.dev`), and `APP_URL`.
2. Run it locally:

   ```bash
   cd app
   cp .dev.vars.example .dev.vars   # fill META_MODEL_API_KEY and SESSION_SECRET (gitignored)
   npm install
   npm run dev                      # http://localhost:8787
   ```

3. Deploy:

   ```bash
   cd app
   npx wrangler secret put META_MODEL_API_KEY   # production key, never in the repo
   npx wrangler secret put SESSION_SECRET       # openssl rand -hex 32
   npx wrangler secret put TURNSTILE_SECRET     # see "Bot check" below
   npm run deploy
   ```

   Check it at `https://<your-host>/api/health`.

### Settings the app reads

Secrets go in with `npx wrangler secret put <NAME>`. Public values go in the
`vars` block of `app/wrangler.jsonc`. For local runs, both go in `app/.dev.vars`.

**Required**

| Name | Kind | What happens without it |
|---|---|---|
| `META_MODEL_API_KEY` | secret | Model routes answer 500 `missing-key`, and the voice socket refuses to open. |
| `SESSION_SECRET` | secret | Signs the 30-minute session tokens and salts the IP hash. Without it, model routes answer 503 `misconfigured`. |
| `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY` + `TURNSTILE_HOSTNAMES` | secret + vars | The bot check that runs before a session is issued. Without the secret, a public (https) deploy refuses to issue sessions unless you set `TURNSTILE_OPTIONAL=1`. Treat that switch as a deliberate, temporary choice. |

**Optional**

| Name | Kind | Effect |
|---|---|---|
| `GEMINI_API_KEY` | secret | The receptionist's voice for live trap lines (`/api/tts`). Without it, `/api/tts` answers 503 `tts-off` and the page uses the browser's own voice. |
| `NOTIFY_ENABLED`, `TELEGRAM_*`, `LINE_*`, `WHATSAPP_*`, `NOTIFY_VERDICTS`, `NOTIFY_MAX_PER_HOUR` | secrets | Family-chat delivery. Nothing is sent unless `NOTIFY_ENABLED=1` and that channel's values are set. See [`ADAPTERS.md`](ADAPTERS.md). |
| `APP_NAME`, `APP_URL` | vars | Name and public URL. |

### Cost guards you inherit

Every model route goes through the same guard (`app/src/abuse.js`,
`app/src/budget.js`). The order is: kill switch → session token → per-IP rate
limit → body-size cap → budget reservation.

| Guard | Where | Default |
|---|---|---|
| `KILL_SWITCH` | secret; `1` or `true` | Every model route answers 503 `paused`, and live voice sockets already open are closed too. You can flip it without a deploy. |
| `DAILY_USD_CAP` | var | Meta spend per UTC day. The `Budget` Durable Object refuses any call whose worst case would cross the cap. The code default is 5. |
| `TOTAL_USD_CAP` + `TOTAL_SINCE` | vars | Cumulative Meta cap counted from `TOTAL_SINCE` (a UTC day). At the cap, every Meta route answers 503 `budget-total`. If you leave `TOTAL_SINCE` empty, there is no cumulative cap. |
| `TTS_DAILY_USD_CAP`, `TTS_TOTAL_USD_CAP` | vars | Gemini TTS has its own ledger. The code defaults are 1 per day and 3 in total. |
| Per-IP limits | code (`LIMITS` in `abuse.js`) | For example, a live voice call has at most 3 at once and 8 a day per IP, and is cut off at 600 s (close code `4008`). |

The Meta API itself has no hard cap, so also set a spend alert in the Meta
console.

## 2. Try it in your browser now

Open `https://<your-host>/demo-live`. You can talk into your mic, or play a
recorded call. Each sentence is transcribed, judged and acted on, and a case
report comes at the end. This page runs exactly the loop a phone bridge would
need to run (see section 4).

## 3. Turn on family reports (about 5 minutes)

Follow [`ADAPTERS.md`](ADAPTERS.md) to set `NOTIFY_ENABLED=1` and one
channel's secrets. Then send yourself a sample:

```bash
cd app
npm run notify:test -- --channel telegram   # or line | whatsapp | all, add --dry-run to preview
```

Links from the caller are defanged, and every message says it comes from an AI
assistant. The adapters are contract-tested against the documented APIs but
have not been live-verified.

## 4. Connect a real phone line

> **Not built or tested by us yet.** This section is a spec for the bridge,
> taken from the code that is already running (`app/src/voice-do.js`,
> `app/src/voice.js`, `app/src/index.js`). It is our next step, and it is
> what a fork writes for its own provider.

The bridge sits between your phone provider's call-audio stream and KRAI-A.
Phone networks usually carry 8 kHz audio. Many programmable-voice providers
can stream a live call to a WebSocket you own. The bridge does four jobs:

1. **Get a session token.** Send `POST /api/session` with body
   `{ "turnstileToken": "..." }`. The answer is
   `{ ok, token, expiresAt, turnstile }`. The token lasts 30 minutes and is
   bound to the caller's IP (hashed). This flow was built for browsers. A
   server-side bridge can't solve a Turnstile check, so on your own
   deployment you have to choose how the bridge gets its token, for example
   by giving it its own authentication. That choice is not built yet. In
   no-Turnstile mode, `/api/session` issues a token without a check, and the
   rate limits and budget still apply.
2. **Stream the audio in.** Open
   `wss://<your-host>/api/voice/live?call=<id>&s=<token>`. The call id must
   match `[A-Za-z0-9-]{1,64}`, and each id gets its own `VoiceCall` Durable
   Object.
   - **Send** binary frames of raw PCM: signed 16-bit little-endian, mono,
     **24 kHz** (`PCM_24KHZ`). The browser sends 100 ms frames (2,400 samples,
     4,800 bytes). Phone audio, such as 8 kHz μ-law, has to be decoded and
     resampled to 24 kHz first.
   - **Keep pace with real time.** The upstream transcriber closes a session
     whose audio falls behind real time. While your side is speaking, send
     silence. Never pause the stream.
   - Audio sent before the `ready` event is dropped.
   - The only text frame the socket accepts is `{"type":"get-turns"}`. It
     answers with `{"type":"turns","texts":[...]}`.
3. **Read the transcript events.** These come back as JSON text frames:

   | `type` | Fields | Meaning |
   |---|---|---|
   | `ready` | `sessionId` | Transcription is live. Audio counts from now on. |
   | `speech-start` | `turnId` | The caller started a sentence. |
   | `partial` | `turnId`, `transcript`, `audioProcessedMs` | Interim text. |
   | `final` | `turnId`, `transcript`, `audioProcessedMs` | Final text for that turn. |
   | `speech-end` / `speech-complete` | `turnId` (+ `transcript`) | End of the turn. `speech-complete` carries the cleaned-up text. |
   | `speaker` | `turnId`, `label` | Speaker label, when available. |
   | `error` | `message` | For example `max-duration`, `paused`, or a reconnect notice. |

   The socket closes with code `4008` at the 600 s limit and `4009` when the
   kill switch is on.
4. **Judge, act, report.** The socket only transcribes. The judging runs over
   HTTP with the header `x-krai-session: <token>`:
   - On each final sentence, send `POST /api/verdict/turn` with
     `{ "turnId", "turnCount", "lines": [{ "speaker": "caller" | "receptionist", "text" }] }`.
     Send the whole call so far, not just the last line. The answer includes
     `policy.verdict` (`SCAM` / `LEGIT` / `UNSURE`), `policy.confidence`, and
     `action`: `hangup`, `take-message` or `continue`.
   - The bridge then acts on that answer. It hangs up, takes a message, or
     keeps the caller talking, and it plays the receptionist's lines into the
     call. In the browser today, that loop (including the opening AI
     disclosure and the trap lines that stall a scammer) lives in
     `app/public/voice-client.js` and `app/public/receptionist.js`. A bridge
     runs the same loop on the server side.
   - When the call ends, send `POST /api/report` with
     `{ "lines", "intel"?, "endedBy", "verdict", "lang", "region" }`. That
     returns the case report, and it reaches the family chat if you turned
     that on in step 3.

Two consequences of the current limits: all calls through one bridge share
one IP's limits (3 live calls at once, 8 a day), and every call is cut off at
600 s. A real phone line will need different values in `LIMITS`.

See also: [`ADAPTERS.md`](ADAPTERS.md) (family chat),
[`go-live.md`](go-live.md), and [`trap-mode.md`](trap-mode.md).
