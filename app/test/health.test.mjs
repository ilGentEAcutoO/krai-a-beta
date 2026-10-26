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
