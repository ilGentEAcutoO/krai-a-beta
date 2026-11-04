// Designed file picker: shows the chosen name and accepts drag-and-drop.
// The page's own change handler on the hidden input is unchanged; a drop sets input.files and fires 'change'.
(() => {
  const lang = () => (window.kraiLang ? window.kraiLang() : 'en');
  const accepts = (input, file) => {
    const list = (input.accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    const name = file.name.toLowerCase(); const type = (file.type || '').toLowerCase();
    return list.some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a));
  };
  document.querySelectorAll('.k-file').forEach((box) => {
    const input = box.querySelector('input[type=file]');
    const nameEl = box.querySelector('.k-file-name');
    const errEl = box.querySelector('.k-file-err');
    if (!input) return;
    const show = () => {
      const f = input.files && input.files[0];
      if (nameEl) nameEl.textContent = f ? f.name : '';
      box.classList.toggle('has', !!f);
    };
    input.addEventListener('change', () => { if (errEl) errEl.textContent = ''; show(); });
    let depth = 0;
    box.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; box.classList.add('drag'); });
    box.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    box.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; box.classList.remove('drag'); } });
    box.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; box.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (!accepts(input, f)) {
        if (errEl) errEl.textContent = lang() === 'th' ? 'ไฟล์นี้ใช้ไม่ได้ ลองไฟล์ ' + (box.dataset.kind || '') + ' อีกครั้ง' : 'That file type does not fit here. Try a ' + (box.dataset.kind || 'matching') + ' file.';
        return;
      }
      try { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; } catch { return; }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
})();
