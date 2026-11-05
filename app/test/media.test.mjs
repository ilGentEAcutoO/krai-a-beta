import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';
import { MEDIA_KEYS, parseRange } from '../src/media.js';

const BYTES = new Uint8Array(1000).map((_, i) => i % 251);
function fakeBucket() {
  const calls = [];
  return {
    calls,
    async head(key) { calls.push(['head', key]); return MEDIA_KEYS.has(key) ? { size: BYTES.length, httpEtag: '"abc"' } : null; },
    async get(key, opts) {
      calls.push(['get', key, opts]);
      if (!MEDIA_KEYS.has(key)) return null;
      const r = opts?.range;
      const slice = r ? BYTES.slice(r.offset, r.offset + r.length) : BYTES;
      return { body: new Response(slice).body, size: BYTES.length, httpEtag: '"abc"' };
    },
  };
}
const req = (path, init = {}, env = { R2_MEDIA: fakeBucket() }) => app.request(path, init, env);

test('parseRange: open, closed, suffix, out of range, malformed', () => {
  assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'bad');
  assert.equal(parseRange('bytes=5-2', 1000), 'bad');
  assert.equal(parseRange('bytes=-0', 1000), 'bad');
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
  assert.equal(parseRange(null, 1000), null);
});

test('GET /media/v/:key streams the whole allowlisted object', async () => {
  const res = await req('/media/v/demo-en-v8.mp4');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-length'), '1000');
  assert.equal(res.headers.get('etag'), '"abc"');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal((await res.arrayBuffer()).byteLength, 1000);
});

test('Range request returns 206 with Content-Range and the exact bytes', async () => {
  const res = await req('/media/v/demo-th-v7.mp4', { headers: { Range: 'bytes=100-199' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(res.headers.get('content-length'), '100');
  const got = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...got], [...BYTES.slice(100, 200)]);
});

test('unsatisfiable range is 416; matching ETag is 304; stale If-Range serves the whole object', async () => {
  const r416 = await req('/media/v/demo-en-v8.mp4', { headers: { Range: 'bytes=5000-' } });
  assert.equal(r416.status, 416);
  assert.equal(r416.headers.get('content-range'), 'bytes */1000');
  const r304 = await req('/media/v/demo-en-v8.mp4', { headers: { 'If-None-Match': '"abc"' } });
  assert.equal(r304.status, 304);
  const stale = await req('/media/v/demo-en-v8.mp4', { headers: { Range: 'bytes=0-9', 'If-Range': '"old"' } });
  assert.equal(stale.status, 200);
});

test('HEAD answers headers only; ranged HEAD is 206', async () => {
  const env = { R2_MEDIA: fakeBucket() };
  const h = await req('/media/v/poster-en-v8.jpg', { method: 'HEAD' }, env);
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('content-type'), 'image/jpeg');
  assert.equal(h.headers.get('content-length'), '1000');
  const hr = await req('/media/v/demo-en-v8.mp4', { method: 'HEAD', headers: { Range: 'bytes=0-1' } }, env);
  assert.equal(hr.status, 206);
  assert.ok(!env.R2_MEDIA.calls.some((c) => c[0] === 'get'), 'HEAD never reads the body');
});

test('only allowlisted keys: anything else is 404 and never touches the bucket; no listing', async () => {
  for (const path of ['/media/v/secret.mp4', '/media/v/..%2Fdemo-en-v8.mp4', '/media/v/']) {
    const env = { R2_MEDIA: fakeBucket() };
    const res = await req(path, {}, env);
    assert.equal(res.status, 404, path);
    assert.equal(env.R2_MEDIA.calls.length, 0, path);
  }
  const post = await req('/media/v/demo-en-v8.mp4', { method: 'POST' });
  assert.equal(post.status, 404);
});

test('without the R2 binding the route answers 503 media-off', async () => {
  const res = await app.request('/media/v/demo-en-v8.mp4', {}, {});
  assert.equal(res.status, 503);
});
