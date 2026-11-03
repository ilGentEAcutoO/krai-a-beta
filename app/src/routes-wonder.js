// B8 routes: Wonder escalation (T3) + trap mode. Mounted by index.js:
//   registerWonderRoutes(app, { protect, getKey })
// protect(name) returns Hono middleware (session / rate limit / budget);
// when the context carries c.get('settle'), it is called with the real USD
// cost of the model calls this request made (COST_PER_M in wonder.js);
// paths that spend nothing settle(0) so the reserved estimate is released.
import { createWonder, COST_PER_M, costUsd } from './wonder.js';
import {
  callLang, closingLine, createTrap, dedupeIntel, regexIntel, TRAP_MAX_MS, TRAP_MAX_TURNS, trapExpired, verifyIntel,
} from './trap.js';
import { decideSpark, nextAction, SIGNAL_KEYS, templateReasons } from './policy.js';
import { signTtsToken } from './tts.js';

export { COST_PER_M, costUsd };

// Input caps (bound prompt size = bound cost): last 40 lines, 2000 chars per
// line, 12k chars in total after trimming (else 413).
export const MAX_LINES = 40;
export const MAX_LINE_CHARS = 2000;
export const MAX_TOTAL_CHARS = 12000;

// [{speaker:'caller'|..., text}] -> [{role:'caller'|'ai', text}], bounded.
function toTurns(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .slice(-MAX_LINES)
    .map((l) => ({ role: l.speaker === 'caller' ? 'caller' : 'ai', text: l.text.trim().slice(0, MAX_LINE_CHARS) }));
}
const tooBig = (turns) => turns.reduce((n, t) => n + t.text.length, 0) > MAX_TOTAL_CHARS;

function cleanSpark(spark) {
  const s = spark && typeof spark === 'object' ? spark : {};
  const verdict = ['SCAM', 'LEGIT', 'UNSURE'].includes(s.verdict) ? s.verdict : 'UNSURE';
  const signals = Object.fromEntries(SIGNAL_KEYS.map((k) => [k, Math.min(1, Math.max(0, Number(s.signals?.[k]) || 0))]));
  return {
    verdict,
    confidence: Math.min(1, Math.max(0, Number(s.confidence) || 0)),
    tactic: typeof s.tactic === 'string' ? s.tactic.slice(0, 40) : 'none',
    signals,
  };
}

// B20: a token that lets POST /api/tts speak exactly this reply for this
// caller (IP hash from the session guard) within 2 minutes. Nothing else.
async function ttsTokenFor(c, secret, text) {
  let ipHash = '';
  try {
    ipHash = c.get('abuse')?.ipHash || '';
  } catch { /* no guard in this context */ }
  try {
    return await signTtsToken(secret, { text, ipHash });
  } catch {
    return null;
  }
}

async function settleCost(c, usd) {
  let settle;
  try {
    settle = c.get('settle');
  } catch {
    settle = undefined;
  }
  if (typeof settle !== 'function') return;
  try {
    await settle(usd);
  } catch { /* billing hook failure never breaks the call */ }
}

