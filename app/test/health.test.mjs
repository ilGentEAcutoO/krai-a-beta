import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';

test('GET /api/health returns ok + build identity', async () => {
  const res = await app.request('/api/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.app, 'krai-a-beta');
  assert.equal(body.track, 'indie-solo');
  assert.ok(Date.parse(body.now), 'now must be a parseable timestamp');
});

test('unknown /api route returns typed 404', async () => {
  const res = await app.request('/api/nope');
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'not-found');
});

test('P2: /api responses carry nosniff, referrer policy and no-framing headers', async () => {
  const check = (res) => {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  };
  check(await app.request('/api/health'));
  check(await app.request('/api/nope'));
  check(await app.request('/api/config'));
  // Refusals too (a guarded route without a session).
  const refused = await app.request('/api/verdict/turn', { method: 'POST', body: '{}' });
  assert.ok(refused.status >= 400);
  check(refused);
});
