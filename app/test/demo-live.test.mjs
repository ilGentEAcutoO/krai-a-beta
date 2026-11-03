import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCLOSURE_LINE_EN, DISCLOSURE_LINE_TH } from '../src/trap.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const js = fs.readFileSync(path.join(PUBLIC, 'voice-client.js'), 'utf8');
const html = fs.readFileSync(path.join(PUBLIC, 'demo-live.html'), 'utf8');

test('demo-live opens every call with the server disclosure line (G3)', () => {
  assert.ok(js.includes(`'${DISCLOSURE_LINE_TH}'`), 'TH line copied verbatim');
  assert.ok(js.includes(`'${DISCLOSURE_LINE_EN}'`), 'EN line copied verbatim');
  // mic start, typed line and replay all open the call before judging
  assert.equal((js.match(/\bopenCall\(\);/g) || []).length, 3);
  assert.doesNotMatch(js + html, /ผู้สูงอายุ/, 'trap never plays an elderly person');
});

test('demo-live mounts the family report card at call end (G8)', () => {
  assert.match(js, /import \{ mountReportCard \} from '\.\/report-card\.js';/);
  assert.match(html, /id="reportCard"/);
  assert.match(js, /endCall\('trap-done'\)/);
  assert.match(js, /endCall\('hangup'\)/);
});

test('while our TTS plays the mic sends silence, never a gap (Meta closes slow ingress)', () => {
  assert.match(js, /ws\.send\(speaking \? new ArrayBuffer\(m\.data\.byteLength\) : m\.data\)/);
  assert.doesNotMatch(js, /if \(speaking\) return;/);
});

test('demo-live markup has every element id voice-client.js looks up', () => {
  const ids = new Set([...js.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size >= 20, 'expected the voice-client lookups');
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `demo-live.html: missing #${id}`);
});
