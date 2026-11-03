/* KRAI-A beta shared page script (krai.css companion). No build step.
 *
 * TH/EN toggle: any element with data-th + data-en gets its innerHTML from the
 * active language (the strings are ours, written in the page source). For
 * attributes use data-th-<attr> / data-en-<attr>, e.g. data-th-placeholder,
 * data-en-aria-label. <body data-title-th / data-title-en> sets the tab title.
 * The toggle is any [data-lang] button inside .k-lang. The choice is kept per
 * browser (localStorage, wrapped: a private window falls back to the default).
 * Pages that render text later listen for the 'krai:lang' event
 * (detail.lang = 'th' | 'en') and read window.kraiLang().
 *
 * Also: the top bar gets .is-stuck once the page scrolls, and
 * window.kraiToast(text, { bad }) shows the shared .k-toast (no browser dialogs).
 */
(() => {
  const KEY = 'krai-lang';
  const root = document.documentElement;
  const fallback = document.body?.dataset.defaultLang === 'th' ? 'th' : 'en';
  let lang = fallback;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'th' || saved === 'en') lang = saved;
  } catch { /* storage blocked */ }

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'content'];
  function apply(next) {
    lang = next === 'th' ? 'th' : 'en';
    root.lang = lang;
    for (const el of document.querySelectorAll('[data-th][data-en]')) {
      const v = el.dataset[lang];
      if (v != null && el.innerHTML !== v) el.innerHTML = v;
    }
    for (const a of ATTRS) {
      const camel = a.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const key = lang + camel[0].toUpperCase() + camel.slice(1);
      for (const el of document.querySelectorAll(`[data-${lang}-${a}]`)) {
        const v = el.dataset[key];
        if (v != null) el.setAttribute(a, v);
      }
    }
    const t = document.body?.dataset[lang === 'th' ? 'titleTh' : 'titleEn'];
    if (t) document.title = t;
    for (const b of document.querySelectorAll('.k-lang [data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    document.dispatchEvent(new CustomEvent('krai:lang', { detail: { lang } }));
  }
  window.kraiLang = () => lang;
  window.kraiSetLang = (l) => {
    apply(l);
    try { localStorage.setItem(KEY, lang); } catch { /* storage blocked */ }
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.k-lang [data-lang]');
    if (b) window.kraiSetLang(b.dataset.lang);
  });
  apply(lang);

  // top bar: solid once the page scrolls
  const top = document.querySelector('.k-top');
  if (top) {
    const onScroll = () => top.classList.toggle('is-stuck', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // shared toast
  let toastEl = null;
  let timer = 0;
  window.kraiToast = (text, { bad = false, ms = 5000 } = {}) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'k-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.toggle('bad', bad);
    toastEl.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };
})();
