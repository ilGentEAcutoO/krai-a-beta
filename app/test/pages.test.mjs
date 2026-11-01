import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
assert.ok(pages.length > 0, 'expected at least one public page');

for (const page of pages) {
  test(`${page}: inline scripts parse + no external assets + favicon`, () => {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 0);
    for (const [, code] of scripts) {
      if (!code.trim()) continue;
      assert.doesNotThrow(() => new Function(code), `${page}: inline script must parse`);
    }
    for (const [, tag, url] of html.matchAll(/<(script|img)[^>]*\bsrc="([^"]+)"/g)) {
      assert.ok(!/^https?:/.test(url), `${page}: <${tag}> must not load external ${url}`);
    }
    for (const [, url] of html.matchAll(/<link[^>]*\bhref="([^"]+)"/g)) {
      assert.ok(!/^https?:/.test(url), `${page}: <link> must not load external ${url}`);
    }
    assert.match(html, /<link rel="icon"/, `${page}: needs an inline favicon (no 404)`);
  });
}

test('demo-live: no-mic controls exist (type instead + sample replay + inline API notice)', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'demo-live.html'), 'utf8');
  for (const id of ['typeForm', 'typeInput', 'typeBtn', 'replaySelect', 'replayBtn', 'replayStopBtn', 'replayStatus', 'apiNotice']) {
    assert.match(html, new RegExp(`id="${id}"`), `demo-live.html: missing #${id}`);
  }
  assert.match(html, /<label for="typeInput"/, 'typed input needs a label');
  assert.match(html, /<label for="replaySelect"/, 'sample picker needs a label');
});

test('public pages + client scripts never use window.alert / confirm / prompt', () => {
  const files = fs.readdirSync(PUBLIC).filter((f) => /\.(html|js)$/.test(f));
  for (const f of files) {
    const code = fs.readFileSync(path.join(PUBLIC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /(^|[^\w.])(window\.)?(alert|confirm|prompt)\s*\(/m, `${f}: use an inline notice, not a browser dialog`);
  }
});

test('demo-live: typed and replayed lines reuse the voice event path', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'voice-client.js'), 'utf8');
  assert.match(js, /fetch\('\.\/samples\.json'\)/);
  assert.doesNotMatch(js, /sealed\.jsonl/);
  // callerLine feeds onEvent (speech-start / partial / final) — no forked judge call.
  const body = js.slice(js.indexOf('async function callerLine'));
  assert.match(body, /onEvent\(\{ type: 'speech-start'/);
  assert.match(body, /onEvent\(\{ type: 'final'/);
  assert.equal((js.match(/apiJson\('\/api\/verdict\/turn'/g) || []).length, 1, 'one judge call site');
});

test('samples.json: valid bundle', () => {
  const data = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'samples.json'), 'utf8'));
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.samples) && data.samples.length >= 6);
  for (const s of data.samples) {
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(['SCAM', 'LEGIT', 'UNSURE'].includes(s.class));
    assert.ok(Array.isArray(s.turns) && s.turns.length > 0 && s.turns.every((t) => typeof t === 'string' && t.trim()));
  }
  const sealed = fs.readFileSync(path.join(PUBLIC, '..', '..', 'corpus', 'sealed.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).id);
  for (const s of data.samples) assert.ok(!sealed.includes(s.id), `sealed id in samples.json: ${s.id}`);
});
