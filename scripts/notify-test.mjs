#!/usr/bin/env node
// Send one SAMPLE case report to your own chat, to check a delivery adapter.
//
//   cd app
//   npm run notify:test -- --channel telegram            # or whatsapp | line | all
//   npm run notify:test -- --channel line --dry-run      # print the message, send nothing
//
// Reads the channel's env vars from app/.dev.vars (or the process env). The
// sample is fixed fake data, never a real call. Tokens are never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildReport } from '../app/src/report.js';
import { ADAPTERS, notifyReport } from '../app/src/notify/index.js';
import { formatReport } from '../app/src/notify/format.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const channel = arg('channel');
const dryRun = args.includes('--dry-run');
const names = Object.keys(ADAPTERS);
if (!channel || (channel !== 'all' && !names.includes(channel))) {
  console.error(`usage: npm run notify:test -- --channel <${names.join('|')}|all> [--dry-run]`);
  process.exit(2);
}

function loadDevVars(path) {
  const out = {};
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
const env = { ...loadDevVars(join(here, '..', 'app', '.dev.vars')), ...process.env };

const C = (text) => ({ role: 'caller', text });
const A = (text) => ({ role: 'ai', text });
const turns = [
  A('ระบบผู้ช่วยรับสายอัตโนมัติรับสายแทนเจ้าของเบอร์ ขอทราบชื่อและธุระค่ะ'),
  C('ผมร้อยตำรวจเอกสมชาย จาก สภ.เมือง (ตัวอย่างทดสอบ) มีหมายจับคดีฟอกเงินในชื่อคุณ'),
  C('ต้องโอนเงินไปตรวจสอบที่บัญชี 123-4-56789-0 ธนาคารกสิกร แล้วแอดไลน์ @sample-test'),
];
const report = buildReport({
  model: {
    claimedIdentity: { value: 'ร้อยตำรวจเอกสมชาย สภ.เมือง', quote: 'ผมร้อยตำรวจเอกสมชาย จาก สภ.เมือง' },
    tactic: 'fake-police', callType: 'scam', verdict: 'SCAM', confidence: 0.9, intel: [],
  },
  turns,
});
report.headlineTh = `[ทดสอบ] ${report.headlineTh}`;

if (dryRun) {
  console.log(formatReport(report));
  process.exit(0);
}
const chosen = channel === 'all' ? names : [channel];
const missing = chosen.filter((n) => !ADAPTERS[n].configured(env));
if (missing.length) {
  console.error(`not configured: ${missing.join(', ')} (see docs/ADAPTERS.md for the env vars)`);
  if (missing.length === chosen.length) process.exit(1);
}
// force: bypasses NOTIFY_ENABLED, dedupe and the hourly cap for this manual test only.
const results = await notifyReport(report, env, { channels: chosen, force: true, log: () => {} });
for (const r of results) console.log(`${r.channel}: ${r.ok ? `sent (id ${r.id})` : `FAILED ${r.error}`}`);
process.exit(results.length && results.every((r) => r.ok) ? 0 : 1);
