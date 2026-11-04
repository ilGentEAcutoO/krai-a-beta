/* Landing page motion + section nav.
   - .lp-toc chips: aria-current follows the section in view; the active chip scrolls into the chip row.
   - Reveals: only elements below the fold at load get .rv (hidden), then .rv-in when they scroll in.
     Opacity/transform only, <= 600 ms. Nothing happens under prefers-reduced-motion or without
     IntersectionObserver, and without JS everything is simply visible.
   - Count-ups: whole numbers >= 10 in metrics count up once, width locked so nothing shifts. */
(() => {
  const toc = document.querySelector('.lp-toc');
  const top = document.querySelector('.k-top');
  if (!('IntersectionObserver' in window)) return;

  if (toc) {
    const setTop = () => { if (top) toc.style.setProperty('--toc-top', top.getBoundingClientRect().height + 'px'); };
    setTop();
    window.addEventListener('scroll', setTop, { passive: true });
    window.addEventListener('resize', setTop);
    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const row = toc.querySelector('.lp-toc-in');
    const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    const seen = new Map();
    const mark = () => {
      let best = null;
      for (const el of targets) {
        const r = seen.get(el);
        if (r && r.top < window.innerHeight * 0.45 && r.bottom > 140) best = el;
      }
      for (const a of links) {
        const on = best && a.getAttribute('href') === '#' + best.id;
        if (on) {
          if (a.getAttribute('aria-current') !== 'true') {
            a.setAttribute('aria-current', 'true');
            const x = a.offsetLeft - (row.clientWidth - a.offsetWidth) / 2;
            row.scrollTo({ left: Math.max(0, x), behavior: 'smooth' });
          }
        } else a.removeAttribute('aria-current');
      }
    };
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) seen.set(e.target, e.boundingClientRect);
      mark();
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1], rootMargin: '-120px 0px 0px 0px' });
    targets.forEach((el) => io.observe(el));
    window.addEventListener('scroll', () => {
      for (const el of targets) seen.set(el, el.getBoundingClientRect());
      mark();
    }, { passive: true });
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SEL = [
    '#main .k-sec-head', '#main .k-card', '#main .lp-why li', '#main .k-step', '#main .lp-judge-grid li',
    '#main .ov-n', '#main .lp-ov-h', '#main .ov-back', '#main .lp-cov-langs li', '#main .lp-cov-who li',
    '#main .lp-rc', '#main .lp-vsec .lp-video', '#main .lp-vsec-h', '#main h2'
  ].join(',');
  const els = [...new Set(document.querySelectorAll(SEL))].filter((el) => el.getBoundingClientRect().top > window.innerHeight);
  for (const el of els) {
    const i = [...el.parentElement.children].indexOf(el);
    el.style.setProperty('--rv-d', Math.min(i, 8) * 45 + 'ms');
    el.classList.add('rv');
  }
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('rv-in');
      io.unobserve(e.target);
      countIn(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));

  function countIn(root) {
    for (const b of root.querySelectorAll('.k-metric b, .ov-m b')) {
      const m = b.textContent.match(/^(\D*)(\d+)(.*)$/);
      if (!m || Number(m[2]) < 10 || b.dataset.counted) continue;
      b.dataset.counted = '1';
      const end = Number(m[2]);
      const w = b.getBoundingClientRect().width;
      b.classList.add('lp-num');
      b.style.minWidth = w + 'px';
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 600);
        const e = 1 - Math.pow(1 - k, 3);
        b.textContent = m[1] + Math.round(end * e) + m[3];
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }
})();
