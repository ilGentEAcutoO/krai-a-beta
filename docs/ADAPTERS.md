# Delivery adapters: send the case report to your family's chat

When a screened call ends, Krai-A writes a case report covering who the caller said they were, the scam tactic, the account numbers and links the caller gave, and what to do next. In your own fork you can have that report delivered to the chat your family already uses:

| Channel | API | Cost to you | Main limit |
|---|---|---|---|
| Telegram | Bot API `sendMessage` | free | the chat must have started the bot (or the bot is in the group) |
| LINE | Messaging API push | free monthly quota, then paid per plan | the user must have added your LINE Official Account (or it is in the group) |
| WhatsApp | Cloud API `/messages` | Meta charges per delivered message (from 2026-10-01 for both kinds) | free text only reaches someone inside the 24 h window; otherwise you need an approved template |

Status: all three are **contract-tested against the documented API (not live-verified)**. `app/test/notify.test.mjs` asserts the exact URL, headers and JSON body for each API, plus the timeout, retry and failure-isolation rules. No real token was used. Run `npm run notify:test` (below) to check against your own chat.

## How it works

- `app/src/notify/` holds one module per channel (`telegram.js`, `whatsapp.js`, `line.js`) behind one interface: `configured(env)` and `send(report, env, { fetch }) -> { ok, channel, id } | { ok: false, channel, error }`.
- `app/src/index.js` adds `app.use('/api/report', notifyAfterReport())`. After `/api/report` returns a finished report, the middleware hands it to every enabled channel in the background (`waitUntil`). The page's response doesn't change and isn't slowed down.
- **Opt-in.** Nothing is sent unless `NOTIFY_ENABLED=1` **and** that channel's variables are set. The public demo (beta.krai-a.com) sets neither.
- **Safe failure.** Each request has a 5 s timeout. A network error, a 429 or a 5xx is retried at most once. A 4xx (bad token, closed WhatsApp window) is never retried. A timeout is retried only on LINE, because LINE's `X-Line-Retry-Key` stops a duplicate. Errors are returned, never thrown, so a broken adapter can't break a call.
- **At most one message per channel per call.** The same report posted twice is dropped as `duplicate`. Each channel is also capped at `NOTIFY_MAX_PER_HOUR` messages per hour (default 6). This guard is per Worker isolate, so it's best effort. If you need a hard global cap, back it with a Durable Object (the app's `RateLimit` DO is a model).
- **Privacy.** The message carries only report fields: the headline, call type, confidence, verified caller values and next steps. It never includes the raw transcript, the receptionist's lines, the model prompt or any key. Caller values are cleaned of control and bidi characters and capped at 120 characters. Links the caller gave are defanged (`hxxps://bad[.]example`) so nobody taps a scam link from the family chat. Link previews are off. Logs record only `{channel, ok, error, attempts}`, never tokens. The Telegram token sits in the URL path, so URLs are never logged either.
- **Disclosure.** Every message ends with `ข้อความอัตโนมัติจากผู้ช่วยรับสาย AI (Krai-A) ไม่ใช่คนพิมพ์ ตรวจสอบก่อนทำตามทุกครั้ง` ("automated message from an AI receptionist, not typed by a person; check before acting").
- **Language.** The report is written in Thai, so the message is in Thai.

## Common settings

| Variable | Meaning |
|---|---|
| `NOTIFY_ENABLED` | `1` turns delivery on. Anything else means off. |
| `NOTIFY_VERDICTS` | Optional list, e.g. `SCAM,UNSURE`, so ordinary calls don't ping the family. Empty means every verdict is sent. |
| `NOTIFY_MAX_PER_HOUR` | Per-channel hourly cap (default 6). |

Local: copy `app/.dev.vars.example` to `app/.dev.vars` and fill it in. Production: `npx wrangler secret put <NAME>` for each value, including `NOTIFY_ENABLED`, so you can flip it without a deploy.

## Telegram

1. In Telegram, open **@BotFather** and send `/newbot`. Pick a name and copy the token.
2. Open a chat with your new bot and press **Start**. For a family group, add the bot to the group and send any message there.
3. Find the chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read `message.chat.id`. Group ids are negative, like `-100…`.
4. Set the secrets:
   ```sh
   cd app
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler secret put NOTIFY_ENABLED   # 1
   ```
5. Test it: `npm run notify:test -- --channel telegram`

Limit: 4096 characters per message. The adapter sends plain text (no `parse_mode`), so caller text can't break the formatting. Docs: https://core.telegram.org/bots/api#sendmessage

## LINE (Messaging API)

