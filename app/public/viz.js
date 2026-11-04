// Visual heroes + section reveals for /proof, /arena and /showdown (not used by index.html).
// Every number is read from the page's existing data files; nothing is hard-coded here.
// Motion is transform/opacity only, off under prefers-reduced-motion, and content is visible without JS.
const page = document.body.dataset.vz || '';
const mount = document.getElementById('vzHero');
const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const lang = () => (window.kraiLang ? window.kraiLang() : 'en');
const L = (th, en) => (lang() === 'th' ? th : en);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pc = (k, n) => (n ? `${Math.round((k / n) * 1000) / 10}%` : 'n/a');

// ---------- reveal + count-up ----------
let io = null;
if (!reduce && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('vz-on');
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      e.target.querySelectorAll('[data-vz-count]').forEach(countUp);
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
}
function watch(el) {
  if (!el) return;
  if (!io) { el.classList.add('in'); return; }
  el.classList.add('vz-rv');
  io.observe(el);
}
function countUp(el) {
  const to = Number(el.dataset.vzCount);
  if (!Number.isFinite(to) || to <= 0 || reduce) return;
  const t0 = performance.now(), dur = 900;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur), v = Math.round(to * (1 - Math.pow(1 - p, 3)));
    el.textContent = String(v);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = String(to);
  };
  requestAnimationFrame(tick);
}
const RV = 'main .k-sec-head, main .sd-card, main .k-card, main .k-details, main .k-table-wrap:not(.k-card .k-table-wrap), .vz-card';
function watchAll(late = false) {
  document.querySelectorAll(RV).forEach((el) => {
    if (el.classList.contains('vz-rv') || el.closest('.vz-rv') || el.closest('[hidden]')) return;
    if (late && el.getBoundingClientRect().top < innerHeight) return; // already on screen: never hide it again
    watch(el);
  });
}

// ---------- shared bits ----------
// A bar of segments [count, cls, label]; width is total/max of the row group.
function bar(segs, total, max, delay = 0) {
  const w = max ? (total / max) * 100 : 100;
  return `<div class="vz-bar" style="width:${w.toFixed(2)}%;--d:${delay}ms">${segs.filter(([k]) => k > 0).map(([k, cls, label]) =>
    `<span class="vz-seg ${cls}" style="flex-grow:${k}" title="${esc(label)}: ${k}"><i>${k}</i></span>`).join('')}</div>`;
}
const legend = (items) => `<ul class="vz-legend">${items.map(([cls, label]) => `<li><span class="vz-sw ${cls}"></span>${esc(label)}</li>`).join('')}</ul>`;

