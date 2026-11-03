// Live trap-line pacing in the browser (public/pace.js): trim + WSOLA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimPauses, wsola } from '../public/pace.js';

const SR = 24000;
const tone = (sec, hz = 220, amp = 0.3) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const silence = (sec) => new Float32Array(Math.round(sec * SR));
const cat = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const zeroCrossingsPerSec = (x) => {
  let z = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
  return z / (x.length / SR);
};

test('trimPauses: edges trimmed, a 1 s pause cut to 250 ms, short pauses kept', () => {
  const x = cat(silence(0.5), tone(1), silence(1), tone(1), silence(0.15), tone(0.5), silence(0.8));
  const y = trimPauses(x, SR);
  const sec = y.length / SR;
  // 2.5 s of tone + 0.25 s cut pause + 0.15 s short pause + 2 x 30 ms edges
  assert.ok(Math.abs(sec - (2.5 + 0.25 + 0.15 + 0.06)) < 0.04, `got ${sec}`);
  assert.equal(trimPauses(silence(1), SR).length, 0);
});

test('wsola: 1.3x faster, same pitch', () => {
  const x = tone(2, 220);
  const y = wsola(x, 1.3, SR);
  assert.ok(Math.abs(y.length / SR - 2 / 1.3) < 0.01);
  const fx = zeroCrossingsPerSec(x);
  const fy = zeroCrossingsPerSec(y.subarray(SR * 0.1, y.length - SR * 0.1));
  assert.ok(Math.abs(fy - fx) / fx < 0.03, `pitch moved: ${fx} -> ${fy}`);
  assert.equal(wsola(x, 1, SR), x, 'tempo 1 is a no-op');
});

test('voice-client paces live trap lines with the manifest tempo; fallback voice is brisk', () => {
  const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'voice-client.js'), 'utf8');
  assert.match(js, /import \{ paceBuffer \} from '\.\/pace\.js';/);
  assert.match(js, /paceBuffer\(playbackCtx\(\), raw, Number\(m\?\.liveTempo\) \|\| 1\)/);
  assert.match(js, /u\.rate = 1\.1;/);
});
