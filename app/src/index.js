import { Hono } from 'hono';
import { looksLikeWav, transcribeFile } from './voice.js';
import { createSpark } from './spark.js';
import { decideSpark, nextAction, t1Demand } from './policy.js';
import FEWSHOT from './fewshot.json' with { type: 'json' };

export { VoiceCall } from './voice-do.js';

const app = new Hono();

// Liveness probe for deploy checks and judges. No secrets, no PII.
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    app: 'krai-a-beta',
    track: 'indie-solo',
    event: 'meta-global-ai-developer-hackathon-2026',
    now: new Date().toISOString(),
  })
);

// Realtime voice: browser WS -> VoiceCall DO -> Meta Voice WS. One DO per
// ?call= id; non-upgrade GET returns the call's persisted turns (debug).
app.all('/api/voice/live', (c) => {
  const binding = c.env?.VOICE_CALL;
  if (!binding) return c.json({ ok: false, error: 'no-voice-binding' }, 500);
  const call = c.req.query('call') || 'demo';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(call)) return c.json({ ok: false, error: 'bad-call' }, 400);
  return binding.get(binding.idFromName(`call-${call}`)).fetch(c.req.raw);
});

// Chunked transcription: body is raw WAV bytes (mono 16-bit). Abuse limits
// (rate caps, caller allowlist) land in B7; until then: size cap + WAV check.
app.post('/api/voice/file', async (c) => {
  const t0 = Date.now();
  const key = c.env?.META_MODEL_API_KEY || '';
  if (!key) return c.json({ ok: false, error: 'missing-key' }, 500);
  const buf = await c.req.arrayBuffer().catch(() => null);
  if (!buf || !buf.byteLength) return c.json({ ok: false, error: 'empty-audio' }, 400);
  if (buf.byteLength > 2 * 1024 * 1024) return c.json({ ok: false, error: 'too-large' }, 413);
  if (!looksLikeWav(buf)) return c.json({ ok: false, error: 'bad-audio' }, 400);
  try {
    const r = await transcribeFile({ apiKey: key, wavBytes: buf });
    return c.json({ ok: true, transcript: r.transcript, latencyMs: Date.now() - t0, model: r.model });
  } catch (e) {
    return c.json({ ok: false, error: String(e.message || 'voice-error') }, 502);
  }
});

// One caller turn -> Spark verdict -> policy decision -> call action.
// T1 lexical demand is reported but never decides alone (policy.t1Demand:
// a hit is a CANDIDATE Spark's signal must confirm in the same call).
app.post('/api/verdict/turn', async (c) => {
  const t0 = Date.now();
  const key = c.env?.META_MODEL_API_KEY || '';
  if (!key) return c.json({ ok: false, error: 'missing-key' }, 500);
  const body = await c.req.json().catch(() => null);
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const turns = lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({ role: l.speaker === 'caller' ? 'caller' : 'ai', text: l.text.trim().slice(0, 2000) }));
  if (!turns.length) return c.json({ ok: false, error: 'empty-turn' }, 400);
  const spark = createSpark({ apiKey: key, fewshots: FEWSHOT.cases || [], categories: FEWSHOT.categories || [] });
  const judged = await spark.judgeTurn({ turns });
  const policy = decideSpark(judged);
  const action = nextAction(policy, Number(body?.turnCount) || 1);
  const t1 = t1Demand(turns.filter((t) => t.role === 'caller').map((t) => t.text));
  return c.json({ ok: true, turnId: body?.turnId ?? null, spark: judged, policy, action, t1, latencyMs: Date.now() - t0 });
});

app.notFound((c) => c.json({ ok: false, error: 'not-found' }, 404));

export default app;
