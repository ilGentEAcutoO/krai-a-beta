/* Case report card (G8): self-contained ES module, mounted by demo-live at
 * call end (hangup or trap done).
 *
 *   import { mountReportCard } from './report-card.js';
 *   await mountReportCard(containerEl, {
 *     apiJson,                       // demo-live's session-aware POST helper: (url, body) => json
 *     lines,                         // [{ speaker:'caller'|'receptionist', text }] whole call
 *     intel,                         // trap intel so far (optional; server re-verifies it)
 *     endedBy: 'hangup' | 'trap-done',
 *     verdict: 'SCAM' | 'LEGIT' | 'UNSURE', // last live verdict, used only if the model is down
 *   });
 *
 * The server (POST /api/report, app/src/report.js) decides every field shown
 * here: intel and the claimed identity only appear with a verbatim caller
 * quote, and the next steps are written by code. This module only renders,
 * copies and shares. No browser dialogs: status is shown inline.
 */

const CSS = `
.rc{background:#151f38;border:1px solid #2a3a5f;border-left:4px solid #8b91ab;border-radius:14px;padding:18px 20px;margin:16px 0;color:#e8eaf5;font-size:14px;line-height:1.7}
.rc.v-SCAM{border-left-color:#ff7a7a}.rc.v-UNSURE{border-left-color:#ffcd70}.rc.v-LEGIT{border-left-color:#7ee6bd}
.rc h2{font-size:17px;margin:0 0 2px}
.rc .rc-k{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b91ab}
.rc .rc-head{margin:6px 0 10px;font-size:15px}
.rc .rc-pill{display:inline-block;font-weight:800;padding:1px 12px;border-radius:99px;font-size:12px;margin-right:8px}
.rc .p-SCAM{background:rgba(255,122,122,.15);color:#ff7a7a}.rc .p-UNSURE{background:rgba(255,205,112,.15);color:#ffcd70}.rc .p-LEGIT{background:rgba(126,230,189,.15);color:#7ee6bd}
.rc .rc-sec{margin-top:12px;padding-top:10px;border-top:1px solid #2a3a5f}
.rc .rc-row{display:grid;grid-template-columns:140px 1fr;gap:2px 12px;padding:6px 0;font-size:14px}
.rc .rc-row .l{color:#8b91ab;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.rc .rc-row .v{word-break:break-word}
.rc .rc-row .v.mono{font-family:Consolas,monospace}
.rc .rc-row .q{grid-column:2;color:#8b91ab;font-size:12px}
.rc ol{margin:6px 0 0 20px}.rc li{margin:4px 0}
.rc a{color:#7ee6bd}
.rc .rc-act{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center}
.rc button{font:inherit;background:#7ee6bd;color:#0e1526;border:0;border-radius:10px;padding:8px 18px;font-weight:700;cursor:pointer}
.rc button.ghost{background:transparent;color:#7ee6bd;border:1px solid rgba(126,230,189,.4)}
.rc button:focus-visible{outline:2px solid #7ee6bd;outline-offset:2px}
.rc .rc-status{font-size:13px;color:#8b91ab}
.rc .rc-foot{margin-top:10px;font-size:12px;color:#8b91ab}
.rc .rc-load{color:#8b91ab}
.rc .rc-load i{display:block;height:4px;background:#2a3a5f;border-radius:2px;margin-top:10px;overflow:hidden}
.rc .rc-load i::after{content:"";display:block;height:100%;width:30%;background:#7ee6bd;border-radius:2px;animation:rcslide 1.2s ease-in-out infinite}
@keyframes rcslide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
@media (prefers-reduced-motion:reduce){.rc .rc-load i::after{animation:none;width:100%;opacity:.4}}
@media (max-width:640px){.rc .rc-row{grid-template-columns:1fr}.rc .rc-row .q{grid-column:1}}
`;