// ---------- /proof ----------
function proofHero(d) {
  const sets = [
    [d.sealedV4Runs, L('Sealed v4 · ชุดทดสอบความทนทาน', 'Sealed v4 · adversarial stress set')],
    [d.sealedIntlRuns, L('Sealed intl · 9 ภาษา', 'Sealed intl · 9 languages')],
    [d.sealedV2Runs, L('Sealed v2 · ไทย/อังกฤษ', 'Sealed v2 · Thai/English')],
    [d.sealedRuns, L('Sealed v1 · ไทย', 'Sealed v1 · Thai')],
  ].filter(([runs]) => runs && runs.length).map(([runs, name]) => [runs[runs.length - 1], name]);
  if (!sets.length) return;
  const fa = sets.reduce((a, [r]) => [a[0] + r.falseAlarm.k, a[1] + r.falseAlarm.n], [0, 0]);
  const max = Math.max(...sets.flatMap(([r]) => [r.scamRecall.n, r.falseAlarm.n]));
  const rows = sets.map(([r, name], i) => {
    const held = r.scamRecall.n - r.scamRecall.k - (r.unsafeMiss || 0);
    const slip = r.unsafeMiss || 0;
    return `<li class="vz-row">
<div class="vz-row-h"><b>${esc(name)}</b><span>${r.accuracy.n} ${L('สาย', 'calls')}</span></div>
<div class="vz-pair">
<span class="vz-lab">${L('มิจ', 'Scams')}</span>${bar([[r.scamRecall.k, 'blk', L('บล็อก', 'blocked')], [held, 'hld', L('รับฝากเรื่อง', 'held as a message')], [slip, 'slp', L('หลุดเป็นคนจริง', 'slipped through as legit')]], r.scamRecall.n, max, i * 90)}
<span class="vz-lab">${L('คนจริง', 'Real')}</span>${bar([[r.falseAlarm.k, 'blk', L('โดนตัดว่ามิจ', 'judged scam')], [r.falseAlarm.n - r.falseAlarm.k, 'lgt', L('ไม่โดนตัดว่ามิจ', 'not judged scam')]], r.falseAlarm.n, max, i * 90 + 45)}
</div>
<p class="vz-row-f">${L(`บล็อก ${r.scamRecall.k}/${r.scamRecall.n} · รับฝาก ${held} · หลุด ${slip} · คนจริงโดนตัดว่ามิจ ${r.falseAlarm.k}/${r.falseAlarm.n}`, `blocked ${r.scamRecall.k}/${r.scamRecall.n} · held ${held} · slipped ${slip} · real judged scam ${r.falseAlarm.k}/${r.falseAlarm.n}`)}</p>
</li>`;
  }).join('');
  mount.innerHTML = `<div class="vz-big">
<p class="vz-kicker">${L('ชุดปิดผนึก 4 ชุด รันชุดละครั้ง', 'Four sealed sets, each run once')}</p>
<p class="vz-num"><span data-vz-count="${fa[0]}">${fa[0]}</span><small>/<span data-vz-count="${fa[1]}">${fa[1]}</span></small></p>
<p class="vz-cap">${L('คนจริงที่ถูกตัดสินว่าเป็นมิจ', 'real callers judged scam')}</p>
${legend([['blk', L('บล็อก / ตัดว่ามิจ', 'blocked / judged scam')], ['hld', L('รับฝากเรื่อง', 'held as a message')], ['slp', L('หลุดเป็นคนจริง', 'slipped through')], ['lgt', L('คนจริงผ่าน', 'real caller not judged scam')]])}
</div>
<ol class="vz-rows" aria-label="${esc(L('ผลแต่ละชุด', 'Each sealed set'))}">${rows}</ol>`;
}

// ---------- /arena ----------
function arenaHero(a) {
  const all = a.totals.all, after = a.after?.totals?.all;
  mount.innerHTML = `<div class="vz-duel" aria-hidden="true">
<svg viewBox="0 0 400 120" class="vz-duel-svg">
<line class="vz-wire" x1="70" y1="60" x2="330" y2="60" pathLength="1"/>
<g class="vz-pulses s">${[0, 1, 2].map((i) => `<circle cx="70" cy="52" r="5" style="--i:${i}"/>`).join('')}</g>
<g class="vz-pulses k">${[0, 1, 2].map((i) => `<circle cx="330" cy="68" r="5" style="--i:${i}"/>`).join('')}</g>
<g class="vz-node s"><circle cx="46" cy="60" r="38"/><text x="46" y="66">AI</text></g>
<g class="vz-node k"><circle cx="354" cy="60" r="38"/><text x="354" y="66">K</text></g>
</svg>
<div class="vz-duel-l"><span><b>${L('AI มิจ', 'AI scammer')}</b>Muse Wonder</span><span><b>KRAI‑A</b>Muse Spark</span></div>
</div>
<div class="vz-arena-n">
<p class="vz-num"><span data-vz-count="${all.calls}">${all.calls}</span></p>
<p class="vz-cap">${L(`เกมที่เล่นจริงทั้งสาย · บล็อกมิจ ${all.scam.blocked}/${all.scam.n}`, `full calls played · ${all.scam.blocked}/${all.scam.n} scams blocked`)}</p>
</div>
<div class="vz-fix">
<p class="vz-fix-t">${L('คนจริงที่โดนวางสายผิด', 'Real callers wrongly blocked')}</p>
<div class="vz-fix-r"><span class="vz-pill p-bad">${all.legit.blocked}/${all.legit.n}</span><span class="vz-arrow" aria-hidden="true">→</span>${after ? `<span class="vz-pill p-ok">${after.legit.blocked}/${after.legit.n}</span>` : ''}</div>
<p class="vz-fix-s">${L('รอบแรกทั้งหมด → เล่นชุด holdout ซ้ำหลังแก้', 'first run, all games → held-out replay after the fix')}</p>
</div>`;
}

