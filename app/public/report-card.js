/* Case report card (G8): self-contained ES module, mounted by demo-live at
 * call end (hangup or trap done), and by the recorded-call player.
 *
 *   import { mountReportCard, renderReport } from './report-card.js';
 *   await mountReportCard(containerEl, {
 *     apiJson,                       // demo-live's session-aware POST helper: (url, body) => json
 *     lines,                         // [{ speaker:'caller'|'receptionist', text }] whole call
 *     intel,                         // trap intel so far (optional; server re-verifies it)
 *     endedBy: 'hangup' | 'trap-done',
 *     verdict: 'SCAM' | 'LEGIT' | 'UNSURE', // last live verdict, used only if the model is down
 *     lang: 'th' | 'en' | 'zh',      // report language (follows the call; English page -> never Thai)
 *     region: 'TH' | 'global',       // next steps: Thai hotlines or generic local authorities
 *   });
 *
 * The server (POST /api/report, app/src/report.js) decides every field shown
 * here: intel and the claimed identity only appear with a verbatim caller
 * quote, and the next steps are written by code. This module only renders,
 * copies and shares. No browser dialogs: status is shown inline.
 * Labels follow report.lang; when the report language is not the caller's,
 * the model's display translations are shown instead of the original words.
 */

const CSS = `
.rc{--rc-ink:#111214;--rc-ink2:#46484F;--rc-ink3:#6B6E76;--rc-line:#E7E8EB;background:#fff;border-radius:24px;color:var(--rc-ink);font-size:14px;line-height:1.55;box-shadow:0 0 0 1px rgba(17,18,20,.06),0 24px 48px -28px rgba(17,18,20,.45);overflow:hidden;animation:rcin .42s cubic-bezier(.23,1,.32,1)}
@keyframes rcin{from{opacity:0;transform:translateY(10px) scale(.985)}}
.rc-top{padding:18px 18px 16px;background:var(--rc-tint,#F5F5F7)}
.rc.v-SCAM{--rc-tint:linear-gradient(180deg,#FDECEC,#FFF6F6);--rc-acc:#C8261C}
.rc.v-UNSURE{--rc-tint:linear-gradient(180deg,#FEF3DE,#FFFAF0);--rc-acc:#9A5B00}
.rc.v-LEGIT{--rc-tint:linear-gradient(180deg,#E3F7EB,#F4FBF6);--rc-acc:#037A34}
.rc-k{display:block;font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--rc-ink3)}
.rc-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.rc-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.75);box-shadow:inset 0 0 0 1px rgba(17,18,20,.08);font-size:12px;font-weight:600;color:var(--rc-ink2)}
.rc-verdict{display:flex;align-items:center;gap:10px;margin:10px 0 4px}
.rc-verdict .rc-ico{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--rc-acc,#46484F);color:#fff}
.rc-verdict .rc-ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.rc-verdict h2{margin:0;font-size:20px;line-height:1.25;letter-spacing:-.01em;color:var(--rc-acc,var(--rc-ink))}
.rc-head{margin:6px 0 0;font-size:14.5px;color:var(--rc-ink2);text-wrap:pretty}
.rc-conf{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12.5px;color:var(--rc-ink3);font-variant-numeric:tabular-nums}
.rc-conf i{flex:1;height:6px;border-radius:3px;background:rgba(17,18,20,.08);overflow:hidden}
.rc-conf i b{display:block;height:100%;border-radius:3px;background:var(--rc-acc,#46484F);transform-origin:left;animation:rcbar .9s cubic-bezier(.23,1,.32,1)}
@keyframes rcbar{from{transform:scaleX(0)}}
.rc-body{padding:4px 18px 16px}
.rc-sec{padding:12px 0;box-shadow:inset 0 -1px 0 var(--rc-line)}
.rc-sec:last-of-type{box-shadow:none}
.rc-urgent{background:#D92D20;color:#fff;padding:12px 18px;font-size:14px;line-height:1.45}
.rc-urgent b{font-size:15px;letter-spacing:.04em}
.rc-urgent-f{font-size:13.5px;margin-top:2px}
.rc-row{display:grid;grid-template-columns:118px 1fr;gap:2px 12px;padding:6px 0}
.rc-row .l{color:var(--rc-ink3);font-size:12.5px;padding-top:1px}
.rc-row .v{word-break:break-word;font-weight:600}
.rc-row .v.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.01em}
.rc-row .q{grid-column:2;color:var(--rc-ink3);font-size:12.5px;font-style:italic}
.rc .q b,.rc .rc-src b{color:var(--rc-ink);font-style:normal;font-weight:700;background:#FFE9B8;border-radius:3px;padding:0 2px}
.rc-tr{display:block;margin-top:1px;font-size:11px;font-style:normal;color:#8A8D94}
.rc-group{margin:6px 0;padding:8px 10px;border-radius:14px;background:#F6F6F8}
.rc-src{color:var(--rc-ink2);font-size:13px;margin-bottom:4px}
.rc-src span{display:block;font-size:11.5px;color:var(--rc-ink3)}
.rc ol{list-style:none;margin:8px 0 0;padding:0;counter-reset:rc}
.rc li{position:relative;counter-increment:rc;margin:0;padding:6px 0 6px 30px;font-size:13.5px;color:var(--rc-ink2);text-wrap:pretty}
.rc li::before{content:counter(rc);position:absolute;left:0;top:6px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#F0F1F3;color:var(--rc-ink);font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums}
.rc a{color:#037A34}
.rc-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 18px 0}
.rc button{font-family:inherit;font-weight:600;font-size:14px;line-height:1.2;min-height:44px;background:var(--rc-ink);color:#fff;border:0;border-radius:999px;padding:0 18px;cursor:pointer;transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 160ms ease}
.rc button:hover{background:#2B2D33}
.rc button:active{transform:scale(.96)}
.rc button.ghost{background:#fff;color:var(--rc-ink);box-shadow:inset 0 0 0 1px #D2D4D9}
.rc button.ghost:hover{background:#F6F6F8}
.rc button:focus-visible{outline:3px solid #06C755;outline-offset:2px}
.rc-status{font-size:13px;color:#037A34}
.rc-foot{margin:0;padding:10px 18px 16px;font-size:11.5px;line-height:1.5;color:var(--rc-ink3)}
.rc-load{padding:18px}
.rc-load p{margin:8px 0 0;color:var(--rc-ink2)}
.rc-load i{display:block;height:4px;background:#EDEDF0;border-radius:2px;margin-top:12px;overflow:hidden}
.rc-load i::after{content:"";display:block;height:100%;width:30%;background:#06C755;border-radius:2px;animation:rcslide 1.2s ease-in-out infinite}
@keyframes rcslide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
@media (prefers-reduced-motion:reduce){.rc{animation:none}.rc-conf i b{animation:none}.rc-load i::after{animation:none;width:100%;opacity:.4}.rc button:active{transform:none}}
@media (max-width:400px){.rc-row{grid-template-columns:1fr}.rc-row .q{grid-column:1}}
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

// ---- labels per report language ----
export const RC_TEXT = {
  th: {
    title: 'รายงานสำหรับครอบครัว', conf: 'ความมั่นใจ', type: 'ประเภทสาย', tactic: 'กลโกง', who: 'ผู้โทรอ้างว่าเป็น', notSaid: 'ไม่ได้บอก',
    ended: 'จบสายโดย', intel: 'ข้อมูลที่ผู้โทรให้มา (มีคำพูดจริงกำกับทุกข้อ)', steps: 'ควรทำต่อ', said: 'คำพูดผู้โทร',
    copy: 'คัดลอกรายงาน', share: 'แชร์', copied: 'คัดลอกแล้ว วางในแชตครอบครัวได้เลย', copyFail: 'คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — กดค้างที่ข้อความเพื่อคัดลอกเอง',
    shared: 'แชร์แล้ว', shareFail: 'แชร์ไม่สำเร็จ — ใช้ปุ่มคัดลอกแทน', urgent: 'ด่วน', urgentSub: 'ผู้โทรแจ้งเหตุฉุกเฉิน', caller: 'ผู้โทร', number: 'เบอร์', place: 'สถานที่',
    loading: 'กำลังเขียนรายงานสายให้ครอบครัว… (Muse Spark ใช้เวลาราว 10 วินาที)', noCaller: 'ยังไม่มีคำพูดของผู้โทร จึงยังไม่มีรายงาน',
    failed: 'สร้างรายงานไม่สำเร็จ', later: 'ลองใหม่ภายหลัง', head: 'รายงานสายโทรเข้า (KRAI-A)', made: 'สร้างเมื่อ', quoteNote: 'ข้อความในเครื่องหมายคำพูดคือคำพูดของผู้โทรตามบันทึก',
    footModel: 'เขียนโดย Muse Spark · โค้ดตัดทุกข้อที่ไม่มีคำพูดจริงของผู้โทรรองรับ · ขั้นตอนต่อไปเขียนโดยโค้ด ไม่ใช่โมเดล',
    footFallback: 'Muse Spark ไม่ตอบในตอนนี้ — รายงานนี้ใช้ผลตัดสินระหว่างสายและข้อมูลที่โค้ดดึงจากคำพูดผู้โทรเท่านั้น',
    translated: 'แปลจากภาษาของผู้โทร', saidIn: 'คำพูดต้นฉบับอยู่ในบันทึกสาย', region: { TH: 'ประเทศไทย', global: 'สากล' }, lang: 'ภาษาไทย',
    endedBy: { hangup: 'วางสาย', 'trap-done': 'กับดักครบเวลา', 'caller-left': 'ผู้โทรวางสาย', user: 'จบสายเอง' },
    verdictWord: { SCAM: 'มิจฉาชีพ', UNSURE: 'ไม่แน่ใจ', LEGIT: 'ปกติ' },
  },
  en: {
    title: 'Case report for the family', conf: 'Confidence', type: 'Call type', tactic: 'Tactic', who: 'Claimed to be', notSaid: 'Did not say',
    ended: 'Call ended by', intel: 'What the caller gave away (each with their exact words)', steps: 'What to do next', said: 'The caller said',
    copy: 'Copy report', share: 'Share', copied: 'Copied: paste it into the family chat', copyFail: 'This browser cannot copy automatically: press and hold the text to copy it',
    shared: 'Shared', shareFail: 'Share failed: use Copy instead', urgent: 'URGENT', urgentSub: 'the caller reported an emergency', caller: 'Caller', number: 'Number', place: 'Place',
    loading: 'Writing the family report… (Muse Spark takes about 10 s)', noCaller: 'The caller has not said anything yet, so there is no report.',
    failed: 'Could not write the report', later: 'try again later', head: 'Incoming call report (KRAI-A)', made: 'Written', quoteNote: "Text in quotes is the caller's own words as recorded",
    footModel: "Written by Muse Spark · code drops anything without the caller's exact words · next steps are written by code, not the model",
    footFallback: "Muse Spark did not answer just now: this report uses only the live verdicts and what code pulled from the caller's words",
    translated: "translated from the caller's language", saidIn: 'original words are in the call log', region: { TH: 'Thailand', global: 'Global' }, lang: 'English',
    endedBy: { hangup: 'hang-up', 'trap-done': 'trap time limit', 'caller-left': 'the caller', user: 'the user' },
    verdictWord: { SCAM: 'Scam', UNSURE: 'Unsure', LEGIT: 'Normal' },
  },
  zh: {
    title: '给家人的来电报告', conf: '可信度', type: '来电类型', tactic: '套路', who: '自称身份', notSaid: '未说明',
    ended: '结束方式', intel: '来电者透露的信息（每条附原话）', steps: '接下来怎么做', said: '来电者原话',
    copy: '复制报告', share: '分享', copied: '已复制，可以粘贴到家人群里', copyFail: '此浏览器无法自动复制，请长按文字手动复制',
    shared: '已分享', shareFail: '分享失败，请改用复制', urgent: '紧急', urgentSub: '来电者报告了紧急情况', caller: '来电者', number: '电话', place: '地点',
    loading: '正在为家人生成来电报告…（Muse Spark 约需 10 秒）', noCaller: '来电者还没有说话，暂无报告。',
    failed: '报告生成失败', later: '请稍后再试', head: '来电报告（KRAI-A）', made: '生成于', quoteNote: '引号内是来电者的原话记录',
    footModel: '由 Muse Spark 撰写 · 没有来电者原话支持的内容一律由代码删除 · 后续步骤由代码撰写，不是模型',
    footFallback: 'Muse Spark 暂时没有回应：本报告只使用通话中的判定和代码从来电者原话中提取的信息',
    translated: '译自来电者的语言', saidIn: '原话见通话记录', region: { TH: '泰国', global: '通用' }, lang: '中文',
    endedBy: { hangup: '挂断', 'trap-done': '拖延时间已满', 'caller-left': '来电者挂断', user: '用户' },
    verdictWord: { SCAM: '诈骗', UNSURE: '不确定', LEGIT: '正常' },
  },
};
const T = (r) => RC_TEXT[r?.lang] || RC_TEXT.th;
// The caller's words are shown only when they are in the report language
// (or there is no translation and the report is Thai, the old behaviour).
const THAI = /[฀-๿]/;
const HAN = /[㐀-鿿]/;
function foreign(text, lang) {
  const t = String(text || '');
  if (lang === 'en') return THAI.test(t) || HAN.test(t);
  if (lang === 'zh') return THAI.test(t);
  return false;
}

function quoteNode(cls, parts) {
  const n = el('span', cls);
  n.append(document.createTextNode('“' + parts.before));
  if (parts.match) n.append(el('b', null, parts.match));
  n.append(document.createTextNode(parts.after + '”'));
  return n;
}
// A translated quote: the translation in quotes, marked as a translation.
function trNode(text, t) {
  const n = el('span', 'q', '“' + text + '”');
  n.append(el('span', 'rc-tr', t.translated));
  return n;
}
// The quote for a field in the report language, or null.
function quoteFor(quote, span, quoteTr, lang, t) {
  if (!foreign(quote, lang)) return quoteNode('q', snippetParts(quote, span));
  if (quoteTr) return trNode(quoteTr, t);
  return el('span', 'q', t.saidIn);
}

function sentenceNode(quote, spans, t) {
  const n = el('div', 'rc-src');
  n.append(el('span', null, t.said));
  let pos = 0;
  n.append(document.createTextNode('“'));
  for (const [s, e] of spans) {
    n.append(document.createTextNode(quote.slice(pos, s)), el('b', null, quote.slice(s, e)));
    pos = e;
  }
  n.append(document.createTextNode(quote.slice(pos) + '”'));
  return n;
}

const stepText = (s, lang) => (lang && lang !== 'th' ? s.text || s.en || s.th : s.th || s.text);
const shownValue = (value, valueTr, lang) => (foreign(value, lang) && valueTr ? valueTr : value);

// Plain-text version for copy / share (readable in LINE, WhatsApp or SMS),
// in the report language.
export function reportText(r) {
  const t = T(r);
  const lang = r.lang || 'th';
  const th = lang === 'th';
  const out = [t.head, r.urgent ? `${t.urgent}: ${t.urgentSub}` : '', (th ? r.headlineTh : r.headline) || r.headline || r.verdictText || r.verdictTh || ''];
  const typeText = th ? r.callTypeTh : (r.callTypeText || r.callTypeEn);
  if (typeText && r.callType !== 'scam' && r.callType !== 'normal') out.push(`${t.type}: ${typeText}`);
  if (r.confidence != null) out.push(`${t.conf} ${Math.round(r.confidence * 100)}%`);
  const snip = (q, sp, qTr) => {
    if (foreign(q, lang)) return qTr ? `"${qTr}" (${t.translated})` : `(${t.saidIn})`;
    const p = snippetParts(q, sp);
    return `"${p.before}${p.match}${p.after}"`;
  };
  if (r.claimedIdentity) {
    const ci = r.claimedIdentity;
    out.push(`${t.who}: ${shownValue(ci.value, ci.valueTr, lang)}\n  ${snip(ci.quote, ci.span, ci.quoteTr)}`);
  }
  if (r.intel?.length) {
    out.push(`${t.intel}:`);
    for (const g of groupBySource(r.intel)) {
      const label = (i) => (th ? i.labelTh : i.label) || i.labelTh || i.type;
      if (g.items.length === 1 || foreign(g.quote, lang)) {
        for (const i of g.items) out.push(`- ${label(i)}: ${shownValue(i.value, i.valueTr, lang)}\n  ${snip(i.quote, i.span, i.quoteTr)}`);
      } else {
        out.push(`${t.said}: "${g.quote}"`);
        for (const i of g.items) out.push(`- ${label(i)}: ${i.value}`);
      }
    }
  }
  if (r.nextSteps?.length) {
    out.push(`${t.steps}:`);
    r.nextSteps.forEach((s, n) => out.push(`${n + 1}. ${stepText(s, lang)}${s.url ? ` ${s.url}` : ''}`));
  }
  const loc = th ? 'th-TH' : lang === 'zh' ? 'zh-CN' : 'en-GB';
  out.push(`${t.made} ${new Date(r.generatedAt || Date.now()).toLocaleString(loc)} · ${t.quoteNote}`);
  return out.filter(Boolean).join('\n');
}

function row(label, value, quoteEl, mono) {
  const r = el('div', 'rc-row');
  r.append(el('span', 'l', label), el('span', mono ? 'v mono' : 'v', value));
  if (quoteEl) r.append(quoteEl);
  return r;
}

const ICON = {
  SCAM: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  UNSURE: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M12 8v5M12 16.5v.01"/></svg>',
  LEGIT: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
};

export function renderReport(container, report, { source } = {}) {
  injectCss();
  const r = report || {};
  const t = T(r);
  const lang = r.lang || 'th';
  const th = lang === 'th';
  const v = safeVerdict(r.verdict);
  const card = el('section', `rc v-${v}`);
  card.setAttribute('aria-label', t.title);
  card.lang = lang === 'zh' ? 'zh-CN' : lang;
  // B25: a reported emergency goes on top in red, with what the caller gave
  if (r.urgent) {
    const u = el('div', 'rc-urgent');
    u.setAttribute('role', 'alert');
    u.append(el('b', null, t.urgent), el('span', null, ' · ' + t.urgentSub));
    const who = r.urgent.who && foreign(r.urgent.who, lang) ? r.urgent.whoTr : r.urgent.who;
    const facts = [[t.caller, who], [t.number, r.urgent.phone], [t.place, foreign(r.urgent.place, lang) ? null : r.urgent.place]].filter(([, x]) => x);
    for (const [k, x] of facts) u.append(el('div', 'rc-urgent-f', `${k}: ${x}`));
    card.append(u);
  }
  const top = el('div', 'rc-top');
  top.append(el('span', 'rc-k', t.title));
  const vh = el('div', 'rc-verdict');
  const ico = el('span', 'rc-ico');
  ico.innerHTML = ICON[v];
  vh.append(ico, el('h2', null, (th ? r.verdictTh : r.verdictText) || r.verdictText || r.verdictTh || t.verdictWord[v]));
  // The headline starts with the verdict words already in the title: drop them.
  const vtitle = (th ? r.verdictTh : r.verdictText) || '';
  let head = (th ? r.headlineTh : r.headline) || r.headline || r.headlineTh || '';
  if (vtitle && head.startsWith(vtitle + ' · ')) head = head.slice(vtitle.length + 3);
  head = head.charAt(0).toUpperCase() + head.slice(1);
  top.append(vh, el('p', 'rc-head', head));
  if (r.confidence != null) {
    const c = el('div', 'rc-conf');
    const bar = el('i');
    const b = el('b');
    b.style.width = Math.round(r.confidence * 100) + '%';
    bar.append(b);
    c.append(el('span', null, t.conf), bar, el('span', null, Math.round(r.confidence * 100) + '%'));
    top.append(c);
  }
  const meta = el('div', 'rc-meta');
  meta.append(el('span', 'rc-chip', t.lang));
  if (r.region) meta.append(el('span', 'rc-chip', t.region[r.region] || r.region));
  meta.append(el('span', 'rc-chip', `${t.ended}: ${t.endedBy[r.endedBy] || r.endedBy || '-'}`));
  top.append(meta);
  card.append(top);

  const body = el('div', 'rc-body');
  const facts = el('div', 'rc-sec');
  // B25: a non-scam kind (abusive debt collection, nuisance, sales) in plain words
  const typeText = th ? r.callTypeTh : (r.callTypeText || r.callTypeEn);
  if (typeText && r.callType !== 'scam' && r.callType !== 'normal') facts.append(row(t.type, typeText));
  const tacticText = th ? r.tacticTh : r.tacticText;
  if (tacticText) facts.append(row(t.tactic, tacticText));
  const ci = r.claimedIdentity;
  facts.append(row(t.who, ci ? shownValue(ci.value, ci.valueTr, lang) : t.notSaid,
    ci ? quoteFor(ci.quote, ci.span, ci.quoteTr, lang, t) : null));
  body.append(facts);

  if (Array.isArray(r.intel) && r.intel.length) {
    const sec = el('div', 'rc-sec');
    sec.append(el('span', 'rc-k', t.intel));
    const mono = (i) => ['bank-account', 'phone', 'badge', 'line-id', 'url'].includes(i.type);
    const label = (i) => (th ? i.labelTh : i.label) || i.labelTh || i.type;
    for (const g of groupBySource(r.intel)) {
      if (g.items.length === 1 || foreign(g.quote, lang)) {
        for (const i of g.items) sec.append(row(label(i), shownValue(i.value, i.valueTr, lang), quoteFor(i.quote, i.span, i.quoteTr, lang, t), mono(i)));
        continue;
      }
      // Several fields from one sentence: the sentence once, fields under it.
      const box = el('div', 'rc-group');
      box.append(sentenceNode(g.quote, mergedSpans(g.quote, g.items), t));
      for (const i of g.items) box.append(row(label(i), i.value, null, mono(i)));
      sec.append(box);
    }
    body.append(sec);
  }

  if (Array.isArray(r.nextSteps) && r.nextSteps.length) {
    const sec = el('div', 'rc-sec');
    sec.append(el('span', 'rc-k', t.steps));
    const ol = el('ol');
    for (const s of r.nextSteps) {
      const li = el('li', null, stepText(s, lang));
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
    body.append(sec);
  }
  card.append(body);

  const act = el('div', 'rc-act');
  const status = el('span', 'rc-status');
  status.setAttribute('role', 'status');
  const text = reportText(r);
  const copyBtn = el('button', null, t.copy);
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = t.copied;
    } catch {
      status.textContent = t.copyFail;
    }
  });
  act.append(copyBtn);
  if (navigator.share) {
    const shareBtn = el('button', 'ghost', t.share);
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ title: t.head, text });
        status.textContent = t.shared;
      } catch (e) {
        status.textContent = e?.name === 'AbortError' ? '' : t.shareFail;
      }
    });
    act.append(shareBtn);
  }
  act.append(status);
  card.append(act);
  card.append(el('p', 'rc-foot', source === 'fallback' ? t.footFallback : t.footModel));

  container.replaceChildren(card);
  return card;
}

export function renderLoading(container, lang = 'th') {
  injectCss();
  const t = RC_TEXT[lang] || RC_TEXT.th;
  const loading = el('section', 'rc rc-load');
  loading.append(el('span', 'rc-k', t.title));
  const p = el('p', null, t.loading);
  loading.append(p, el('i'));
  container.replaceChildren(loading);
}

export async function mountReportCard(container, { apiJson, lines = [], intel = [], endedBy = 'hangup', verdict, lang, region } = {}) {
  injectCss();
  if (!container) return null;
  const t = RC_TEXT[lang] || RC_TEXT.th;
  renderLoading(container, lang);
  const callerLines = (Array.isArray(lines) ? lines : []).filter((l) => l && l.speaker === 'caller' && String(l.text || '').trim());
  if (!callerLines.length) {
    container.replaceChildren(el('p', 'rc-status', t.noCaller));
    return null;
  }
  try {
    const body = { lines, intel, endedBy, verdict };
    if (lang) body.lang = lang;
    if (region) body.region = region;
    const data = await apiJson('/api/report', body);
    if (!data?.ok || !data.report) throw new Error(data?.error || 'report-failed');
    return renderReport(container, data.report, { source: data.source });
  } catch (e) {
    const box = el('section', 'rc rc-load');
    const msg = lang === 'th' || !lang ? (e?.messageTh || e?.message) : (e?.messageEn || e?.message);
    box.append(el('span', 'rc-k', t.title), el('p', 'rc-status', `${t.failed}: ${String(msg || 'error').slice(0, 120)} — ${t.later}`));
    container.replaceChildren(box);
    return null;
  }
}