// ---- trap token: stateless, server-enforced 10-min / 20-reply cap ----
// token = "v1.<b64url({s: server start ms, n: replies so far, r: nonce})>.<b64url(HMAC-SHA256)>"
// keyed by SESSION_SECRET (domain-separated). The client only carries it.
// Replaying an older token can re-use a reply number but never moves the
// signed start time, so the 10-minute wall clock always holds; per-route
// rate limits bound the rest.
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
const hmacKey = (secret) => crypto.subtle.importKey(
  'raw', enc.encode(`krai-trap-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
);

export async function signTrapToken(secret, { s, n }) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(9)));
  const body = b64url(enc.encode(JSON.stringify({ s, n, r: nonce })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`v1.${body}`));
  return `v1.${body}.${b64url(sig)}`;
}

// -> { s, n } or null. Never throws.
export async function verifyTrapToken(secret, token) {
  try {
    const str = String(token || '');
    const parts = str.split('.');
    if (str.length > 400 || parts.length !== 3 || parts[0] !== 'v1') return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(parts[2]), enc.encode(`v1.${parts[1]}`));
    if (!ok) return null;
    const o = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
    const s = Number(o?.s);
    const n = Number(o?.n);
    if (!Number.isFinite(s) || !Number.isInteger(n) || n < 0) return null;
    return { s, n };
  } catch {
    return null;
  }
}

export function registerWonderRoutes(app, {
  protect = () => (c, next) => next(),
  getKey = (c) => c.env?.META_MODEL_API_KEY || '',
  getSecret = (c) => c.env?.SESSION_SECRET || '',
  fetch, // optional injection for tests; defaults to globalThis.fetch
  now = () => Date.now(), // injectable clock for tests
} = {}) {
  // Grey-zone call -> Wonder -> policy guard -> action.
  // body: { lines:[{speaker,text}], spark:{verdict,confidence,tactic,signals}, turnCount? }
  app.post('/api/verdict/escalate', protect('wonder'), async (c) => {
    const t0 = Date.now();
    const key = getKey(c);
    if (!key) {
      await settleCost(c, 0);
      return c.json({ ok: false, error: 'missing-key' }, 500);
    }
    const body = await c.req.json().catch(() => null);
    const turns = toTurns(body?.lines);
    if (!turns.some((t) => t.role === 'caller')) {
      await settleCost(c, 0); // nothing spent: release the reservation
      return c.json({ ok: false, error: 'empty-turn' }, 400);
    }
    if (tooBig(turns)) {
      await settleCost(c, 0);
      return c.json({ ok: false, error: 'too-large' }, 413);
    }
    const spark = cleanSpark(body?.spark);
    const sparkPolicy = decideSpark(spark);
    // Only the grey zone pays for Wonder: a decided call keeps Spark's policy.
    if (!sparkPolicy.escalate) {
      await settleCost(c, 0);
      const action = nextAction({ ...sparkPolicy, signals: spark.signals }, Number(body?.turnCount) || turns.filter((t) => t.role === 'caller').length);
      return c.json({ ok: true, skipped: 'not-escalated', wonder: null, policy: sparkPolicy, action, costUsd: 0, latencyMs: Date.now() - t0 });
    }
    const wonder = await createWonder({ fetch, apiKey: key }).judgeHard({ turns, spark });
    await settleCost(c, wonder.costUsd || 0);
    const policy = {
      verdict: wonder.verdict,
      confidence: wonder.confidence,
      escalate: false,
      rule: wonder.engine === 'wonder' ? (wonder.guarded ? 'wonder-guard' : 'wonder') : 'wonder-fallback',
    };
    if (wonder.engine !== 'wonder') Object.assign(policy, { escalate: sparkPolicy.escalate, verdict: sparkPolicy.verdict, confidence: sparkPolicy.confidence });
    const turnCount = Number(body?.turnCount) || turns.filter((t) => t.role === 'caller').length;
    const action = nextAction({ ...policy, signals: wonder.signals }, turnCount);
    // A guarded Wonder answer shows code-written reasons, not the model's.
    const reasons = wonder.guarded ? templateReasons(policy.verdict, wonder.signals) : { reasonTh: wonder.reasonTh, reasonEn: wonder.reasonEn };
    return c.json({
      ok: true,
      wonder: { ...wonder, ...reasons },
      policy,
      action,
      costUsd: wonder.costUsd || 0,
      latencyMs: Date.now() - t0,
    });
  });

  // Trap mode: one stalling line + the intel so far.
  // body: { lines:[{speaker,text}], intel?:[{type,value,quote}], trapToken? }
  // No token = a new trap starting now (server clock). A token must verify;
  // the 10-min and 20-reply caps come from it, never from the client.
  app.post('/api/trap/reply', protect('trap'), async (c) => {
    const t0 = now();
    const key = getKey(c);
    const secret = getSecret(c);
    if (!key || !secret) {
      await settleCost(c, 0);
      return key ? c.json({ ok: false, error: 'misconfigured' }, 503) : c.json({ ok: false, error: 'missing-key' }, 500);
    }
    const body = await c.req.json().catch(() => null);
    const turns = toTurns(body?.lines);
    if (!turns.some((t) => t.role === 'caller')) {
      await settleCost(c, 0); // nothing spent: release the reservation
      return c.json({ ok: false, error: 'empty-turn' }, 400);
    }
    if (tooBig(turns)) {
      await settleCost(c, 0);
      return c.json({ ok: false, error: 'too-large' }, 413);
    }
    let state = { s: t0, n: 0 };
    if (body?.trapToken != null && body.trapToken !== '') {
      const v = await verifyTrapToken(secret, body.trapToken);
      if (!v || v.s > t0 + 5000) {
        await settleCost(c, 0);
        return c.json({ ok: false, error: 'bad-trap-token' }, 400);
      }
      state = v;
    }
    const elapsedMs = Math.max(0, t0 - state.s);
    const trapToken = await signTrapToken(secret, { s: state.s, n: state.n + 1 });
    const limits = { maxMs: TRAP_MAX_MS, maxTurns: TRAP_MAX_TURNS };
    const callerTurns = turns.filter((t) => t.role === 'caller').length;
    // Client intel is untrusted: keep only items quoted from these caller lines.
    const prior = verifyIntel(Array.isArray(body?.intel) ? body.intel.slice(0, 60) : [], turns);

    // Past the cap: closing line, regex intel only, zero model spend.
    if (trapExpired({ elapsedMs, turnNo: state.n })) {
      await settleCost(c, 0);
      return c.json({
        ok: true, reply: closingLine(callLang(turns)), ttsToken: await ttsTokenFor(c, secret, closingLine(callLang(turns))), guarded: false, guardReasons: [], source: 'closing',
        intel: dedupeIntel([...regexIntel(turns), ...prior]), done: true, trapToken, turnNo: state.n,
        elapsedMs, limits, callerTurns, costUsd: 0, latencyMs: now() - t0,
      });
    }
    const trap = createTrap({ fetch, apiKey: key });
    const [r, ex] = await Promise.all([
      trap.nextTrapReply({ turns, intel: prior, elapsedMs, turnNo: state.n }),
      trap.extractIntel(turns),
    ]);
    const usd = Math.round(((r.costUsd || 0) + (ex.costUsd || 0)) * 1e8) / 1e8;
    await settleCost(c, usd);
    return c.json({
      ok: true,
      reply: r.reply,
      ttsToken: await ttsTokenFor(c, secret, r.reply),
      guarded: r.guarded,
      guardReasons: r.reasons,
      source: r.source,
      intel: dedupeIntel([...ex.items, ...prior]),
      done: r.done,
      trapToken,
      turnNo: state.n + 1,
      elapsedMs,
      limits,
      callerTurns,
      costUsd: usd,
      latencyMs: now() - t0,
    });
  });

  return app;
}
