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
import { synthesize, textHash, TTS_MAX_CHARS, TTS_MODEL, TTS_VOICE, verifyTtsToken } from './tts.js';

const audioHeaders = (extra = {}) => ({
  'content-type': 'audio/wav',
  'cache-control': 'private, no-store',
  'x-tts-model': TTS_MODEL,
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
    const cacheKey = new Request(`${new URL(c.req.url).origin}/__tts-cache/${TTS_MODEL}/${TTS_VOICE}/${await textHash(text)}`);
    const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
    if (hit) {
      await settle(0);
      return new Response(hit.body, { headers: audioHeaders({ 'x-tts-cache': 'hit' }) });
    }
    try {
      const r = await synthesize({ fetch, apiKey: key, text });
      await settle(r.costUsd);
      if (cache) {
        const put = cache.put(cacheKey, new Response(r.audio, { headers: { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=86400' } })).catch(() => {});
        try { c.executionCtx.waitUntil(put); } catch { await put; }
      }
      return new Response(r.audio, { headers: audioHeaders({ 'x-tts-cache': 'miss' }) });
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
