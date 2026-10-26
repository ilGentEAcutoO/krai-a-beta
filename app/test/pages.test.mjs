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
