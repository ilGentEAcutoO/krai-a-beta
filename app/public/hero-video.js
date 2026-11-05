/* Landing videos, from /video.json:
     {"en":"","th":"","social":{"en":"","th":""}}
   Top-level en/th is the 3-minute demo (#heroVideo); "social" is the 45-second cut (#socialVideo),
   whose section stays hidden while it has no id. One YouTube id per language.
   EN never shows the TH video; TH falls back to the EN video with Thai captions.
   Click-to-load facade: nothing from YouTube loads until the visitor presses play.
   Also starts the muted hero phone recording, except under prefers-reduced-motion (poster only). */
(() => {
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let cfg = {};
  const boxes = [...document.querySelectorAll('.lp-video[data-video-key]')];

  function pick(src) {
    const lang = (window.kraiLang && window.kraiLang()) || 'en';
    const en = ID.test((src && src.en) || '') ? src.en : '';
    const th = ID.test((src && src.th) || '') ? src.th : '';
    if (lang === 'th') return th ? { id: th, cc: false } : (en ? { id: en, cc: true } : null);
    return en ? { id: en, cc: false } : null;
  }

  // Self-hosted demo (R2, same origin): video.json "self": {"en": {src, src720, poster}, "th": {...}}.
  // EN page plays the EN file, TH page the TH file (falls back to EN). "Watch on YouTube" link
  // only for a language whose YouTube id is set (a private video stays hidden).
  function renderSelf(box) {
    const vid = box.querySelector('video.lp-video-self');
    const self = cfg.self || {};
    const lang = (window.kraiLang && window.kraiLang()) || 'en';
    const s = self[lang] || self.en;
    const soon = box.querySelector('.lp-video-soon');
    const play = box.querySelector('.lp-video-play');
    if (!vid || !s || !s.src) return false;
    box.dataset.state = 'self';
    if (soon) soon.hidden = true;
    if (play) play.hidden = true;
    vid.hidden = false;
    if (vid.dataset.src !== s.src) {
      vid.pause();
      vid.dataset.src = s.src;
      if (s.poster) vid.poster = s.poster;
      vid.replaceChildren();
      if (s.src720) {
        const small = document.createElement('source');
        small.src = s.src720; small.type = 'video/mp4'; small.media = '(max-width: 900px)';
        vid.appendChild(small);
      }
      const big = document.createElement('source');
      big.src = s.src; big.type = 'video/mp4';
      vid.appendChild(big);
      vid.load();
    }
    const yt = document.getElementById('demoYt');
    if (yt) {
      const id = ID.test(cfg[lang] || '') ? cfg[lang] : '';
      yt.hidden = !id;
      const a = yt.querySelector('a');
      if (a && id) a.href = 'https://youtu.be/' + id;
    }
    return true;
  }

  function render(box) {
    const key = box.dataset.videoKey;
    if (!key && renderSelf(box)) return;
    const selfVid = box.querySelector('video.lp-video-self');
    if (selfVid) selfVid.hidden = true;
    const v = pick(key ? cfg[key] : cfg);
    const soon = box.querySelector('.lp-video-soon');
    const play = box.querySelector('.lp-video-play');
    const img = play.querySelector('img');
    const sec = box.closest('section');
    if (key && sec) sec.hidden = !v;
    const old = box.querySelector('iframe');
    if (old && old.dataset.id !== (v && v.id)) { old.remove(); }
    if (box.querySelector('iframe')) return;
    if (!v) { box.dataset.state = 'soon'; if (soon) soon.hidden = false; play.hidden = true; return; }
    box.dataset.state = 'ready'; if (soon) soon.hidden = true; play.hidden = false;
    play.dataset.id = v.id; play.dataset.cc = v.cc ? '1' : '';
    img.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
  }

  for (const box of boxes) {
    const play = box.querySelector('.lp-video-play');
    play.addEventListener('click', () => {
      const id = play.dataset.id;
      if (!ID.test(id || '')) return;
      const q = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1' });
      if (play.dataset.cc) { q.set('cc_load_policy', '1'); q.set('cc_lang_pref', 'th'); q.set('hl', 'th'); }
      const f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?' + q;
      f.title = play.getAttribute('aria-label') || 'Demo video';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.dataset.id = id;
      play.hidden = true;
      box.appendChild(f);
    });
  }
  const renderAll = () => boxes.forEach(render);
  document.addEventListener('krai:lang', renderAll);
  fetch('/video.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : {}).catch(() => ({}))
    .then((c) => { cfg = c || {}; renderAll(); });

  // Hero phone: muted loop, never under reduced motion.
  const phone = document.getElementById('heroPhone');
  if (phone) {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      if (rm.matches) { phone.pause(); return; }
      phone.muted = true;
      if (phone.preload === 'none') { phone.preload = 'auto'; phone.load(); }
      const p = phone.play();
      if (p && p.catch) p.catch(() => {});
    };
    const start = () => (window.requestIdleCallback || setTimeout)(sync);
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
    if (rm.addEventListener) rm.addEventListener('change', sync);
  }
})();
