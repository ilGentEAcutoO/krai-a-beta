// Telegram Bot API sendMessage.
// Docs: https://core.telegram.org/bots/api#sendmessage (checked 2026-11-04)
//   POST https://api.telegram.org/bot<token>/sendMessage, JSON body
//   { chat_id, text (1-4096 chars after entity parsing), link_preview_options }
//   Response: { ok: true, result: Message } or { ok: false, error_code, description }.
// Plain text (no parse_mode), so caller text can never break Markdown/HTML parsing.
import { formatReport } from './format.js';
import { isSet, postJson } from './http.js';

export const TELEGRAM_MAX_CHARS = 4096;

export const telegram = {
  name: 'telegram',
  configured: (env) => isSet(env?.TELEGRAM_BOT_TOKEN) && isSet(env?.TELEGRAM_CHAT_ID),
  buildRequest(report, env) {
    return {
      url: `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      headers: {},
      body: {
        chat_id: env.TELEGRAM_CHAT_ID,
        text: formatReport(report, { maxChars: TELEGRAM_MAX_CHARS - 96 }),
        link_preview_options: { is_disabled: true },
      },
    };
  },
  async send(report, env, { fetch: fetchFn = (...a) => fetch(...a), timeoutMs } = {}) {
    const req = this.buildRequest(report, env);
    const r = await postJson(fetchFn, req.url, { headers: req.headers, body: req.body, timeoutMs });
    if (r.status === 200 && r.body?.ok === true) return { ok: true, channel: 'telegram', id: String(r.body.result?.message_id ?? ''), attempts: r.attempts };
    return { ok: false, channel: 'telegram', error: r.error || `http-${r.status}`, attempts: r.attempts };
  },
};
