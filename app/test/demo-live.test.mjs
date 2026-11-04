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
  // mic start, typed line, text sample and recorded call all open the call first
  assert.equal((js.match(/\bopenCall\((?:[\w.]+)?\);/g) || []).length, 4);
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

test('live call: silence after our last line ends the call politely (idle timeout)', () => {
  assert.match(js, /export const IDLE_MS = 8000;/);
  const body = js.slice(js.indexOf('function armIdle'), js.indexOf('function armIdle') + 700);
  assert.match(body, /endOfCall\(rx\.state\)/, 'says the pass-it-on goodbye');
  assert.match(body, /endCall\('caller-left'\)/, 'then the report, ended by the caller going quiet');
  assert.match(body, /if \(!live \|\|/, 'live calls only');
  // any caller sound cancels it; hanging up clears it
  assert.ok((js.match(/clearIdle\(\);/g) || []).length >= 3);
  assert.match(js, /function stop\(\{ report = true \} = \{\}\) \{\r?\n  clearIdle\(\);/);
});

test('recorded playback: the next caller turn waits for the stage-1 line (held or not) to be queued and spoken', () => {
  assert.match(js, /call\.stage1 = stage1\(/);
  const loop = js.slice(js.indexOf('await recordedTurn(c, i, run);'), js.indexOf('await recordedTurn(c, i, run);') + 200);
  assert.match(loop, /await call\.stage1;[^\n]*\r?\n\s*await speechDone;/);
});

test('replay invariants: caller waits for the AI, a close never hard-cuts the AI mid-word', () => {
  // (1) the next caller turn only after the current AI audio has ended
  const loop = js.slice(js.indexOf('for (let i = 0; i < c.turns.length; i++)'), js.indexOf('await recordedTurn(c, i, run);') + 260);
  assert.match(loop, /await speechDone;/);
  assert.match(loop, /await call\.stage1;[^\n]*\r?\n\s*await speechDone;/);
  // (2) cancelling a question for a close does not stop the sounding line;
  // the next line waits for it (<= 1 s) and then fades it over 150 ms
  const cancel = js.slice(js.indexOf('function cancelAsk'), js.indexOf('function cancelAsk') + 400);
  assert.doesNotMatch(cancel, /stopAudio\(\)/);
  assert.match(cancel, /cancelQueued\(\)/);
  assert.match(js, /export const SOFT_STOP_MS = 1000;/);
  assert.match(js, /export const FADE_MS = 150;/);
  assert.match(js, /linearRampToValueAtTime\(0, t \+ FADE_MS \/ 1000\)/);
  assert.match(js, /if \(who === 'ai'\) await softStopAi\(\);/);
});

test('resting refusals (hourly/daily caps): server words only, no HTTP code or wait suffix, a button to the recorded calls', () => {
  assert.match(js, /this\.resting = data\.resting === true;/);
  const halt = js.slice(js.indexOf('function showHalt'), js.indexOf('function showHalt') + 2200);
  const restBranch = halt.slice(halt.indexOf('if (e.resting) {'), halt.indexOf('} else {'));
  assert.doesNotMatch(restBranch, /HTTP|retryAfter/, 'resting copy has no HTTP code and no wait suffix');
  assert.match(halt, /Play a recorded call/);
  assert.match(halt, /addEventListener\('click', playFeaturedRecorded\)/);
  assert.match(halt, /Live demo is resting/);
  assert.match(js, /async function playFeaturedRecorded\(\)[\s\S]{0,400}window\.kraiDemo\.play\(c\.id\)/);
});