LINE Notify was discontinued, so this adapter uses the Messaging API push endpoint.

1. Go to https://developers.line.biz/console/, create a provider, then a **Messaging API** channel. This also creates a LINE Official Account.
2. Under **Messaging API → Channel access token**, issue a long-lived token.
3. Each family member adds the Official Account as a friend (use the QR code on the Messaging API tab). For a group, invite the account into the group.
4. Find `LINE_TO`:
   - For yourself, use **Basic settings → Your user ID** (`U…`).
   - For someone else or a group, the `userId` or `groupId` (`C…`) arrives in the webhook event when they message the account or add it to a group.
5. Set the secrets:
   ```sh
   npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   npx wrangler secret put LINE_TO
   npx wrangler secret put NOTIFY_ENABLED   # 1
   ```
6. Test it: `npm run notify:test -- --channel line`

Limits:
- 5000 characters per text message.
- Push messages count against your Official Account's monthly message quota.
- If the recipient blocked the account or never added it, LINE still answers 200 but **nothing is delivered**.

Docs: https://developers.line.biz/en/reference/messaging-api/#send-push-message

## WhatsApp (Cloud API)

Read this first. WhatsApp only delivers a free-form text message inside a **24-hour customer service window**, which opens each time the family member messages your business number. A scam call can come at any time, so in practice you need an **approved template** (`WHATSAPP_TEMPLATE`), which can be sent at any time. Without one, a send outside the window fails with Graph error `131047`. The adapter reports that as `http-400:131047` and doesn't retry. Since 2026-10-01 Meta charges per delivered message for both kinds, and service messages need a payment method on the WhatsApp account. Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows

1. At https://developers.facebook.com/apps, create an app and add the **WhatsApp** product.
2. In **WhatsApp → API Setup**, copy the **Phone number ID**. While the app is in development, add each family number as an allowed recipient there.
3. Create a durable token: in Business settings, create a System user, give it the `whatsapp_business_messaging` permission and generate a token. The API Setup token expires after 24 h.
4. Recommended: in WhatsApp Manager, create a **Utility** template, for example `krai_a_report` in language `th`, with a body like:
   ```
   รายงานสายที่ผู้ช่วยรับแทน: {{1}}
   รายละเอียด: {{2}}
   {{3}}
   ```
   The adapter fills `{{1}}` with the verdict headline, `{{2}}` with the top caller details and the first next step, and `{{3}}` with the AI disclosure. Each parameter is a single line (no newlines or tabs) and at most 900 characters, a conservative cap that is ours, not Meta's. Wait for the template to reach `APPROVED`.
5. Set the secrets:
   ```sh
   npx wrangler secret put WHATSAPP_TOKEN
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   npx wrangler secret put WHATSAPP_TO          # +66812345678
   npx wrangler secret put WHATSAPP_TEMPLATE    # krai_a_report (leave unset for text-only)
   npx wrangler secret put WHATSAPP_TEMPLATE_LANG   # th
   npx wrangler secret put NOTIFY_ENABLED       # 1
   ```
6. Test it: `npm run notify:test -- --channel whatsapp`. For the text path, message your business number first so the 24 h window is open.

Limits: 4096 characters per text body. The Graph API version is `v26.0` (override it with `WHATSAPP_GRAPH_VERSION`). Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages and https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview

## Test from your machine

```sh
cd app
npm run notify:test -- --channel telegram --dry-run   # print the message only
npm run notify:test -- --channel all                  # send one sample to every configured channel
```

The script reads `app/.dev.vars`, sends a fixed fake sample report marked `[ทดสอบ]` (test), and prints `sent (id …)` or `FAILED <code>` per channel. It never prints tokens. It skips the `NOTIFY_ENABLED` switch and the dedupe check, because you ran it on purpose.

Unit tests (no network): `cd app && node --test test/notify.test.mjs`

## Add a new channel

1. Create `app/src/notify/<name>.js` exporting `{ name, configured(env), buildRequest(report, env), send(report, env, { fetch, timeoutMs }) }`. Use `formatReport(report, { maxChars })` from `format.js` and `postJson` from `http.js`, which handles the timeout and the single retry. Return `{ ok, channel, id }` or `{ ok: false, channel, error }` with a short code, never the API's message text and never the URL.
2. Register it in `ADAPTERS` in `app/src/notify/index.js`.
3. Add its variables to `app/.dev.vars.example`, with empty values and a `wrangler secret put` line.
4. Add a contract test to `app/test/notify.test.mjs` with an injected `fetch` that asserts the exact URL, headers and body from the provider's current docs. Put the doc URL in a comment in the module.
