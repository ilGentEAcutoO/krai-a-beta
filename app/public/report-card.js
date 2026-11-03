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
.rc{background:#fff;border-radius:22px;padding:16px 16px 14px;margin:0 0 12px;color:#111214;font-size:14px;line-height:1.6;box-shadow:0 0 0 1px rgba(17,18,20,.05),0 16px 32px -20px rgba(17,18,20,.35);animation:rcin .32s cubic-bezier(.23,1,.32,1)}
@keyframes rcin{from{opacity:0;transform:translateY(8px)}}
.rc h2{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;font-size:17px;line-height:1.35;margin:6px 0 2px}
.rc .rc-k{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6B6E76}
.rc .rc-head{margin:4px 0 8px;font-size:15px;color:#46484F}
.rc .rc-pill{display:inline-flex;align-items:center;gap:6px;font-weight:700;padding:2px 11px;border-radius:99px;font-size:12.5px;background:#F5F5F7;color:#46484F}
.rc .rc-pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.rc .p-SCAM{background:#FDEDED;color:#B3261E}.rc .p-UNSURE{background:#FEF5E3;color:#8A5200}.rc .p-LEGIT{background:#E8F8EE;color:#037A34}
.rc .rc-sec{margin-top:10px;padding-top:10px;box-shadow:inset 0 1px 0 #E4E5E8}
.rc .rc-urgent{background:#D92D20;color:#fff;border-radius:14px;padding:10px 12px;margin:0 0 10px;font-size:14px;line-height:1.45}
.rc .rc-urgent b{font-size:16px;letter-spacing:.03em}
.rc .rc-urgent-f{font-size:13.5px;margin-top:2px}
.rc .rc-row{display:grid;grid-template-columns:96px 1fr;gap:2px 10px;padding:5px 0;font-size:14px}
.rc .rc-row .l{color:#6B6E76;font-size:12.5px}
.rc .rc-row .v{word-break:break-word;font-weight:500}
.rc .rc-row .v.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-weight:600}
.rc .rc-row .q{grid-column:2;color:#6B6E76;font-size:12.5px}
.rc .q b,.rc .rc-src b{color:#111214;font-weight:700;background:#FEF5E3;border-radius:3px;padding:0 2px}
.rc .rc-group{margin:8px 0 4px;padding:8px 10px;border-radius:14px;background:#F5F5F7}
.rc .rc-src{color:#46484F;font-size:13px;margin-bottom:4px}
.rc .rc-src span{display:block;font-size:11.5px;color:#6B6E76}
.rc ol{margin:6px 0 0 18px;font-size:13.5px;color:#46484F}.rc li{margin:5px 0}
.rc a{color:#037A34}
.rc .rc-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
.rc button{font-family:inherit;font-weight:600;font-size:14.5px;line-height:1.2;min-height:44px;background:#111214;color:#fff;border:0;border-radius:999px;padding:0 18px;cursor:pointer;transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 160ms ease}
.rc button:hover{background:#2B2D33}
.rc button:active{transform:scale(.96)}
.rc button.ghost{background:#fff;color:#111214;box-shadow:inset 0 0 0 1px #D2D4D9}
.rc button:focus-visible{outline:3px solid #06C755;outline-offset:2px}
.rc .rc-status{font-size:13px;color:#037A34}
.rc .rc-foot{margin-top:10px;font-size:11.5px;line-height:1.5;color:#6B6E76}
.rc .rc-load{color:#46484F}
.rc .rc-load i{display:block;height:4px;background:#EDEDF0;border-radius:2px;margin-top:10px;overflow:hidden}
.rc .rc-load i::after{content:"";display:block;height:100%;width:30%;background:#06C755;border-radius:2px;animation:rcslide 1.2s ease-in-out infinite}
@keyframes rcslide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
@media (prefers-reduced-motion:reduce){.rc{animation:none}.rc .rc-load i::after{animation:none;width:100%;opacity:.4}.rc button:active{transform:none}}
@media (max-width:360px){.rc .rc-row{grid-template-columns:1fr}.rc .rc-row .q{grid-column:1}}
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
const WINDOW = 25;
const validSpan = (q, sp) => Array.isArray(sp) && sp.length === 2 && sp[0] >= 0 && sp[1] > sp[0] && sp[1] <= q.length;

// Only the part of the caller sentence that supports a field: ~25 chars each
// side of the match. -> { before, match, after } (strings, for text or DOM).
export function snippetParts(quote, span) {
  const q = String(quote || '');
  if (!validSpan(q, span)) return q.length > 70 ? { before: '', match: '', after: q.slice(0, 70) + '…' } : { before: '', match: '', after: q };
  const [s, e] = span;
  let from = Math.max(0, s - WINDOW);
  let to = Math.min(q.length, e + WINDOW);
  // Prefer cutting at a space (Thai words), and never split a base letter
  // from its vowel or tone mark.
  const spBefore = q.lastIndexOf(' ', from + 8);
  if (from > 0 && spBefore >= from - 10 && spBefore < s) from = spBefore + 1;
  const spAfter = q.indexOf(' ', to - 8);
  if (to < q.length && spAfter > e && spAfter <= to + 10) to = spAfter;
  const MARK = /[ัิ-ฺ็-๎]/;
  while (from > 0 && MARK.test(q[from])) from -= 1;
  while (to < q.length && MARK.test(q[to])) to += 1;
  return { before: (from > 0 ? '…' : '') + q.slice(from, s), match: q.slice(s, e), after: q.slice(e, to) + (to < q.length ? '…' : '') };
}

// Items that quote the same caller sentence -> one group (order kept).
export function groupBySource(items = []) {
  const groups = [];
  const at = new Map();
  for (const it of items) {
    const k = String(it.quote || '');
    if (!at.has(k)) {
      at.set(k, groups.length);
      groups.push({ quote: k, items: [] });
    }
    groups[at.get(k)].items.push(it);
  }
  return groups;
}

// Merge the spans of one group so the shared sentence shows every match bold.
export function mergedSpans(quote, items) {
  const spans = items.map((i) => i.span).filter((sp) => validSpan(quote, sp)).map((sp) => [sp[0], sp[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else out.push(sp);
  }
  return out;
}

function quoteNode(cls, parts) {
  const n = el('span', cls);
  n.append(document.createTextNode('“' + parts.before));
  if (parts.match) n.append(el('b', null, parts.match));
  n.append(document.createTextNode(parts.after + '”'));
  return n;
}

function sentenceNode(quote, spans) {
  const n = el('div', 'rc-src');
  n.append(el('span', null, 'คำพูดผู้โทร'));
  let pos = 0;
  n.append(document.createTextNode('“'));
  for (const [s, e] of spans) {
    n.append(document.createTextNode(quote.slice(pos, s)), el('b', null, quote.slice(s, e)));
    pos = e;
  }
  n.append(document.createTextNode(quote.slice(pos) + '”'));
  return n;
}

const ENDED_TH = { hangup: 'วางสาย', 'trap-done': 'กับดักครบเวลา', 'caller-left': 'ผู้โทรวางสาย', user: 'จบสายเอง' };

// Plain-text version for copy / share (Thai, readable in LINE or SMS).
export function reportText(r) {
  const out = ['รายงานสายโทรเข้า (KRAI-A)', r.urgent ? 'ด่วน / URGENT: ผู้โทรแจ้งเหตุฉุกเฉิน' : '', r.headlineTh || r.verdictTh || ''];
  if (r.callTypeTh && r.callType !== 'scam' && r.callType !== 'normal') out.push(`ประเภทสาย: ${r.callTypeTh}`);
  if (r.confidence != null) out.push(`ความมั่นใจ ${Math.round(r.confidence * 100)}%`);
  const snip = (q, sp) => {
    const p = snippetParts(q, sp);
    return `"${p.before}${p.match}${p.after}"`;
  };
  if (r.claimedIdentity) out.push(`ผู้โทรอ้างว่าเป็น: ${r.claimedIdentity.value}\n  คำพูดจริง: ${snip(r.claimedIdentity.quote, r.claimedIdentity.span)}`);
  if (r.intel?.length) {
    out.push('ข้อมูลที่ผู้โทรให้มา (คำพูดจริงของผู้โทร):');
    for (const g of groupBySource(r.intel)) {
      if (g.items.length === 1) {
        const i = g.items[0];
        out.push(`- ${i.labelTh || i.type}: ${i.value}\n  ${snip(i.quote, i.span)}`);
      } else {
        out.push(`ผู้โทรพูดว่า: "${g.quote}"`);
        for (const i of g.items) out.push(`- ${i.labelTh || i.type}: ${i.value}`);
      }
    }
  }
  if (r.nextSteps?.length) {
    out.push('ควรทำต่อ:');
    r.nextSteps.forEach((s, n) => out.push(`${n + 1}. ${s.th}${s.url ? ` ${s.url}` : ''}`));
  }
  out.push(`สร้างเมื่อ ${new Date(r.generatedAt || Date.now()).toLocaleString('th-TH')} · ข้อความในเครื่องหมายคำพูดคือคำพูดของผู้โทรตามบันทึก`);
  return out.filter(Boolean).join('\n');
}

function row(label, value, quoteEl, mono) {
  const r = el('div', 'rc-row');
  r.append(el('span', 'l', label), el('span', mono ? 'v mono' : 'v', value));
  if (quoteEl) r.append(quoteEl);
  return r;
}

export function renderReport(container, report, { source } = {}) {
  injectCss();
  const r = report || {};
  const v = safeVerdict(r.verdict);
  const card = el('section', `rc v-${v}`);
  card.setAttribute('aria-label', 'รายงานสาย / Case report');
  // B25: a reported emergency goes on top in red, with what the caller gave
  if (r.urgent) {
    const u = el('div', 'rc-urgent');
    u.setAttribute('role', 'alert');
    u.append(el('b', null, 'ด่วน / URGENT'), el('span', null, ' ผู้โทรแจ้งเหตุฉุกเฉิน · the caller reported an emergency'));
    const facts = [['ผู้โทร / caller', r.urgent.who], ['เบอร์ / number', r.urgent.phone], ['สถานที่ / place', r.urgent.place]].filter(([, v]) => v);
    for (const [k, v] of facts) u.append(el('div', 'rc-urgent-f', `${k}: ${v}`));
    card.append(u);
  }
  card.append(el('span', 'rc-k', 'รายงานสำหรับครอบครัว · Case report'));
  const h = el('h2');
  h.append(el('span', `rc-pill p-${v}`, v), document.createTextNode(r.verdictTh || ''));
  card.append(h, el('p', 'rc-head', r.headlineTh || ''));

  const facts = el('div', 'rc-sec');
  if (r.confidence != null) facts.append(row('ความมั่นใจ', `${Math.round(r.confidence * 100)}%`));
  // B25: a non-scam kind (abusive debt collection, nuisance, sales) in plain words, TH + EN
  if (r.callTypeTh && r.callType !== 'scam' && r.callType !== 'normal') {
    facts.append(row('ประเภทสาย', `${r.callTypeTh}${r.callTypeEn ? ` · ${r.callTypeEn}` : ''}`));
  }
  if (r.tacticTh) facts.append(row('กลโกง', r.tacticTh));
  facts.append(row('ผู้โทรอ้างว่าเป็น', r.claimedIdentity ? r.claimedIdentity.value : 'ไม่ได้บอก',
    r.claimedIdentity ? quoteNode('q', snippetParts(r.claimedIdentity.quote, r.claimedIdentity.span)) : null));
  facts.append(row('จบสายโดย', ENDED_TH[r.endedBy] || r.endedBy || '-'));
  card.append(facts);

  if (Array.isArray(r.intel) && r.intel.length) {
    const sec = el('div', 'rc-sec');
    sec.append(el('span', 'rc-k', 'ข้อมูลที่ผู้โทรให้มา (มีคำพูดจริงกำกับทุกข้อ)'));
    const mono = (i) => ['bank-account', 'phone', 'badge', 'line-id', 'url'].includes(i.type);
    for (const g of groupBySource(r.intel)) {
      if (g.items.length === 1) {
        const i = g.items[0];
        sec.append(row(i.labelTh || i.type, i.value, quoteNode('q', snippetParts(i.quote, i.span)), mono(i)));
        continue;
      }
      // Several fields from one sentence: the sentence once, fields under it.
      const box = el('div', 'rc-group');
      box.append(sentenceNode(g.quote, mergedSpans(g.quote, g.items)));
      for (const i of g.items) box.append(row(i.labelTh || i.type, i.value, null, mono(i)));
      sec.append(box);
    }
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
