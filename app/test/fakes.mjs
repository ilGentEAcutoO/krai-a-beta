// Shared test doubles for the abuse guard: Map-backed DO storage, a fake
// namespace that routes to real Budget / RateLimit instances, and a helper
// that mints a valid session for a given client IP. No network.
import { Budget, RateLimit } from '../src/budget.js';
import { hashIp, signSession } from '../src/abuse.js';

export const TEST_SECRET = 'test_session_secret_for_unit_tests_only';
export const TEST_IP = '203.0.113.7';

export function memStorage() {
  const store = new Map();
  let alarm = null;
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  return {
    store,
    get alarmAt() { return alarm; },
    async get(k) { return clone(store.get(k)); },
    async put(k, v) { store.set(k, clone(v)); },
    async delete(k) {
      for (const key of Array.isArray(k) ? k : [k]) store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, clone(v)]));
    },
    async setAlarm(t) { alarm = t; },
    async getAlarm() { return alarm; },
    async deleteAlarm() { alarm = null; },
  };
}

export function fakeNamespace(Cls, env = {}) {
  const instances = new Map();
  return {
    instances,
    names: [],
    idFromName(n) { this.names.push(n); return n; },
    get(id) {
      if (!instances.has(id)) instances.set(id, new Cls({ storage: memStorage() }, env));
      const obj = instances.get(id);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    },
  };
}

export function abuseEnv(extra = {}) {
  return {
    SESSION_SECRET: TEST_SECRET,
    BUDGET: fakeNamespace(Budget),
    RATE_LIMIT: fakeNamespace(RateLimit),
    ...extra,
  };
}

export async function sessionFor(env, ip = TEST_IP, now = Date.now()) {
  const { token } = await signSession(env.SESSION_SECRET, await hashIp(ip, env.SESSION_SECRET), now);
  return token;
}

export async function authHeaders(env, ip = TEST_IP, extra = {}) {
  return { 'cf-connecting-ip': ip, 'x-krai-session': await sessionFor(env, ip), ...extra };
}