function injectCss() {
  if (document.getElementById('report-card-css')) return;
  const s = document.createElement('style');
  s.id = 'report-card-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const VERDICTS = ['SCAM', 'UNSURE', 'LEGIT'];
const safeVerdict = (v) => (VERDICTS.includes(v) ? v : 'UNSURE');
const ENDED_TH = { hangup: 'วางสาย', 'trap-done': 'กับดักครบเวลา', 'caller-left': 'ผู้โทรวางสาย', user: 'จบสายเอง' };

// Plain-text version for copy / share (Thai, readable in LINE or SMS).
export function reportText(r) {
  const out = ['รายงานสายโทรเข้า (KRAI-A)', r.headlineTh || r.verdictTh || ''];
  if (r.confidence != null) out.push(`ความมั่นใจ ${Math.round(r.confidence * 100)}%`);
  if (r.claimedIdentity) out.push(`ผู้โทรอ้างว่าเป็น: ${r.claimedIdentity.value}\n  คำพูดจริง: "${r.claimedIdentity.quote}"`);
  if (r.intel?.length) {
    out.push('ข้อมูลที่ผู้โทรให้มา (คำพูดจริงของผู้โทร):');
    for (const i of r.intel) out.push(`- ${i.labelTh || i.type}: ${i.value}\n  "${i.quote}"`);
  }
  if (r.nextSteps?.length) {
    out.push('ควรทำต่อ:');
    r.nextSteps.forEach((s, n) => out.push(`${n + 1}. ${s.th}${s.url ? ` ${s.url}` : ''}`));
  }
  out.push(`สร้างเมื่อ ${new Date(r.generatedAt || Date.now()).toLocaleString('th-TH')} · ข้อความในเครื่องหมายคำพูดคือคำพูดของผู้โทรตามบันทึก`);
  return out.filter(Boolean).join('\n');
}

function row(label, value, quote, mono) {
  const r = el('div', 'rc-row');
  r.append(el('span', 'l', label), el('span', mono ? 'v mono' : 'v', value));
  if (quote) r.append(el('span', 'q', `“${quote}”`));
  return r;
}

export function renderReport(container, report, { source } = {}) {
  injectCss();
  const r = report || {};
  const v = safeVerdict(r.verdict);
  const card = el('section', `rc v-${v}`);
  card.setAttribute('aria-label', 'รายงานสาย / Case report');
  card.append(el('span', 'rc-k', 'รายงานสำหรับครอบครัว · Case report'));
  const h = el('h2');
  h.append(el('span', `rc-pill p-${v}`, v), document.createTextNode(r.verdictTh || ''));
  card.append(h, el('p', 'rc-head', r.headlineTh || ''));

  const facts = el('div', 'rc-sec');
  if (r.confidence != null) facts.append(row('ความมั่นใจ', `${Math.round(r.confidence * 100)}%`));
  if (r.tacticTh) facts.append(row('กลโกง', r.tacticTh));
  facts.append(row('ผู้โทรอ้างว่าเป็น', r.claimedIdentity ? r.claimedIdentity.value : 'ไม่ได้บอก', r.claimedIdentity?.quote));
  facts.append(row('จบสายโดย', ENDED_TH[r.endedBy] || r.endedBy || '-'));
  card.append(facts);

  if (Array.isArray(r.intel) && r.intel.length) {
    const sec = el('div', 'rc-sec');
    sec.append(el('span', 'rc-k', 'ข้อมูลที่ผู้โทรให้มา (มีคำพูดจริงกำกับทุกข้อ)'));
    for (const i of r.intel) sec.append(row(i.labelTh || i.type, i.value, i.quote, ['bank-account', 'phone', 'badge', 'line-id', 'url'].includes(i.type)));
    card.append(sec);
  }

  if (Array.isArray(r.nextSteps) && r.nextSteps.length) {
    const sec = el('div', 'rc-sec');
    sec.append(el('span', 'rc-k', 'ควรทำต่อ'));
    const ol = el('ol');
    for (const s of r.nextSteps) {
      const li = el('li', null, s.th);
      if (s.url && /^https:\/\//.test(s.url)) {
        li.append(document.createTextNode(' '));
        const a = el('a', null, s.url.replace(/^https:\/\//, ''));
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        li.append(a);
      }
      ol.append(li);
    }
    sec.append(ol);
    card.append(sec);
  }

  const act = el('div', 'rc-act');
  const status = el('span', 'rc-status');
  status.setAttribute('role', 'status');
  const text = reportText(r);
  const copyBtn = el('button', null, 'คัดลอกรายงาน / Copy');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'คัดลอกแล้ว วางในแชตครอบครัวได้เลย';
    } catch {
      status.textContent = 'คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่ข้อความเพื่อคัดลอกเอง';
    }
  });
  act.append(copyBtn);
  if (navigator.share) {
    const shareBtn = el('button', 'ghost', 'แชร์ / Share');
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'รายงานสายโทรเข้า (KRAI-A)', text });
        status.textContent = 'แชร์แล้ว';
      } catch (e) {
        status.textContent = e?.name === 'AbortError' ? '' : 'แชร์ไม่สำเร็จ — ใช้ปุ่มคัดลอกแทน';
      }
    });
    act.append(shareBtn);
  }
  act.append(status);
  card.append(act);
  card.append(el('p', 'rc-foot', source === 'fallback'
    ? 'Muse Spark ไม่ตอบในตอนนี้ — รายงานนี้ใช้ผลตัดสินระหว่างสายและข้อมูลที่โค้ดดึงจากคำพูดผู้โทรเท่านั้น'
    : 'เขียนโดย Muse Spark · โค้ดตัดทุกข้อที่ไม่มีคำพูดจริงของผู้โทรรองรับ · ขั้นตอนต่อไปเขียนโดยโค้ด ไม่ใช่โมเดล'));

  container.replaceChildren(card);
  return card;
}

export async function mountReportCard(container, { apiJson, lines = [], intel = [], endedBy = 'hangup', verdict } = {}) {
  injectCss();
  if (!container) return null;
  const loading = el('section', 'rc');
  const p = el('p', 'rc-load', 'กำลังเขียนรายงานสายให้ครอบครัว… (Muse Spark ใช้เวลาราว 10 วินาที)');
  p.append(el('i'));
  loading.append(el('span', 'rc-k', 'รายงานสำหรับครอบครัว · Case report'), p);
  container.replaceChildren(loading);
  const callerLines = (Array.isArray(lines) ? lines : []).filter((l) => l && l.speaker === 'caller' && String(l.text || '').trim());
  if (!callerLines.length) {
    container.replaceChildren(el('p', 'rc-status', 'ยังไม่มีคำพูดของผู้โทร จึงยังไม่มีรายงาน'));
    return null;
  }
  try {
    const data = await apiJson('/api/report', { lines, intel, endedBy, verdict });
    if (!data?.ok || !data.report) throw new Error(data?.error || 'report-failed');
    return renderReport(container, data.report, { source: data.source });
  } catch (e) {
    const box = el('section', 'rc');
    box.append(el('span', 'rc-k', 'รายงานสำหรับครอบครัว · Case report'),
      el('p', 'rc-status', `สร้างรายงานไม่สำเร็จ: ${String(e?.messageTh || e?.message || 'error').slice(0, 120)} — ลองใหม่ภายหลัง`));
    container.replaceChildren(box);
    return null;
  }
}
