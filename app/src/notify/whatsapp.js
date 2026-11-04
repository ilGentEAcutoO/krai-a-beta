// WhatsApp Cloud API (Meta Graph) /messages.
// Docs (checked 2026-11-04):
//   text:     https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
//   template: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
//   window:   https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#customer-service-windows
// POST https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/messages
//   Authorization: Bearer <token>
//   text:     { messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{ preview_url:false, body (<=4096) } }
//   template: { ..., type:'template', template:{ name, language:{ code }, components:[{ type:'body', parameters:[{ type:'text', text }] }] } }
// LIMIT: a free-form text message is only delivered inside the 24-hour
// customer service window (the family member messaged the business number in
// the last 24 h). Outside it only an APPROVED template can be sent, so set
// WHATSAPP_TEMPLATE to your approved utility template (3 body params, see
// docs/ADAPTERS.md). Since 2026-10-01 Meta charges per delivered message for
// both kinds.
import { formatReport, templateParams } from './format.js';
import { isSet, postJson } from './http.js';

export const WHATSAPP_MAX_CHARS = 4096;
export const GRAPH_VERSION = 'v26.0';

export const whatsapp = {
  name: 'whatsapp',
  configured: (env) => isSet(env?.WHATSAPP_TOKEN) && isSet(env?.WHATSAPP_PHONE_NUMBER_ID) && isSet(env?.WHATSAPP_TO),
  buildRequest(report, env) {
    const version = /^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION || '') ? env.WHATSAPP_GRAPH_VERSION : GRAPH_VERSION;
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(env.WHATSAPP_TO) };
    const body = env.WHATSAPP_TEMPLATE
      ? {
        ...base,
        type: 'template',
        template: {
          name: String(env.WHATSAPP_TEMPLATE),
          language: { code: String(env.WHATSAPP_TEMPLATE_LANG || 'th') },
          components: [{ type: 'body', parameters: templateParams(report).map((text) => ({ type: 'text', text })) }],
        },
      }
      : { ...base, type: 'text', text: { preview_url: false, body: formatReport(report, { maxChars: WHATSAPP_MAX_CHARS - 96 }) } };
    return {
      url: `https://graph.facebook.com/${version}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
      body,
    };
  },
  async send(report, env, { fetch: fetchFn = (...a) => fetch(...a), timeoutMs } = {}) {
    const req = this.buildRequest(report, env);
    const r = await postJson(fetchFn, req.url, { headers: req.headers, body: req.body, timeoutMs });
    const id = r.body?.messages?.[0]?.id;
    if (r.status === 200 && id) return { ok: true, channel: 'whatsapp', id: String(id), attempts: r.attempts };
    // Graph error code only (e.g. 131047 = outside the 24 h window), never the message text.
    const code = Number.isInteger(r.body?.error?.code) ? `:${r.body.error.code}` : '';
    return { ok: false, channel: 'whatsapp', error: (r.error || `http-${r.status}`) + code, attempts: r.attempts };
  },
};
