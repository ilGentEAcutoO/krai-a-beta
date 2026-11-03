import { Hono } from 'hono';
import { looksLikeWav, transcribeFile } from './voice.js';
import { VERDICT_SCHEMA, buildMessages, createSpark } from './spark.js';
import { decideSpark, nextAction, t1Demand } from './policy.js';
import { budgetStatus, cleanKey, isPaused, issueSession, protect, turnstileOn } from './abuse.js';
import { sparkUsd, utf8Bytes, voiceFileUsd, worstCaseUsd } from './budget.js';
import { registerWonderRoutes } from './routes-wonder.js';
import { registerReportRoutes } from './report.js';
import FEWSHOT from './fewshot.json' with { type: 'json' };

export { VoiceCall } from './voice-do.js';
export { Budget, RateLimit } from './budget.js';

const app = new Hono();

// NOTE: the Worker entry may only export the default handler and DO classes —
// workerd rejects any other named export at startup (tests cannot see this).
// Verdict input caps (413 beyond them) and the worst-case reservation they
// imply. Overhead = system prompt + few-shot pairs + JSON schema, counted in
// UTF-8 bytes (an upper bound on tokens) plus slack for message framing.
// SPARK_MAX_OUTPUT_TOKENS is our bound on reply + reasoning tokens: spark.js
// does not send max_completion_tokens yet, so it is an assumption, not a cap.
const VERDICT_LIMITS = { maxLines: 40, maxLineChars: 2000, maxTotalChars: 12000 };
const SPARK_MAX_OUTPUT_TOKENS = 8192;
const VERDICT_OVERHEAD_TOKENS = utf8Bytes(JSON.stringify(buildMessages({ turns: [], fewshots: FEWSHOT.cases || [] })))
  + utf8Bytes(JSON.stringify(VERDICT_SCHEMA)) + 512;

// Parse + validate a verdict body. Returns { turns, body } or { status, error }.
function parseVerdictBody(raw) {
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { status: 400, error: 'bad-json' };
  }
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  if (lines.length > VERDICT_LIMITS.maxLines) return { status: 413, error: 'too-many-lines' };
  let total = 0;
  const turns = [];
  for (const l of lines) {
    if (!l || typeof l.text !== 'string') continue;
    const text = l.text.trim();
    if (!text) continue;
    if (text.length > VERDICT_LIMITS.maxLineChars) return { status: 413, error: 'line-too-long' };
    total += text.length;
    if (total > VERDICT_LIMITS.maxTotalChars) return { status: 413, error: 'turn-too-long' };
    turns.push({ role: l.speaker === 'caller' ? 'caller' : 'ai', text });
  }
  if (!turns.length) return { status: 400, error: 'empty-turn' };
  return { turns, body };
}

const verdictEstimate = (c, { body }) => {
  const v = parseVerdictBody(body);
  if (v.error) return c.json({ ok: false, error: v.error, limits: VERDICT_LIMITS }, v.status);
  return worstCaseUsd({
    inputBytes: utf8Bytes(JSON.stringify(v.turns)),
    overheadTokens: VERDICT_OVERHEAD_TOKENS,
    maxOutputTokens: SPARK_MAX_OUTPUT_TOKENS,
  });
};

// Liveness probe for deploy checks and judges. No secrets, no PII.
app.get('/api/health', async (c) =>
  c.json({
    ok: true,
    app: 'krai-a-beta',
    track: 'indie-solo',
    event: 'meta-global-ai-developer-hackathon-2026',
    now: new Date().toISOString(),
    paused: isPaused(c.env),
    turnstile: turnstileOn(c.env),
    budget: await budgetStatus(c.env),
  })
);

// Public browser config (site key is public by design).
app.get('/api/config', (c) =>
  c.json({
    ok: true,
    turnstile: turnstileOn(c.env),
    turnstileSiteKey: cleanKey(c.env?.TURNSTILE_SITE_KEY) || null,
  })
);

// Turnstile -> short-lived HMAC session token (contract: src/abuse.js).
app.post('/api/session', (c) => issueSession(c));

// Realtime voice: browser WS -> VoiceCall DO -> Meta Voice WS. One DO per
// ?call= id. WebSocket upgrades only: call transcripts are private, so the
// old debug GET is closed (the client replays turns over the socket with
// { type:'get-turns' }). Upgrades go through the abuse guard; the DO meters seconds.
app.all(
  '/api/voice/live',
  (c, next) => (c.req.header('upgrade')?.toLowerCase() === 'websocket'
    ? next()
    : c.json({ ok: false, error: 'websocket-required' }, 426)),
  protect('voice-live'),
  (c) => {
    const binding = c.env?.VOICE_CALL;
    if (!binding) return c.json({ ok: false, error: 'no-voice-binding' }, 500);
    const call = c.req.query('call') || 'demo';
    if (!/^[A-Za-z0-9-]{1,64}$/.test(call)) return c.json({ ok: false, error: 'bad-call' }, 400);
    // Always overwrite the internal header so a client can't forge metering.
    const headers = new Headers(c.req.raw.headers);
    headers.delete('x-krai-live');
    const abuse = c.get('abuse');
    if (abuse?.liveId) headers.set('x-krai-live', JSON.stringify(abuse));
    return binding.get(binding.idFromName(`call-${call}`)).fetch(new Request(c.req.raw, { headers }));
  }
);

