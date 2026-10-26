// Build the committed few-shot bundle from the train corpus only.
// Curated ids (explicit, reviewable): 4 SCAM + 4 LEGIT + 2 UNSURE covering
// the hard patterns (injection, no-keyword tricks, slow-burn, money/authority
// lookalikes). Sealed ids are rejected here, not just by convention.
// Usage: node scripts/build-fewshot.mjs  (writes app/src/fewshot.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PICKS = [
  // SCAM: the classic, the keyword trick, the polite injection, the slow burn
  'scam-police-summons',
  'scam-card-read-digits',
  'scam-inject-note-th',
  'scam-sso-slow-burn',
  // LEGIT: the callback, the money lookalike, the authority lookalike, the family lookalike
  'legit-bank-callback',
  'legit-parcel-cod',
  'legit-police-report-followup',
  'legit-relative-new-number',
  // UNSURE: the harvester, the grey collector
  'unsure-survey-birthyear',
  'unsure-debt-collector',
];

const train = fs.readFileSync(path.join(ROOT, 'corpus', 'thai-tactics.jsonl'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
const sealedIds = new Set(fs.readFileSync(path.join(ROOT, 'corpus', 'sealed.jsonl'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l).id));
const byId = new Map(train.map((c) => [c.id, c]));

const cases = PICKS.map((id) => {
  if (sealedIds.has(id)) throw new Error(`sealed id in few-shot picks: ${id}`);
  const c = byId.get(id);
  if (!c) throw new Error(`pick not in train corpus: ${id}`);
  return { id: c.id, class: c.class, category: c.category, turns: c.turns, verdict: c.class, tactic: c.category };
});
const categories = [...new Set(train.map((c) => c.category))].sort();

const bundle = {
  version: 1,
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'corpus/thai-tactics.jsonl (v2-port + b3-new only; never sealed)',
  cases,
  categories,
};
const out = path.join(ROOT, 'app', 'src', 'fewshot.json');
fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`wrote ${out}: ${cases.length} cases, ${categories.length} categories`);
