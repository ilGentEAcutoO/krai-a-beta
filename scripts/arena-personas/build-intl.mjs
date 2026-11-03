// Builds scripts/arena-personas/intl.json (B27 regional catalog) from intl.mjs
// and validates it with the same closed sets and rules as edge.json.
//   node scripts/arena-personas/build-intl.mjs          build + validate
//   node scripts/arena-personas/build-intl.mjs --check  validate intl.json only (exit 1 on drift or error)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLS_OF, DEFAULT_NEVER, DIALECTS, EXPECTED, INPUTS, MUST_NEVER } from './catalog.mjs';
import { REAL_NAMES } from './build-edge.mjs';
import { EN, INTL_LANGS, REGIONS, ZH, probeFamilies } from './intl.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'intl.json');

// Real regional banks, couriers, platforms and telcos the catalog must not name.
const REAL_NAMES_INTL = [
  'dbs', 'posb', 'ocbc', 'maybank', 'public bank', 'rhb', 'hong leong', 'hsbc', 'standard chartered', 'bank of china', 'icbc', 'hdfc', 'icici', 'sbi ',
  'commbank', 'commonwealth bank', 'westpac', ' anz', ' nab ', 'bdo', 'metrobank', ' bpi', 'gcash', 'paymaya', 'paytm', 'phonepe', 'google pay', 'apple pay', 'paynow', 'duitnow',
  'singpost', 'pos malaysia', 'auspost', 'australia post', 'india post', 'sf express', 'jd.com', 'shopee', 'lazada', 'carousell', 'amazon', 'flipkart', 'taobao', 'tmall', 'alipay', 'wechat', 'zoom', 'anydesk', 'teamviewer', 'telegram',
  'singtel', 'starhub', 'telstra', 'optus', 'globe telecom', 'smart communications', 'airtel', ' jio', 'celcom', ' digi ', 'chunghwa',
  '支付宝', '微信', '淘宝', '京东', '顺丰', '中国银行', '工商银行', '建设银行', '农业银行', '招商银行', '中华电信', '国泰', '拼多多', '抖音',
];
const LONG_NUM = /\+?\d[\d\s-]{6,}\d/g;
const PROBE_FAMILY = { HELP_MESSAGE: 'everyday', URGENT_MESSAGE: 'emergency', POLITE_CLOSE_NUISANCE: 'nuisance', DECLINE_SALES: 'sales', SCAM_BLOCK: 'scam', TRAP_OK: 'scam', HARASSMENT_RECORD: 'harassment' };

export function build() {
  const personas = [];
  const groups = { en: EN, zh: ZH, probe: probeFamilies() };
  for (const [group, fams] of Object.entries(groups)) {
    for (const [family, rows] of Object.entries(fams)) {
      for (const [id, gender, lang, region, expected, brief, realism, opts = {}] of rows) {
        const cls = CLS_OF[expected];
        const role = opts.role || (cls === 'scam' ? 'scam' : cls === 'nuisance' ? 'disruptive' : 'legit');
        const mustNever = opts.never ? [...opts.never] : [...new Set([...(DEFAULT_NEVER[expected] || []), ...(opts.addNever || [])])];
        personas.push({
          id, group, family: group === 'probe' ? `probe-${PROBE_FAMILY[expected]}` : family, cls, role, gender, lang, region,
          dialect: opts.dialect || null, input: opts.input || 'speech', tactic: opts.tactic || family, expected, mustNever, brief, realism,
        });
      }
    }
  }
  return { version: 1, generated: 'scripts/arena-personas/build-intl.mjs from intl.mjs', expectedSet: EXPECTED, mustNeverSet: MUST_NEVER, personas };
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
    if (!INTL_LANGS.includes(p.lang)) errs.push(`${at}: bad lang ${p.lang}`);
    if (!REGIONS.includes(p.region)) errs.push(`${at}: bad region ${p.region}`);
    if (!DIALECTS.includes(p.dialect)) errs.push(`${at}: bad dialect ${p.dialect}`);
    if (!INPUTS.includes(p.input)) errs.push(`${at}: bad input`);
    if (!Array.isArray(p.mustNever) || !p.mustNever.length) errs.push(`${at}: mustNever empty`);
    for (const m of p.mustNever || []) if (!MUST_NEVER.includes(m)) errs.push(`${at}: mustNever ${m} not in closed set`);
    if (typeof p.brief !== 'string' || p.brief.length < 40) errs.push(`${at}: brief too short`);
    if (typeof p.realism !== 'string' || !p.realism) errs.push(`${at}: realism missing`);
    if (p.cls === 'scam' && p.mustNever.includes('NEVER_SCAM_LABEL')) errs.push(`${at}: scam persona cannot forbid the scam label`);
    if (p.expected === 'URGENT_MESSAGE' && !p.mustNever.includes('NEVER_BLOCK')) errs.push(`${at}: emergencies must carry NEVER_BLOCK`);
    const text = ` ${p.brief} ${p.realism} `.toLowerCase();
    for (const n of [...REAL_NAMES, ...REAL_NAMES_INTL]) if (text.includes(n)) errs.push(`${at}: real brand/name "${n.trim()}"`);
    for (const num of text.match(LONG_NUM) || []) if (!/555/.test(num.replace(/\D/g, ''))) errs.push(`${at}: number ${num} not in the 555 range`);
  }
  return errs;
}

export function counts(doc) {
  const by = (k, ps = doc.personas) => ps.reduce((a, p) => ((a[p[k] ?? 'null'] = (a[p[k] ?? 'null'] || 0) + 1), a), {});
  const out = { total: doc.personas.length, group: by('group'), lang: by('lang') };
  for (const g of ['en', 'zh']) out[`${g}-cls`] = by('cls', doc.personas.filter((p) => p.group === g));
  out['probe-cls (per language)'] = by('cls', doc.personas.filter((p) => p.lang === 'vi'));
  return out;
}

async function main() {
  const ids = [];
  try {
    const src = fs.readFileSync(path.join(DIR, '..', 'arena.mjs'), 'utf8');
    ids.push(...[...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]));
    ids.push(...JSON.parse(fs.readFileSync(path.join(DIR, 'edge.json'), 'utf8')).personas.map((p) => p.id));
  } catch { /* skip clash check */ }
  const fresh = build();
  const check = process.argv.includes('--check');
  const doc = check ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : fresh;
  const errs = validate(doc, ids);
  if (check && JSON.stringify(doc) !== JSON.stringify(fresh)) errs.push('intl.json is stale: rebuild from intl.mjs');
  if (errs.length) {
    console.error(errs.join('\n'));
    console.error(`${errs.length} error(s)`);
    process.exit(1);
  }
  if (!check) fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(JSON.stringify(counts(doc), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
