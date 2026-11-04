// LINE Messaging API push message. (LINE Notify was discontinued: not used.)
// Docs: https://developers.line.biz/en/reference/messaging-api/#send-push-message (checked 2026-11-04)
//   POST https://api.line.me/v2/bot/message/push
//   Authorization: Bearer <channel access token>
//   X-Line-Retry-Key: <UUID>  (a retry with the same key is not sent twice: 409 = already accepted)
//   { to: userId|groupId|roomId, messages: [{ type:'text', text (<=5000) }] }
// The recipient must have added the LINE Official Account as a friend (or the
// group must contain it); otherwise LINE answers 200 but nothing is delivered.
import { formatReport } from './format.js';
import { isSet, postJson } from './http.js';

export const LINE_MAX_CHARS = 5000;

export const line = {
  name: 'line',
  configured: (env) => isSet(env?.LINE_CHANNEL_ACCESS_TOKEN) && isSet(env?.LINE_TO),
  buildRequest(report, env, { retryKey = crypto.randomUUID() } = {}) {
    return {
      url: 'https://api.line.me/v2/bot/message/push',
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, 'X-Line-Retry-Key': retryKey },
      body: { to: String(env.LINE_TO), messages: [{ type: 'text', text: formatReport(report, { maxChars: LINE_MAX_CHARS - 96 }) }] },
    };
  },
  async send(report, env, { fetch: fetchFn = (...a) => fetch(...a), timeoutMs, retryKey } = {}) {
    const req = this.buildRequest(report, env, retryKey ? { retryKey } : {});
    // Idempotent thanks to the retry key, so a timeout may be retried once.
    const r = await postJson(fetchFn, req.url, { headers: req.headers, body: req.body, timeoutMs, idempotent: true });
    if (r.status === 200 || (r.status === 409 && r.attempts > 1)) {
      const id = r.body?.sentMessages?.[0]?.id;
      return { ok: true, channel: 'line', id: id ? String(id) : req.headers['X-Line-Retry-Key'], attempts: r.attempts };
    }
    return { ok: false, channel: 'line', error: r.error || `http-${r.status}`, attempts: r.attempts };
  },
};