// ---------- /showdown ----------
function showdownHero(d) {
  const t = d.sets?.train?.runs;
  if (!t || t.spark?.status !== 'done' || t.jev?.status !== 'done') return;
  const o = t.jev.metrics, n = t.spark.metrics;
  const rows = [
    [L('จับมิจได้', 'Scams caught'), 'm-good', (m) => [m.scamRecall.k, m.scamRecall.n]],
    [L('คนจริงโดนตัดว่ามิจ', 'Real callers judged scam'), 'm-bad', (m) => [m.falseAlarm.k, m.falseAlarm.n]],
    [L('คนจริงที่ตัดสินไม่ได้ (รับฝากเรื่อง)', 'Real callers left unsure'), 'm-warn', (m) => [m.unsure.legit.k, m.unsure.legit.n]],
    [L('ตรงคลาสทั้งหมด', 'Exact class, all calls'), 'm-good', (m) => [m.accuracy.k, m.accuracy.n]],
  ];
  const meter = (k, nn, cls, i) => `<div class="vz-meter ${cls}"><span style="width:${nn ? (k / nn) * 100 : 0}%;--d:${i * 70}ms"></span></div>`;
  mount.innerHTML = `<div class="vz-sd-head">
<div class="vz-side old"><i>B</i><span><b>${L('ตัวเก่า · Jev', 'Old judge · Jev')}</b>${L(`ชุด train ${o.n} สาย`, `train set, ${o.n} calls`)}</span></div>
<span class="vz-vs">vs</span>
<div class="vz-side new"><i>M</i><span><b>${L('ผลงานนี้ · Muse Spark', 'This entry · Muse Spark')}</b>${L(`ชุด train ${n.n} สาย`, `train set, ${n.n} calls`)}</span></div>
</div>
<ul class="vz-sd-rows">${rows.map(([label, cls, f], i) => {
    const [ok, on] = f(o), [nk, nn] = f(n);
    return `<li><p class="vz-sd-l">${esc(label)}</p>
<div class="vz-sd-c old"><b>${pc(ok, on)}</b><small>${ok}/${on}</small>${meter(ok, on, cls, i)}</div>
<div class="vz-sd-c new"><b>${pc(nk, nn)}</b><small>${nk}/${nn}</small>${meter(nk, nn, cls, i)}</div></li>`;
  }).join('')}</ul>
<p class="vz-sd-note">${L(`ไฟล์เดียวกัน (${esc(t.spark.dataset)}) ตัวเก่าถูกแช่แข็งตอนชุดมี ${o.n} สาย ผลงานนี้รันบนชุดที่โตเป็น ${n.n} สาย จึงเทียบเป็นสัดส่วน`, `Same file (${esc(t.spark.dataset)}). The old judge was frozen when the set had ${o.n} calls; this entry ran on the grown set of ${n.n}, so compare the rates.`)}</p>`;
}

// ---------- boot ----------
const SRC = { proof: '/proof/data.json', arena: '/arena/data.json', showdown: '/proof/data.json' };
const DRAW = { proof: proofHero, arena: arenaHero, showdown: showdownHero };
let DATA = null;
function draw() {
  if (!DATA || !mount) return;
  try { DRAW[page](DATA); } catch (e) { console.warn('viz', e); return; }
  const card = mount.closest('.vz-card') || mount;
  if (card.classList.contains('in') || !io) mount.querySelectorAll('[data-vz-count]').forEach((el) => { el.textContent = el.dataset.vzCount; });
}
if (mount && SRC[page]) {
  fetch(SRC[page]).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))).then((d) => {
    DATA = d; draw();
    const card = mount.closest('.vz-card');
    if (card && card.classList.contains('in')) card.querySelectorAll('[data-vz-count]').forEach(countUp);
  }).catch(() => { /* the page's own loader reports load errors */ });
  document.addEventListener('krai:lang', draw);
}
watchAll();
// Sections that the page scripts fill later (cards inside rendered HTML) join once they exist.
setTimeout(() => watchAll(true), 1200);
