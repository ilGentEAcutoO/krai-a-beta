// Self-hosted demo videos (R2 bucket krai-a-beta-r2-media, binding R2_MEDIA).
// GET/HEAD /media/v/:key streams an allowlisted object with byte-range support,
// so <video> can seek. No listing, no other keys: anything not in MEDIA_KEYS is 404.
// Cost: R2 egress is free; storage is the few objects below (~ a few hundred MB).

export const MEDIA_KEYS = new Map([
  ['demo-en-v8.mp4', 'video/mp4'],
  ['demo-en-v8-720.mp4', 'video/mp4'],
  ['demo-th-v7.mp4', 'video/mp4'],
  ['demo-th-v7-720.mp4', 'video/mp4'],
  ['poster-en-v8.jpg', 'image/jpeg'],
  ['poster-th-v7.jpg', 'image/jpeg'],
]);

// RFC 9110 single byte range. Returns null (serve whole), 'bad' (416) or {start,end}.
// Multi-range requests are answered with the whole object (allowed by the RFC).
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '') {
    if (m[2] === '') return 'bad';
    const n = Number(m[2]);
    if (n === 0) return 'bad';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || start > end) return 'bad';
  return { start, end };
}

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  return header.split(',').map((s) => s.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag);
}

export function registerMediaRoutes(app) {
  app.on(['GET', 'HEAD'], '/media/v/:key', async (c) => {
    const key = c.req.param('key');
    const type = MEDIA_KEYS.get(key);
    if (!type) return c.json({ ok: false, error: 'not-found' }, 404);
    const bucket = c.env?.R2_MEDIA;
    if (!bucket) return c.json({ ok: false, error: 'media-off' }, 503);

    const meta = await bucket.head(key);
    if (!meta) return c.json({ ok: false, error: 'not-found' }, 404);
    const size = meta.size;
    const etag = meta.httpEtag;
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      ETag: etag,
    };
    if (etagMatches(c.req.header('if-none-match'), etag)) return new Response(null, { status: 304, headers });

    // If-Range: only honour the range when the validator still matches.
    let rangeHeader = c.req.header('range');
    const ifRange = c.req.header('if-range');
    if (rangeHeader && ifRange && ifRange.trim() !== etag) rangeHeader = null;
    const range = parseRange(rangeHeader, size);
    if (range === 'bad') {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }

    const status = range ? 206 : 200;
    const length = range ? range.end - range.start + 1 : size;
    const out = { ...headers, 'Content-Length': String(length) };
    if (range) out['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (c.req.method === 'HEAD') return new Response(null, { status, headers: out });

    const obj = await bucket.get(key, range ? { range: { offset: range.start, length } } : undefined);
    if (!obj) return c.json({ ok: false, error: 'not-found' }, 404);
    return new Response(obj.body, { status, headers: out });
  });
}
