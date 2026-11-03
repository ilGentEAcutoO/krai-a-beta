#!/usr/bin/env node
// "Redundant question" metric (B12): does the receptionist ask for something
// the caller already gave? It is judged the same way for both builds by an
// independent model, TypeSafe Jev (not Spark, which drives the Meta build's
// choices). For every receptionist line, given the caller lines heard before it:
//   asks          Choice: which detail the line asks for, or none
//   gaveIdentity  Noul: has the caller already said who / which organisation
//   gaveCallback  Noul: has the caller already given a number or channel to call back
//   gavePurpose   Noul: has the caller already said why they are calling
// redundant = the line asks for X while the matching Noul is >= 0.5.
//   node scripts/realuse-questions.mjs --dir eval-results/realuse-<...>
// Writes <dir>/questions.json; realuse-report.mjs folds it into results.json.
// Key: TYPESAFE_API_KEY (env, ~/.typesafe.env, or ../hack-google/app/.env); never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JEV_URL } from '../app/src/baseline/jev.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIR = path.resolve(ROOT, argv[argv.indexOf('--dir') + 1]);
const THRESHOLD = 0.5;
const MODEL = 'jev-latest';

function keyFrom(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    for (const name of ['TYPESAFE_API_KEY', 'TYPESAFE_AI_KEY', 'TYPESAFE_AI_MAC_KEY', 'JEV_KEY']) {
      const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm').exec(txt);
      if (m && m[1].trim()) return m[1].trim();
    }
  } catch { /* no file */ }
  return '';
}
const KEY = process.env.TYPESAFE_API_KEY || keyFrom(path.join(os.homedir(), '.typesafe.env')) || keyFrom(path.resolve(ROOT, '..', 'hack-google', 'app', '.env'));
if (!KEY) throw new Error('no TypeSafe key');

const QUESTIONS = {
  asks: {
    type: 'choice',
    instructions: 'The phone receptionist (an automated answering assistant) just said `receptionistLine` to a caller. Which detail, if any, does this line ask the caller for?',
    criteria: {
      identity: "It asks the caller's name, who they are, or which organisation, office or company they are calling from.",
      callback: 'It asks for a phone number, an official number or another contact channel to call them back.',
      purpose: 'It asks why they are calling, what the matter is, or what they want the owner to do.',
      other: 'It asks something else, for example whether they have anything more to add, or asks them to repeat.',
      none: 'It asks for nothing: it greets, acknowledges, says it will pass a message on, or says goodbye.',
    },
  },
  gaveIdentity: {
    type: 'noul',
    instructions: 'Read `callerSaidSoFar` (everything the caller has said so far in this call). Has the caller already said who they are or which organisation, office or company they are calling from?',
  },
  gaveCallback: {
    type: 'noul',
    instructions: 'Read `callerSaidSoFar` (everything the caller has said so far in this call). Has the caller already given a phone number, an official number or another contact channel to call them back?',
  },
  gavePurpose: {
    type: 'noul',
    instructions: 'Read `callerSaidSoFar` (everything the caller has said so far in this call). Has the caller already said why they are calling (the matter, or what they want)?',
  },
};

async function judge(state) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`jev-http-${res.status}`);
      const data = await res.json();
      const a = data.answers || {};
      return {
        asks: a.asks?.choice ?? null,
        asksDist: a.asks?.distribution ?? null,
        gaveIdentity: a.gaveIdentity?.noul ?? null,
        gaveCallback: a.gaveCallback?.noul ?? null,
        gavePurpose: a.gavePurpose?.noul ?? null,
        model: data.model || MODEL,
      };
    } catch (e) {
      if (attempt === 2) return { error: String(e.message) };
    }
  }
  return { error: 'unreachable' };
}

// Receptionist lines with the caller lines heard before each, per call.
function linesOf(run, call) {
  const finals = (call.finals || []).filter((f) => f.text).map((f) => ({ atMs: f.atMs, text: f.text }));
  let said;
  if (run.engine === 'v1') said = (call.replies || []).filter((r) => r.reply).map((r) => ({ atMs: r.atMs, text: r.reply }));
  else said = (call.speech || []).filter((x) => x.text).map((x) => ({ atMs: x.atMs, text: x.text, kind: x.kind || x.source }));
  return said.map((l) => ({ ...l, callerSaidSoFar: finals.filter((f) => f.atMs <= l.atMs).map((f) => f.text) }));
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const files = fs.readdirSync(DIR).filter((f) => /^(meta|v1)-.*\.json$/.test(f));
const result = { judgedAt: new Date().toISOString(), judge: MODEL, threshold: THRESHOLD, runs: {} };
for (const f of files) {
  const run = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const name = f.replace(/\.json$/, '');
  const jobs = [];
  for (const call of run.calls.filter((c) => !c.fatal)) {
    for (const l of linesOf(run, call)) jobs.push({ call: `${call.id}-${call.lang}`, ...l });
  }
  const judged = await pool(jobs, 6, async (j) => ({ ...j, ...(await judge({ receptionistLine: j.text, callerSaidSoFar: j.callerSaidSoFar })) }));
  for (const j of judged) {
    const given = { identity: j.gaveIdentity, callback: j.gaveCallback, purpose: j.gavePurpose }[j.asks];
    j.redundant = given != null && given >= THRESHOLD;
  }
  const questions = judged.filter((j) => ['identity', 'callback', 'purpose'].includes(j.asks));
  result.runs[name] = {
    lines: judged.length,
    errors: judged.filter((j) => j.error).length,
    questions: questions.length,
    redundant: questions.filter((j) => j.redundant).length,
    byKind: Object.fromEntries(['identity', 'callback', 'purpose'].map((k) => [k, {
      asked: questions.filter((j) => j.asks === k).length,
      redundant: questions.filter((j) => j.asks === k && j.redundant).length,
    }])),
    items: judged,
  };
  const r = result.runs[name];
  console.log(`${name.padEnd(26)} lines ${r.lines}  questions ${r.questions}  redundant ${r.redundant}  errors ${r.errors}`);
}
fs.writeFileSync(path.join(DIR, 'questions.json'), JSON.stringify(result, null, 2));
console.log('wrote', path.relative(ROOT, path.join(DIR, 'questions.json')));
