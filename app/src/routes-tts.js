// POST /api/tts (B20): speak ONE trap line that this server wrote, in the
// receptionist's Gemini voice (voice output only; Meta's API has no TTS).
//
// body { text, ttsToken }  ->  200 audio/wav  |  JSON error
// ttsToken comes from POST /api/trap/reply next to the line it covers
// (src/tts.js signTtsToken: HMAC over sha256(text) + session IP hash +
// 2-minute expiry). Free text, an edited line, another visitor's token or an
// expired one is refused before any Google call (403), so the route is never
// a free TTS service. Behind protect('tts'): kill switch, session, per-IP rate
// limit, body cap, and the 'tts' budget ledger (own daily + total cap).
// Same line again (replay, retry) is served from the edge cache at $0.
// Every refusal or error makes the page fall back to speechSynthesis +
// caption, so a failure here never silences the call.
import { cleanKey } from './abuse.js';
import { BUDGET_NAME, doCall } from './budget.js';
import { googleDay, synthesize, textHash, TTS_DAILY_REQUESTS, TTS_FALLBACK_MODEL, TTS_MAX_CHARS, TTS_MODEL, TTS_VOICE, styleFor, verifyTtsToken } from './tts.js';

// Google returns WAV (RIFF) for this request; anything else is refused so the
// browser never gets a body its decoder can't play under a wrong type.
const AUDIO_TYPES = /^audio\/(wav|x-wav|wave|mpeg|ogg)\b/i;
const audioHeaders = (type, extra = {}) => ({
  'content-type': type,
  'cache-control': 'private, no-store',
  ...extra,
});

export function registerTtsRoutes(app, {
  protect = () => (c, next) => next(),
  getKey = (c) => cleanKey(c.env?.GEMINI_API_KEY),
  getSecret = (c) => cleanKey(c.env?.SESSION_SECRET),
  fetch, // test injection
  getCache = () => globalThis.caches?.default || null,
  now = () => Date.now(),
} = {}) {
  app.post('/api/tts', protect('tts'), async (c) => {
    let settle = async () => {};
    let ipHash = '';
    try {
      settle = c.get('settle') || settle;
      ipHash = c.get('abuse')?.ipHash || '';
    } catch { /* no guard in this context */ }
    const refuse = async (status, error) => {
      await settle(0);
      return c.json({ ok: false, error }, status);
    };
    const key = getKey(c);
    const secret = getSecret(c);
    if (!key) return refuse(503, 'tts-off');
    if (!secret) return refuse(503, 'misconfigured');
    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim() || [...text].length > TTS_MAX_CHARS) return refuse(400, 'bad-text');
    const v = await verifyTtsToken(secret, body?.ttsToken, { text, ipHash, now: now() });
    if (!v.ok) return refuse(403, v.error);

    const cache = getCache();
    const cacheKey = new Request(`${new URL(c.req.url).origin}/__tts-cache/${TTS_VOICE}/${(await textHash(styleFor(text))).slice(0, 12)}/${await textHash(text)}`);
    const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
    if (hit) {
      await settle(0);
      return new Response(hit.body, { headers: audioHeaders(hit.headers.get('content-type') || 'audio/wav', { 'x-tts-cache': 'hit', 'x-tts-model': hit.headers.get('x-tts-model') || '' }) });
    }
    try {
      // flash-tts first; at our daily stop (or Google's 429) the same voice +
      // prompt on flash-lite-tts; when both are used up, 503 'tts-quota' and
      // the page speaks with the browser voice + caption.
      const day = googleDay(now());
      const budget = c.env?.BUDGET;
      const counter = (op, model) => (budget
        ? doCall(budget, BUDGET_NAME, op, { name: model, day, max: TTS_DAILY_REQUESTS }).catch(() => ({ ok: false }))
        : Promise.resolve({ ok: true }));
      let r = null;
      for (const model of [TTS_MODEL, TTS_FALLBACK_MODEL]) {
        if (!(await counter('take', model)).ok) continue;
        try {
          r = await synthesize({ fetch, apiKey: key, text, model });
          break;
        } catch (e) {
          if (!/tts-http-429/.test(String(e?.message))) throw e;
          await counter('exhaust', model);
        }
      }
      if (!r) return refuse(503, 'tts-quota');
      await settle(r.costUsd);
      const type = r.mimeType.split(';')[0].trim();
      if (!AUDIO_TYPES.test(type)) return c.json({ ok: false, error: 'tts-bad-audio' }, 502);
      if (cache) {
        const put = cache.put(cacheKey, new Response(r.audio, { headers: { 'content-type': type, 'x-tts-model': r.model, 'cache-control': 'public, max-age=86400' } })).catch(() => {});
        try { c.executionCtx.waitUntil(put); } catch { await put; }
      }
      return new Response(r.audio, { headers: audioHeaders(type, { 'x-tts-cache': 'miss', 'x-tts-model': r.model }) });
    } catch (e) {
      const error = String(e?.message || 'tts-error');
      // A rejected request is not billed; a timeout or 5xx may have run, so
      // the reserved worst case stays charged.
      if (!/timeout|http-5/.test(error)) await settle(0);
      return c.json({ ok: false, error }, 502);
    }
  });
  return app;
}
