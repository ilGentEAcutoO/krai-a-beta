// Exact-match verdict cache (new): remembers Thai scam scripts the system
// already judged, so repeat callers never pay for the same verdict twice.
// In-memory LRU + TTL. A D1/KV backing can plug behind this interface later
// (same get/set/stats); the interface is the contract, not the storage.
export function normalizeLine(text) {
  return String(text || '')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cacheKey(callerLines) {
  return callerLines.map(normalizeLine).filter(Boolean).join('\n');
}

export function createCache({ max = 500, ttlMs = 6 * 60 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map(); // key -> { value, expiresAt }
  const stats = { hits: 0, misses: 0, evictions: 0 };

  function get(key) {
    const hit = map.get(key);
    if (!hit) {
      stats.misses += 1;
      return undefined;
    }
    if (hit.expiresAt <= now()) {
      map.delete(key);
      stats.misses += 1;
      return undefined;
    }
    // LRU refresh: re-insert to mark most-recently-used.
    map.delete(key);
    map.set(key, hit);
    stats.hits += 1;
    return hit.value;
  }

  function set(key, value) {
    if (!key) return;
    if (map.has(key)) map.delete(key);
    while (map.size >= max) {
      map.delete(map.keys().next().value);
      stats.evictions += 1;
    }
    map.set(key, { value, expiresAt: now() + ttlMs });
  }

  return {
    get,
    set,
    stats: () => ({ ...stats, size: map.size }),
  };
}
