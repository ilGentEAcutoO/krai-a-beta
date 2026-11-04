// Turns a finished case report (src/report.js buildReport) into one plain-text
// message for a family chat. Only report fields are used: never the raw
// transcript, the system prompt, keys or model output. The report is Thai, so
// the message is Thai.
//
// Caller-supplied values (intel) are attacker-controlled text: control
// characters are stripped, each value is capped, and links the caller gave are
// defanged (hxxps://bad[.]example) so nobody taps a scam link from the chat.

export const DISCLOSURE_TH = 'ข้อความอัตโนมัติจากผู้ช่วยรับสาย AI (Krai-A) ไม่ใช่คนพิมพ์ ตรวจสอบก่อนทำตามทุกครั้ง';
const VERDICT_MARK = { SCAM: '🔴', UNSURE: '🟡', LEGIT: '🟢' };
const MAX_VALUE = 120;

// Strip control chars (keep \n only where we put it), collapse whitespace.
export function clean(s, max = MAX_VALUE) {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function defang(s) {
  return String(s).replace(/\bhttps?/gi, (m) => m.replace(/t/gi, 'x')).replace(/\./g, '[.]');
}

function intelLine(i) {
  const label = clean(i.labelTh || i.type, 40);
  const value = i.type === 'url' ? defang(clean(i.value)) : clean(i.value);
  return `- ${label}: ${value}`;
}

// Sections in priority order; the tail ones are dropped first to fit maxChars.
export function formatReport(report, { maxChars = 4000 } = {}) {
  const r = report || {};
  const head = [
    'Krai-A · รายงานสายที่รับแทน',
    `${VERDICT_MARK[r.verdict] || '⚪'} ${clean(r.headlineTh || r.verdictTh || '', 400)}`,
  ];
  if (r.callTypeTh) head.push(`ประเภทสาย: ${clean(r.callTypeTh, 160)}`);
  if (r.urgent) {
    const u = r.urgent;
    const bits = [u.who && `ผู้โทร: ${clean(u.who)}`, u.phone && `เบอร์ที่ให้ไว้: ${clean(u.phone)}`, u.place && `สถานที่: ${clean(u.place)}`].filter(Boolean);
    head.push(`เรื่องด่วน${bits.length ? ` (${bits.join(' · ')})` : ''}`);
  }
  if (typeof r.confidence === 'number') head.push(`ความมั่นใจ: ${Math.round(Math.max(0, Math.min(1, r.confidence)) * 100)}%`);

  const intel = Array.isArray(r.intel) ? r.intel.slice(0, 12) : [];
  const steps = Array.isArray(r.nextSteps) ? r.nextSteps.slice(0, 10) : [];
  const foot = ['—', DISCLOSURE_TH];
  if (r.generatedAt) foot.push(`เวลา (UTC): ${clean(r.generatedAt, 30)}`);

  const build = (nIntel, nSteps) => {
    const parts = [head.join('\n')];
    if (nIntel) parts.push(['ข้อมูลที่ผู้โทรพูดเอง:', ...intel.slice(0, nIntel).map(intelLine)].join('\n'));
    if (nSteps) {
      parts.push(['ควรทำอะไรต่อ:', ...steps.slice(0, nSteps).map((s, k) => `${k + 1}. ${clean(s.th, 400)}${s.url && /^https:\/\//.test(s.url) ? `\n   ${clean(s.url, 200)}` : ''}`)].join('\n'));
    }
    parts.push(foot.join('\n'));
    return parts.join('\n\n');
  };

  let nI = intel.length;
  let nS = steps.length;
  let text = build(nI, nS);
  while (text.length > maxChars && (nS > 1 || nI > 0)) {
    if (nS > 1) nS -= 1;
    else nI -= 1;
    text = build(nI, nS);
  }
  if (text.length > maxChars) text = `${text.slice(0, maxChars - DISCLOSURE_TH.length - 2)}…\n${DISCLOSURE_TH}`;
  return text;
}

// WhatsApp template parameters: single-line strings (template text parameters
// may not contain newlines or tabs). {{1}} = verdict headline, {{2}} = the
// top intel + first next step, {{3}} = disclosure.
export function templateParams(report, { maxChars = 900 } = {}) {
  const r = report || {};
  const one = (s) => clean(s, maxChars) || '-';
  const intel = (Array.isArray(r.intel) ? r.intel : []).slice(0, 4).map((i) => intelLine(i).slice(2)).join(' · ');
  const step = Array.isArray(r.nextSteps) && r.nextSteps[0] ? r.nextSteps[0].th : '';
  return [one(`${VERDICT_MARK[r.verdict] || ''} ${r.headlineTh || r.verdictTh || ''}`), one([intel, step].filter(Boolean).join(' | ')), one(DISCLOSURE_TH)];
}
