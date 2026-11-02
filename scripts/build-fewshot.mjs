// Build the committed few-shot bundle from the train corpus only.
// Each pick is a train case (optionally cut to its first `upTo` caller turns)
// plus the expert answer in the FULL verdict schema: calibrated confidence,
// all nine signals, short reasons. A partial cut shows the model how sure to
// be mid-call (the slow burn is UNSURE at turn 2 and SCAM at turn 4), so it
// does not learn a flat 0.95 on every call. Sealed ids and sealed caller
// lines are rejected here, not just by convention.
// Usage: node scripts/build-fewshot.mjs [--max N]  (writes app/src/fewshot.json; default 6)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIGNALS = ['authority', 'urgency', 'secrecy', 'moneyTransfer', 'otpRequest', 'appInstall', 'identityProbe', 'injection', 'callbackGiven'];

// Order = priority when --max trims the set (most informative first).
// Shipped: the first 6 (DEFAULT_MAX). Train A/B, full pipeline, 2026-11-03:
// 11 pairs acc 96.7% / Spark p50 2.1 s; 6 pairs acc 98.3% / p50 2.25 s,
// $0.0047 vs $0.0064 per call (both 64/64 scams, 0/37 false alarms).
export const DEFAULT_MAX = 6;
export const PICKS = [
  {
    id: 'scam-police-summons', verdict: 'SCAM', confidence: 0.97,
    signals: { authority: 0.95, urgency: 0.8, secrecy: 0.9, moneyTransfer: 0.95 },
    reasonTh: 'อ้างเป็นตำรวจ สั่งห้ามบอกใคร และให้โอนเงินทั้งบัญชี',
    reasonEn: 'Claims to be police, demands secrecy and a transfer of all savings.',
  },
  {
    id: 'scam-sso-slow-burn', upTo: 2, verdict: 'UNSURE', confidence: 0.55,
    signals: { authority: 0.7, urgency: 0.1 },
    reasonTh: 'อ้างประกันสังคมว่ามีเงินคืน แต่ยังไม่ขออะไร',
    reasonEn: 'Claims a social-security refund but has asked for nothing yet.',
  },
  {
    id: 'scam-sso-slow-burn', verdict: 'SCAM', confidence: 0.95,
    signals: { authority: 0.7, urgency: 0.5, moneyTransfer: 0.95 },
    reasonTh: 'ให้จ่ายค่าธรรมเนียมผ่านพร้อมเพย์ของเจ้าหน้าที่ก่อนรับเงินคืน',
    reasonEn: 'Asks for a fee to an officer\'s PromptPay before a refund.',
  },
  {
    id: 'legit-bank-callback', verdict: 'LEGIT', confidence: 0.9,
    signals: { authority: 0.6, callbackGiven: 0.9 },
    reasonTh: 'ธนาคารโทรกลับเรื่องที่ลูกค้าฝากไว้ ให้โทรเบอร์หลังบัตร ไม่ขออะไร',
    reasonEn: 'Bank returns the customer\'s request, points to the card\'s number, asks nothing.',
  },
  {
    id: 'scam-inject-note-th', verdict: 'SCAM', confidence: 0.95,
    signals: { authority: 0.4, moneyTransfer: 0.5, appInstall: 0.85, identityProbe: 0.8, injection: 0.95 },
    reasonTh: 'สั่งผู้ช่วยไม่ให้คัดกรอง แล้วขอเลขบัญชีและให้กดลิงก์',
    reasonEn: 'Tells the assistant not to screen, then asks for an account number and a link click.',
  },
  {
    id: 'legit-parcel-cod', verdict: 'LEGIT', confidence: 0.85,
    signals: { moneyTransfer: 0.15, urgency: 0.2 },
    reasonTh: 'พัสดุเก็บเงินปลายทาง จ่ายตอนรับของต่อหน้า',
    reasonEn: 'Cash on delivery, paid in person when the parcel is handed over.',
  },
  {
    id: 'unsure-debt-collector', verdict: 'UNSURE', confidence: 0.65,
    signals: { authority: 0.6, urgency: 0.8, callbackGiven: 0.7 },
    reasonTh: 'ทวงหนี้ขู่ฟ้องภายในวันนี้ แต่ไม่ขอเงินหรือรหัสทางโทรศัพท์',
    reasonEn: 'Debt chaser threatens a lawsuit today but asks for no money or code by phone.',
  },
  {
    id: 'scam-card-read-digits', verdict: 'SCAM', confidence: 0.92,
    signals: { authority: 0.8, urgency: 0.6, otpRequest: 0.9 },
    reasonTh: 'ให้อ่านตัวเลขในข้อความ SMS ให้ฟัง ซึ่งก็คือรหัส OTP',
    reasonEn: 'Asks to read back the digits from the SMS, which is the OTP.',
  },
  {
    id: 'legit-police-report-followup', verdict: 'LEGIT', confidence: 0.85,
    signals: { authority: 0.9, callbackGiven: 0.3 },
    reasonTh: 'ตำรวจติดตามเรื่องที่เจ้าของแจ้งความเอง ให้ไปสถานีด้วยตัวเอง ไม่มีค่าใช้จ่าย',
    reasonEn: 'Police follow up the owner\'s own report, ask for an in-person visit, no cost.',
  },
  {
    id: 'unsure-survey-birthyear', verdict: 'UNSURE', confidence: 0.7,
    signals: { identityProbe: 0.8 },
    reasonTh: 'อ้างวิจัยตลาด ขอชื่อจริงกับปีเกิด ไม่ได้ขอเงิน',
    reasonEn: 'Vague survey asks for full name and birth year; no money asked.',
  },
  {
    id: 'legit-relative-new-number', verdict: 'LEGIT', confidence: 0.8,
    signals: { identityProbe: 0.1 },
    reasonTh: 'หลานแจ้งเบอร์ใหม่ เสนอคำถามยืนยันตัวเอง และไม่ขอเงิน',
    reasonEn: 'Niece gives a new number, offers a check question, asks for no money.',
  },
];

