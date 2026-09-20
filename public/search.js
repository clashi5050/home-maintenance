// Search everything from anywhere: the magnifier in the header, or press "/".
import { $, api, esc, openDialog } from './lib.js';

const ROUTES = {
  maintenance: '#/maintenance', appliances: '#/appliances', vendors: '#/vendors', projects: '#/projects',
  documents: '#/documents', log: '#/log', home: '#/home',
};

function openSearch() {
  if ($('dialog.search')) return;
  const dlg = openDialog(`<div class="form">
    <input id="q" type="search" placeholder="Search maintenance, appliances, vendors, documents…" aria-label="Search" autocomplete="off">
    <div id="results" class="results" role="listbox"></div>
  </div>`);
  dlg.classList.add('search');
  const input = $('#q', dlg);
  const results = $('#results', dlg);
  let timer;
  let latest = 0; // responses can arrive out of order; only the newest query may draw

  const run = async () => {
    const q = input.value.trim();
    const mine = ++latest;
    if (q.length < 2) { results.innerHTML = '<div class="empty small">Type at least two letters.</div>'; return; }
    try {
      const hits = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
      if (mine !== latest) return;
      results.innerHTML = hits.length
        ? hits.map((h) => `<a class="result" href="${ROUTES[h.route]}" data-close role="option"><span class="pill idea">${esc(h.type)}</span>
            <span><strong>${esc(h.title)}</strong>${h.sub ? `<span class="muted small"> · ${esc(h.sub)}</span>` : ''}</span></a>`).join('')
        : '<div class="empty small">No matches.</div>';
    } catch (err) { if (mine === latest) results.innerHTML = `<div class="empty small">${esc(err.message)}</div>`; }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  input.focus();
  run();
}

export function initSearch() {
  $('#search-btn').addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openSearch(); }
  });
}
