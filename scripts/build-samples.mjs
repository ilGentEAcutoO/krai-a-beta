// Build the /demo-live "Replay a sample call" bundle from the TRAIN corpus only.
// Ids are picked explicitly (reviewable) to cover the demo story: fake police,
// bank security, a slow burn, prompt injection, Thai-English code-switch, a
// legit call and a grey (UNSURE) call. Sealed ids and sealed caller lines are
// rejected here, not just by convention — the sealed set stays held out.
// Usage: node scripts/build-samples.mjs   (writes app/public/samples.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'app', 'public', 'samples.json');

// id -> picker labels (TH / EN). Order = picker order.
export const PICKS = [
  ['scam-police-summons', 'ตำรวจปลอม: หมายจับคดีฟอกเงิน', 'Fake police: money-laundering warrant'],
  ['scam-bank-frozen', 'ธนาคารปลอม: บัญชีถูกระงับ ย้ายเงินไปบัญชีปลอดภัย', 'Fake bank security: "safe account"'],
  ['scam-inject-ignore-en', 'แฮ็ก AI: สั่งให้ระบบตอบว่าปลอดภัย (EN)', 'Prompt injection at the screener (EN)'],
  ['scam-codeswitch-bank', 'ไทยปนอังกฤษ: security team ของ bank', 'Thai/English code-switch bank scam'],
  ['scam-sso-slow-burn', 'ค่อย ๆ หลอก: เงินคืนประกันสังคม (โผล่ค่าธรรมเนียมเทิร์น 4)', 'Slow burn: social-security refund'],
  ['legit-hospital-appointment', 'สายจริง: โรงพยาบาลยืนยันนัด', 'Legit: hospital appointment'],
  ['unsure-debt-collector', 'ก้ำกึ่ง: สำนักงานกฎหมายทวงหนี้บัตร', 'Grey zone: debt-collection office'],
  ['scam-bank-fraud-push-en', 'ธนาคารปลอม: ทีมกันโกงเร่งให้ทำตาม (EN)', 'Fake bank fraud team pushes you to act (EN)'],
  ['legit-courier-lobby-en', 'สายจริง: พนักงานส่งของรอที่ล็อบบี้ (EN)', 'Legit: courier waiting in the lobby (EN)'],
  ['unsure-survey-en', 'ก้ำกึ่ง: โทรขอทำแบบสำรวจ (EN)', 'Grey zone: survey call (EN)'],
  ['scam-bank-fraud-push-zh', 'ธนาคารปลอม (จีน)', 'Fake bank fraud team (Mandarin)'],
];

export const readJsonl = (file) => fs.readFileSync(file, 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

/** Pure: train + sealed rows -> bundle. Throws on any sealed leak or unknown id. */
export function buildSamples(train, sealed, picks = PICKS) {
  const sealedIds = new Set(sealed.map((c) => c.id));
  const sealedLines = new Set(sealed.flatMap((c) => c.turns.map((t) => t.trim())));
  const byId = new Map(train.map((c) => [c.id, c]));
  const samples = picks.map(([id, labelTh, labelEn]) => {
    if (sealedIds.has(id)) throw new Error(`sealed id in sample picks: ${id}`);
    const c = byId.get(id);
    if (!c) throw new Error(`sample pick not in train corpus: ${id}`);
    if (c.source === 'b3-sealed') throw new Error(`sealed-source case in sample picks: ${id}`);
    const leaked = c.turns.find((t) => sealedLines.has(t.trim()));
    if (leaked) throw new Error(`sample ${id} repeats a sealed caller line: ${leaked}`);
    return { id: c.id, class: c.class, lang: c.lang, category: c.category, tags: c.tags || [], labelTh, labelEn, turns: c.turns };
  });
  return {
    version: 1,
    source: 'corpus/thai-tactics.jsonl (train only; never sealed)',
    samples,
  };
}

export function main() {
  const train = readJsonl(path.join(ROOT, 'corpus', 'thai-tactics.jsonl'));
  // sealed.jsonl is read ONLY to reject leaks; nothing from it flows into the bundle.
  const sealed = readJsonl(path.join(ROOT, 'corpus', 'sealed.jsonl'));
  const bundle = buildSamples(train, sealed);
  fs.writeFileSync(OUT, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${bundle.samples.length} samples`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