// Chunked transcription: body is raw WAV bytes (mono 16-bit). protect() caps
// the body at 2 MB before reading it; reservation and charge both assume the
// lowest plausible audio rate, so a forged WAV header can't shrink the cost.
app.post('/api/voice/file', protect('voice-file', { estimate: (c, { body }) => voiceFileUsd(body) }), async (c) => {
  const t0 = Date.now();
  const settle = c.get('settle');
  const key = cleanKey(c.env?.META_MODEL_API_KEY);
  const reject = async (status, error) => {
    await settle(0);
    return c.json({ ok: false, error }, status);
  };
  if (!key) return reject(500, 'missing-key');
  const buf = await c.req.arrayBuffer().catch(() => null);
  if (!buf || !buf.byteLength) return reject(400, 'empty-audio');
  if (buf.byteLength > 2 * 1024 * 1024) return reject(413, 'too-large');
  if (!looksLikeWav(buf)) return reject(400, 'bad-audio');
  try {
    const r = await transcribeFile({ apiKey: key, wavBytes: buf });
    await settle(voiceFileUsd(buf));
    return c.json({ ok: true, transcript: r.transcript, latencyMs: Date.now() - t0, model: r.model });
  } catch (e) {
    const error = String(e.message || 'voice-error');
    // Rejected requests (4xx / billing codes) are not billed; a timeout or 5xx
    // may have been processed, so the reserved estimate stays charged.
    if (!/timeout|http-5/.test(error)) await settle(0);
    return c.json({ ok: false, error }, 502);
  }
});

// One caller turn -> Spark verdict -> policy decision -> call action.
// T1 lexical demand is reported but never decides alone (policy.t1Demand:
// a hit is a CANDIDATE Spark's signal must confirm in the same call).
// Body: { lines:[{speaker,text}] } within VERDICT_LIMITS (64 KB raw cap).
app.post('/api/verdict/turn', protect('verdict', { estimate: verdictEstimate }), async (c) => {
  const t0 = Date.now();
  const settle = c.get('settle');
  const key = cleanKey(c.env?.META_MODEL_API_KEY);
  if (!key) {
    await settle(0);
    return c.json({ ok: false, error: 'missing-key' }, 500);
  }
  const { turns, body } = parseVerdictBody(await c.req.arrayBuffer());
  const spark = createSpark({ apiKey: key, fewshots: FEWSHOT.cases || [], categories: FEWSHOT.categories || [] });
  const judged = await spark.judgeTurn({ turns });
  // Actual cost: billed usage whenever Meta answered (also when its output
  // failed to parse); nothing on cache hits or rejected calls; a timeout
  // keeps the reserved worst case (the call may have run).
  if (judged.usage) await settle(sparkUsd(judged.usage));
  else if (!/timeout/.test(String(judged.error || ''))) await settle(0);
  const policy = decideSpark(judged);
  const action = nextAction(policy, Number(body?.turnCount) || 1);
  const t1 = t1Demand(turns.filter((t) => t.role === 'caller').map((t) => t.text));
  return c.json({ ok: true, turnId: body?.turnId ?? null, spark: judged, policy, action, t1, latencyMs: Date.now() - t0 });
});

// T1 alone, no model: the instant code rules (policy.t1Demand) so the client
// can act on a hard demand (OTP / app install / transfer now / don't hang up
// + do) while /api/verdict/turn waits for Spark. Spark's verdict still
// decides what is recorded; T1 only lets the receptionist react sooner.
// Measured 2026-11-03: fires on 3/64 train scam calls, 0/56 legit+unsure.
app.post('/api/verdict/t1', protect('t1'), async (c) => {
  const parsed = parseVerdictBody(await c.req.arrayBuffer());
  if (parsed.status) return c.json({ ok: false, error: parsed.error }, parsed.status);
  const callerLines = parsed.turns.filter((t) => t.role === 'caller').map((t) => t.text);
  return c.json({ ok: true, turnId: parsed.body?.turnId ?? null, t1: t1Demand(callerLines) });
});

// Muse Wonder T3 escalation + trap mode (B8), behind the same abuse guard.
registerWonderRoutes(app, { protect, getKey: (c) => cleanKey(c.env?.META_MODEL_API_KEY) });

// G8 family case report at call end (src/report.js), same abuse guard.
registerReportRoutes(app, { protect, getKey: (c) => cleanKey(c.env?.META_MODEL_API_KEY) });

app.notFound((c) => c.json({ ok: false, error: 'not-found' }, 404));

export default app;
