/* Hero video: one YouTube id per language in /video.json ({"en":"","th":""}).
   EN never shows the TH video; TH falls back to the EN video with Thai captions.
   Click-to-load facade: nothing from YouTube loads until the visitor presses play. */
(() => {
  const box = document.getElementById('heroVideo');
  if (!box) return;
  const soon = box.querySelector('.lp-video-soon');
  const play = box.querySelector('.lp-video-play');
  const img = play.querySelector('img');
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let cfg = {};
  function pickVideo() {
    const lang = (window.kraiLang && window.kraiLang()) || 'en';
    const en = ID.test(cfg.en || '') ? cfg.en : '';
    const th = ID.test(cfg.th || '') ? cfg.th : '';
    if (lang === 'th') return th ? { id: th, cc: false } : (en ? { id: en, cc: true } : null);
    return en ? { id: en, cc: false } : null;
  }
  function render() {
    const v = pickVideo();
    const old = box.querySelector('iframe');
    if (old && old.dataset.id !== (v && v.id)) old.remove();
    if (box.querySelector('iframe')) return;
    if (!v) { box.dataset.state = 'soon'; soon.hidden = false; play.hidden = true; return; }
    box.dataset.state = 'ready'; soon.hidden = true; play.hidden = false;
    play.dataset.id = v.id; play.dataset.cc = v.cc ? '1' : '';
    img.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
  }
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
  document.addEventListener('krai:lang', render);
  fetch('/video.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : {}).catch(() => ({}))
    .then((c) => { cfg = c || {}; render(); });
})();
