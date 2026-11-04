#!/usr/bin/env node
// Record the /demo-live recorded calls: play each call's caller audio into the
// REAL pipeline (a local `wrangler dev` of this repo, which calls the Meta
// Model API: Muse Voice Transcribe, Muse Spark, Muse Wonder) through the page's
// `?record=1` mode, and merge every server answer (with its measured latency)
// into app/public/demo-calls.json. Playback then replays one real run, unedited.
//
//   (cd app && npx wrangler dev --port 8790)   # needs app/.dev.vars with the Meta key
//   BUILD=$(git rev-parse --short HEAD) node scripts/demo-capture.mjs [call-id ...]
//
// Headless, muted Chromium from the global @playwright/mcp install. Costs a few cents of
// Meta usage per call; nothing on Gemini (caller audio is already in audio/calls).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = execSync('npm root -g').toString().trim();
const pw = await import(pathToFileURL(path.join(root, '@playwright', 'mcp', 'node_modules', 'playwright', 'index.js')).href);
const chromium = pw.chromium || pw.default.chromium;
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public', 'demo-calls.json');
const BASE = process.env.BASE || 'http://127.0.0.1:8790';
const only = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Headless and muted by default (nothing pops up, nothing plays); HEADED=1 to watch.
const browser = await chromium.launch({ headless: !process.env.HEADED, channel: process.env.PW_CHANNEL || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('close', () => console.log('PAGE CLOSED'));
browser.on('disconnected', () => console.log('BROWSER DISCONNECTED'));
try {
  await page.goto(BASE + '/demo-live.html?record=1', { waitUntil: 'load', timeout: 90000 }); await page.waitForFunction(() => window.kraiDemo, null, { timeout: 60000 });
  await page.evaluate(() => window.kraiSetLang('en'));
  await page.mouse.click(5, 5);
  for (const c of data.calls) {
    if (only.length && !only.includes(c.id)) continue;
    const t0 = Date.now();
    await page.evaluate((id) => window.kraiDemo.play(id), c.id);
    await page.waitForFunction((id) => window.kraiRecording?.id === id && window.kraiRecording.done, c.id, { timeout: 240000, polling: 500 });
    const r = await page.evaluate(() => JSON.parse(JSON.stringify(window.kraiRecording)));
    c.api = r.api;
    r.turns.forEach((t, i) => { if (t && c.turns[i]) Object.assign(c.turns[i], { transcript: t.transcript, asrMs: t.asrMs, asrModel: t.model }); });
    c.recordedMs = Date.now() - t0;
    const verdicts = r.api.filter((a) => a.path === '/api/verdict/turn').map((a) => `${a.data.policy?.verdict}${Math.round((a.data.policy?.confidence || 0) * 100)} ${a.ms}ms`);
    const rep = r.api.filter((a) => a.path === '/api/report').map((a) => `${a.lang}:${a.data.report?.verdict}/${a.data.source}`);
    console.log(c.id, '| turns', r.turns.filter(Boolean).length, '| verdicts', verdicts.join(', '), '| t1', r.api.filter((a) => a.path === '/api/verdict/t1').map((a) => a.data.t1 || '-').join(','), '| wonder', r.api.filter((a) => a.path === '/api/verdict/escalate').length, '| report', rep.join(' '));
    for (const t of r.turns) if (t) console.log('   asr:', t.transcript);
    data.recordedAt = new Date().toISOString();
    data.build = process.env.BUILD || execSync('git rev-parse --short HEAD').toString().trim();
    data.base = 'local wrangler dev of this repo -> Meta Model API (Muse Voice Transcribe, Muse Spark, Muse Wonder)';
    fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
    await page.waitForTimeout(1500);
  }
  console.log('errors:', errs.length ? errs.join('\n') : 'none');
} finally {
  await browser.close();
}
