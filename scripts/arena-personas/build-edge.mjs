// Builds scripts/arena-personas/edge.json from catalog.mjs and validates it.
//   node scripts/arena-personas/build-edge.mjs          build + validate
//   node scripts/arena-personas/build-edge.mjs --check  validate edge.json only (exit 1 on drift or error)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLS_OF, DEFAULT_NEVER, DIALECTS, EXPECTED, FAMILIES, INPUTS, MUST_NEVER } from './catalog.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'edge.json');

// Real Thai / regional brands and services the catalog must not name.
export const REAL_NAMES = [
  'kerry', 'flash express', 'j&t', 'ninja van', 'dhl', 'fedex', 'ups ', 'lalamove', 'grab', 'lineman', 'line man', 'foodpanda', 'robinhood',
  'shopee', 'lazada', 'tiktok', 'facebook', 'messenger', 'whatsapp', 'line id', 'แอดไลน์', 'ไลน์', 'promptpay', 'พร้อมเพย์', 'truemoney', 'true money',
  'kbank', 'kasikorn', 'กสิกร', 'scb', 'ไทยพาณิชย์', 'krungthai', 'กรุงไทย', 'bangkok bank', 'ธนาคารกรุงเทพ', 'krungsri', 'กรุงศรี', 'ttb', 'ทหารไทย',
  'gsb', 'ออมสิน', 'baac', 'ธ.ก.ส', 'uob', 'cimb', 'citibank', 'aeon', 'อิออน', 'ktc',
  ' ais', 'เอไอเอส', 'dtac', 'ดีแทค', 'truemove', 'ทรูมูฟ', '3bb', 'nt mobile',
  '7-eleven', 'เซเว่น', 'big c', 'บิ๊กซี', 'lotus', 'โลตัส', 'makro', 'แม็คโคร',
  'aia', 'เมืองไทยประกัน', 'allianz', 'fwd', 'ไทยประกันชีวิต',
  'bumrungrad', 'บำรุงราษฎร์', 'bangkok hospital', 'โรงพยาบาลกรุงเทพ', 'siriraj', 'ศิริราช', 'ramathibodi', 'รามาธิบดี', 'จุฬาลงกรณ์', 'samitivej', 'สมิติเวช',
  'ไปรษณีย์ไทย', 'thailand post', 'ปอเต็กตึ๊ง', 'ร่วมกตัญญู',
];
const PHONE = /\b0\d{1,2}-?\d{3}-?\d{4}\b/g;

export function build() {
  const personas = [];
  for (const [family, rows] of Object.entries(FAMILIES)) {
    for (const [id, gender, lang, dialect, expected, brief, realism, opts = {}] of rows) {
      const cls = CLS_OF[expected];
      const role = opts.role || (cls === 'scam' ? 'scam' : cls === 'nuisance' ? 'disruptive' : 'legit');
      const mustNever = opts.never ? [...opts.never] : [...new Set([...(DEFAULT_NEVER[expected] || []), ...(opts.addNever || [])])];
      personas.push({ id, family, cls, role, gender, lang, dialect, input: opts.input || 'speech', tactic: opts.tactic || family, expected, mustNever, brief, realism });
    }
  }
  return { version: 1, generated: 'scripts/arena-personas/build-edge.mjs from catalog.mjs', expectedSet: EXPECTED, mustNeverSet: MUST_NEVER, personas };
}

export function validate(doc, existingIds = []) {
  const errs = [];
  const seen = new Set(existingIds);
  for (const p of doc.personas) {
    const at = `persona ${p.id}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) errs.push(`${at}: id not kebab-case`);
    if (seen.has(p.id)) errs.push(`${at}: duplicate id`);
    seen.add(p.id);
    if (!EXPECTED.includes(p.expected)) errs.push(`${at}: expected ${p.expected} not in closed set`);
    if (!['legit', 'scam', 'nuisance'].includes(p.cls)) errs.push(`${at}: bad cls`);
    if (!['legit', 'scam', 'disruptive'].includes(p.role)) errs.push(`${at}: bad role`);
    if (!['m', 'f'].includes(p.gender)) errs.push(`${at}: bad gender`);
    if (!['th', 'en', 'mixed'].includes(p.lang)) errs.push(`${at}: bad lang`);
    if (!DIALECTS.includes(p.dialect)) errs.push(`${at}: bad dialect ${p.dialect}`);
    if (!INPUTS.includes(p.input)) errs.push(`${at}: bad input`);
    if (!Array.isArray(p.mustNever) || !p.mustNever.length) errs.push(`${at}: mustNever empty`);
    for (const m of p.mustNever || []) if (!MUST_NEVER.includes(m)) errs.push(`${at}: mustNever ${m} not in closed set`);
    if (typeof p.brief !== 'string' || p.brief.length < 40) errs.push(`${at}: brief too short`);
    if (typeof p.realism !== 'string' || !p.realism) errs.push(`${at}: realism missing`);
    // consistency between expected and must-never rules
    const scamLike = p.cls === 'scam';
    if (scamLike && p.mustNever.includes('NEVER_SCAM_LABEL')) errs.push(`${at}: scam persona cannot forbid the scam label`);
    if (['URGENT_MESSAGE'].includes(p.expected) && !p.mustNever.includes('NEVER_BLOCK')) errs.push(`${at}: emergencies must carry NEVER_BLOCK`);
    const text = ` ${p.brief} ${p.realism} `.toLowerCase();
    for (const n of REAL_NAMES) if (text.includes(n)) errs.push(`${at}: real brand/name "${n.trim()}"`);
    for (const num of text.match(PHONE) || []) if (!/555/.test(num)) errs.push(`${at}: phone ${num} not in the 555 range`);
  }
  return errs;
}

export function counts(doc) {
  const by = (k) => doc.personas.reduce((a, p) => ((a[p[k] ?? 'null'] = (a[p[k] ?? 'null'] || 0) + 1), a), {});
  return { total: doc.personas.length, family: by('family'), expected: by('expected'), cls: by('cls'), lang: by('lang'), dialect: by('dialect'), input: by('input') };
}

async function main() {
  // ids already used by arena.mjs's built-in lists must not clash
  let builtIn = [];
  try {
    const src = fs.readFileSync(path.join(DIR, '..', 'arena.mjs'), 'utf8');
    builtIn = [...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);
  } catch { /* arena.mjs absent: skip clash check */ }
  const fresh = build();
  const check = process.argv.includes('--check');
  const doc = check ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : fresh;
  const errs = validate(doc, builtIn);
  if (check && JSON.stringify(doc) !== JSON.stringify(fresh)) errs.push('edge.json is stale: rebuild from catalog.mjs');
  if (errs.length) {
    console.error(errs.join('\n'));
    console.error(`${errs.length} error(s)`);
    process.exit(1);
  }
  if (!check) fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(JSON.stringify(counts(doc), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
