/* /demo-live.html?view=call: the same call console, laid out full screen like a native in-call screen
   (page chrome hidden). Runs in <head> so the normal layout never flashes. Without the param nothing changes. */
(function () {
  try {
    if (new URLSearchParams(location.search).get('view') === 'call') document.documentElement.classList.add('ds-callview');
  } catch (e) { /* ignore */ }
})();