export function buildBundle({ train, sealed, max = DEFAULT_MAX }) {
  const sealedIds = new Set(sealed.map((c) => c.id));
  const sealedLines = new Set(sealed.flatMap((c) => c.turns.map((t) => t.trim())));
  const byId = new Map(train.map((c) => [c.id, c]));
  const cases = PICKS.slice(0, max).map((p) => {
    if (sealedIds.has(p.id)) throw new Error(`sealed id in few-shot picks: ${p.id}`);
    const c = byId.get(p.id);
    if (!c) throw new Error(`pick not in train corpus: ${p.id}`);
    if (c.source === 'b3-sealed') throw new Error(`sealed-source case in few-shot picks: ${p.id}`);
    const turns = p.upTo ? c.turns.slice(0, p.upTo) : c.turns;
    const leaked = turns.find((t) => sealedLines.has(t.trim()));
    if (leaked) throw new Error(`few-shot ${p.id} repeats a sealed caller line: ${leaked}`);
    if (!p.upTo && p.verdict !== c.class) throw new Error(`full-call answer for ${p.id} must match its class ${c.class}`);
    const unknown = Object.keys(p.signals).filter((k) => !SIGNALS.includes(k));
    if (unknown.length) throw new Error(`unknown signal(s) in ${p.id}: ${unknown.join(', ')}`);
    return {
      id: c.id,
      class: c.class,
      category: c.category,
      upTo: p.upTo || null,
      turns,
      verdict: p.verdict,
      tactic: c.category,
      answer: {
        verdict: p.verdict,
        tactic: c.category,
        confidence: p.confidence,
        signals: Object.fromEntries(SIGNALS.map((k) => [k, p.signals[k] ?? 0])),
        reasonTh: p.reasonTh,
        reasonEn: p.reasonEn,
      },
    };
  });
  return {
    version: 2,
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'corpus/thai-tactics.jsonl (v2-port + b3-new only; never sealed)',
    cases,
    categories: [...new Set(train.map((c) => c.category))].sort(),
  };
}

const read = (f) => fs.readFileSync(path.join(ROOT, 'corpus', f), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--max');
  const max = i > 0 ? Number(process.argv[i + 1]) : DEFAULT_MAX;
  // sealed.jsonl is read ONLY to reject leaks; nothing from it enters the bundle.
  const bundle = buildBundle({ train: read('thai-tactics.jsonl'), sealed: read('sealed.jsonl'), max });
  const out = path.join(ROOT, 'app', 'src', 'fewshot.json');
  fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`wrote ${out}: ${bundle.cases.length} pairs, ${bundle.categories.length} categories`);
}
