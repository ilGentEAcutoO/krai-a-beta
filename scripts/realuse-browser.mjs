#!/usr/bin/env node
// End-to-end browser check (B12): the real /demo-live page in a HEADED
// Chromium whose microphone is a WAV file (Chromium fake-device flags), so
// the whole path runs: getUserMedia -> AudioWorklet -> relay -> Meta Voice ->
// Spark verdicts -> trap offer. Screenshots go to --out.
//   node scripts/realuse-browser.mjs --base http://localhost:8797 --wav <file.wav> --out <dir> [--seconds 70]
// Playwright comes from the global @playwright/mcp install (PLAYWRIGHT_PATH overrides).
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const BASE = args.base || 'http://localhost:8797';
const WAV = path.resolve(args.wav);
const OUT = path.resolve(args.out || 'agent-temp');
const SECONDS = Number(args.seconds) || 70;
fs.mkdirSync(OUT, { recursive: true });

const pwPath = process.env.PLAYWRIGHT_PATH
  || path.join(execSync('npm root -g').toString().trim(), '@playwright', 'mcp', 'node_modules', 'playwright', 'index.js');
const pw = await import(pathToFileURL(pwPath).href);
const chromium = pw.chromium || pw.default?.chromium;

const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const console_ = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('console', (m) => console_.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => console_.push({ type: 'pageerror', text: String(e.message) }));
  const wsLog = { sentFrames: 0, sentBytes: 0, events: [] };
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => { wsLog.sentFrames += 1; wsLog.sentBytes += f.payload?.length || 0; });
    ws.on('framereceived', (f) => {
      try {
        const m = JSON.parse(String(f.payload));
        if (m.type !== 'partial') wsLog.events.push({ type: m.type, turnId: m.turnId ?? null, text: m.transcript || m.message || '' });
      } catch { /* binary */ }
    });
    ws.on('close', () => wsLog.events.push({ type: 'ws-close' }));
  });
  await page.goto(BASE + '/demo-live', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, 'demo-live-0-idle.png'), fullPage: true });
  await page.click('#micBtn');
  const t0 = Date.now();
  const marks = [];
  let shot = 1;
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(1000);
    const state = await page.evaluate(() => ({
      sess: document.getElementById('sess')?.textContent || '',
      finals: document.querySelectorAll('#transcript .band.final').length,
      chips: [...document.querySelectorAll('#transcript .tier')].map((x) => x.textContent),
      early: document.querySelectorAll('.verdict.early').length,
      trapOffered: !document.getElementById('trapCard').hidden,
    }));
    const key = JSON.stringify([state.finals, state.chips, state.early, state.trapOffered]);
    if (!marks.length || marks[marks.length - 1].key !== key) {
      marks.push({ atS: Math.round((Date.now() - t0) / 1000), key, ...state });
      if (state.chips.length) {
        await page.screenshot({ path: path.join(OUT, `demo-live-${shot++}.png`), fullPage: true });
      }
    }
    if (state.trapOffered && state.chips.filter((c) => c !== 'Escalate').length >= 2) break;
  }
  await page.click('#micBtn').catch(() => {}); // stop listening
  await page.waitForTimeout(500);
  const card = await page.$('#transcript');
  await (card || page).screenshot({ path: path.join(OUT, 'demo-live-result-card.png') });
  await page.screenshot({ path: path.join(OUT, 'demo-live-final.png'), fullPage: true });
  const transcript = await page.evaluate(() => document.getElementById('transcript').innerText);
  fs.writeFileSync(path.join(OUT, 'browser-run.json'), JSON.stringify({ base: BASE, wav: path.basename(WAV), marks, transcript, console: console_, ws: wsLog }, null, 2));
  console.log(JSON.stringify({ ws: { ...wsLog, events: wsLog.events.slice(0, 20) }, marks: marks.map(({ key, ...m }) => m), console: console_.filter((c) => /error|warn/i.test(c.type)) }, null, 2));
  await ctx.close();
} finally {
  await browser.close();
}
