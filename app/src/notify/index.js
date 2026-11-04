// Delivery adapters: send the finished case report to the family's chat.
//
// Common interface, one module per channel:
//   adapter.configured(env) -> boolean
//   adapter.send(report, env, { fetch, timeoutMs }) -> { ok, channel, id } | { ok:false, channel, error }
//
// Opt-in only: nothing is sent unless NOTIFY_ENABLED is "1"/"true" AND the
// channel's own env vars are set. The public demo sets neither.
// Safety: 5 s timeout, at most one retry (http.js), failures are returned,
// never thrown, so the call flow cannot break; at most one message per
// channel per finished report (dedupe), plus an hourly cap per channel.
// Tokens are never logged or returned. See docs/ADAPTERS.md.
import { telegram } from './telegram.js';
import { whatsapp } from './whatsapp.js';
import { line } from './line.js';

export const ADAPTERS = Object.freeze({ telegram, whatsapp, line });
export const DEFAULT_MAX_PER_HOUR = 6;
const HOUR = 3600_000;

export const notifyEnabled = (env) => /^(1|true)$/i.test(String(env?.NOTIFY_ENABLED ?? '').trim());

export function enabledChannels(env) {
  if (!notifyEnabled(env)) return [];
  return Object.values(ADAPTERS).filter((a) => a.configured(env));
}

// Stable identity of one finished call's report (generatedAt excluded, so a
// client re-posting the same call does not message the family twice).
export function reportKey(report) {
  const r = report || {};
  const s = JSON.stringify([r.verdict, r.callType, r.headlineTh, r.endedBy, r.callerTurns, (r.intel || []).map((i) => [i.type, i.value])]);
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k += 1) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Per-isolate guard (best effort: Workers may run several isolates; a fork
// that needs a hard global cap can back this with a Durable Object).
export function createGuard({ now = () => Date.now() } = {}) {
  const seen = new Map(); // `${channel}:${key}` -> ts
  const sent = new Map(); // channel -> [ts]
  return {
    allow(channel, key, maxPerHour) {
      const t = now();
      for (const [k, ts] of seen) if (t - ts > HOUR) seen.delete(k);
      const recent = (sent.get(channel) || []).filter((ts) => t - ts < HOUR);
      sent.set(channel, recent);
      if (seen.has(`${channel}:${key}`)) return 'duplicate';
      if (recent.length >= maxPerHour) return 'rate-limited';
      seen.set(`${channel}:${key}`, t);
      recent.push(t);
      return null;
    },
  };
}
const sharedGuard = createGuard();

function verdictAllowed(report, env) {
  const list = String(env?.NOTIFY_VERDICTS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return !list.length || list.includes(report?.verdict);
}

// Send one report to every enabled channel (or `channels` by name). Never throws.
export async function notifyReport(report, env, {
  fetch: fetchFn = (...a) => fetch(...a), channels = null, guard = sharedGuard, timeoutMs, force = false, log = console.log,
} = {}) {
  try {
    if (!report || typeof report !== 'object') return [];
    let list = force ? Object.values(ADAPTERS).filter((a) => a.configured(env)) : enabledChannels(env);
    if (channels) list = list.filter((a) => channels.includes(a.name));
    if (!list.length || (!force && !verdictAllowed(report, env))) return [];
    const max = Number(env?.NOTIFY_MAX_PER_HOUR) > 0 ? Number(env.NOTIFY_MAX_PER_HOUR) : DEFAULT_MAX_PER_HOUR;
    const key = reportKey(report);
    const results = await Promise.all(list.map(async (a) => {
      const blocked = force ? null : guard.allow(a.name, key, max);
      if (blocked) return { ok: false, channel: a.name, error: blocked, skipped: true };
      try {
        return await a.send(report, env, { fetch: fetchFn, timeoutMs });
      } catch {
        return { ok: false, channel: a.name, error: 'adapter-threw' };
      }
    }));
    try {
      log(JSON.stringify({ notify: results.map((r) => ({ channel: r.channel, ok: r.ok, error: r.error || null, attempts: r.attempts || 0 })) }));
    } catch { /* logging must not break anything */ }
    return results;
  } catch {
    return [];
  }
}

// Hono middleware for POST /api/report: after the route answered with a
// finished report, deliver it in the background (waitUntil), so the caller's
// response is never delayed or changed. No-op unless NOTIFY_ENABLED.
export function notifyAfterReport({ fetch: fetchFn, guard } = {}) {
  return async (c, next) => {
    await next();
    if (!enabledChannels(c.env).length || c.req.method !== 'POST' || c.res?.status !== 200) return;
    let data = null;
    try {
      data = await c.res.clone().json();
    } catch {
      return;
    }
    if (!data?.ok || !data.report) return;
    const p = notifyReport(data.report, c.env, { fetch: fetchFn, guard });
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      await p; // no execution context (tests)
    }
  };
}
