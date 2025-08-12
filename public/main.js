async function search(query='') {
  const q = document.getElementById('q').value;
  const lang = document.getElementById('lang').value;
  const cat = document.getElementById('category').value;
  const params = new URLSearchParams({ q, lang, category: cat });
let CURRENT_PAGE = 1;
let LAST_QUERY = '';
let LAST_LANG = '';
let LAST_CAT = '';

async function loadEbooks(page = 1) {
  const searchInput = document.getElementById('search'); // ton champ recherche
  const langInput   = document.getElementById('lang');   // select langue
  const catInput    = document.getElementById('cat');    // input catégorie
  const list        = document.getElementById('ebook-list');
  const pageInfo    = document.getElementById('pageInfo');
  const prevBtn     = document.getElementById('prevBtn');
  const nextBtn     = document.getElementById('nextBtn');

  const q        = (searchInput?.value || '').trim();
  const language = (langInput?.value || '').trim();   // '' ou 'fr' ...
  const category = (catInput?.value || '').trim();    // '' ou mot clé
  const pageSize = 8;

  // mémorise l’état courant
  CURRENT_PAGE = page;
  LAST_QUERY = q;
  LAST_LANG = language;
  LAST_CAT = category;

  const params = new URLSearchParams({
    q,
    language,
    category,
    page: String(page),
    pageSize: String(pageSize)
  });

  list.innerHTML = '<p>Chargement…</p>';

  try {
    const res = await fetch(`/api/ebooks?${params.toString()}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { items, total, page, hasPrev, hasNext } = await res.json();

    if (!Array.isArray(items) || !items.length) {
      list.innerHTML = '<p>Aucun résultat.</p>';
    } else {
      list.innerHTML = items.map(e => `
        <article class="card">
          ${e.cover_path ? `<img src="${e.cover_path}" alt="${e.title || ''}" class="cover">` : ''}
          <h3>${e.title || ''}</h3>
          <div class="meta">${e.author || ''}</div>
          <p>${e.description || ''}</p>
          <a class="btn" href="/ebook.html?id=${e.id}">Voir</a>
        </article>
      `).join('');
    }

    // pagination UI
    if (pageInfo) pageInfo.textContent = `Page ${page} • ${total} résultat(s)`;
    if (prevBtn) { prevBtn.disabled = !hasPrev; }
    if (nextBtn) { nextBtn.disabled = !hasNext; }
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p>Erreur de chargement.</p>';
  }
}
  const grid = document.getElementById('results');
  grid.innerHTML = items.map(b => `
    <article>
      <img class="cover" src="${b.cover_path || ''}" alt="Couverture">
      <h3>${b.title}</h3>
      <p><small>${b.author}</small></p>
      <p>${(b.description||'').slice(0,120)}${(b.description||'').length>120?'…':''}</p>
      <footer>
        <a href="/ebook.html?id=${b.id}">Voir</a>
      </footer>
    </article>
  `).join('');
}

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});

search();
// Événements recherche + filtres
document.getElementById('search')?.addEventListener('input', () => loadEbooks(1));
document.getElementById('lang')?.addEventListener('change', () => loadEbooks(1));
document.getElementById('cat')?.addEventListener('input',  () => loadEbooks(1));

// Événements pagination
document.getElementById('prevBtn')?.addEventListener('click', () => {
  if (CURRENT_PAGE > 1) loadEbooks(CURRENT_PAGE - 1);
});
document.getElementById('nextBtn')?.addEventListener('click', () => {
  loadEbooks(CURRENT_PAGE + 1);
});

// Chargement initial
loadEbooks(1);
