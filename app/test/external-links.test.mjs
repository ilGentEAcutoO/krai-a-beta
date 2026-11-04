// Every off-site link on the public pages opens in a new tab without leaking the opener or referrer.
// Scans raw HTML, so links inside data-th / data-en strings (swapped in by the language toggle) count too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PAGES = ['index.html', 'proof.html', 'arena.html', 'showdown.html', 'demo-live.html'];
const TAG = /<a\s[^<>]*?>/g;

export function offsiteLinkProblems(html) {
  const bad = [];
  for (const [tag] of html.matchAll(TAG)) {
    const h = tag.match(/href=(["'])(https?:\/\/[^"']*)\1/);
    if (!h || /^https?:\/\/beta\.krai-a\.com(\/|$)/.test(h[2])) continue;
    const target = tag.match(/target=(["'])([^"']*)\1/);
    const rel = tag.match(/rel=(["'])([^"']*)\1/);
    const rels = rel ? rel[2].split(/\s+/) : [];
    if (!target || target[2] !== '_blank' || !rels.includes('noopener') || !rels.includes('noreferrer')) bad.push(tag);
  }
  return bad;
}

for (const page of PAGES) {
  test(`${page}: every off-site link has target="_blank" rel="noopener noreferrer"`, () => {
    const html = fs.readFileSync(path.join(PUB, page), 'utf8');
    assert.deepEqual(offsiteLinkProblems(html), []);
  });
}

test('the external-link rule catches a bare off-site link and passes a correct one', () => {
  assert.equal(offsiteLinkProblems('<a href="https://example.com">x</a>').length, 1);
  assert.equal(offsiteLinkProblems("<a href='https://example.com' rel='noopener'>x</a>").length, 1);
  assert.equal(offsiteLinkProblems('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>').length, 0);
  assert.equal(offsiteLinkProblems('<a href="/proof.html">x</a><a href="https://beta.krai-a.com/x">y</a>').length, 0);
});
