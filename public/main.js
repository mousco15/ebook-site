// public/main.js — liste, filtre, pagination

const listEl = document.getElementById('ebook-list');
const pagerEl = document.getElementById('pager');
const searchEl = document.getElementById('search');
const languageEl = document.getElementById('language');
const categoryEl = document.getElementById('category');

let state = {
  page: 1,
  pageSize: 6,
  q: '',
  language: '',
  category: ''
};

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

async function loadEbooks() {
  try {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
      q: state.q || '',
      language: state.language || '',
      category: state.category || ''
    });
    const res = await fetch(`/api/ebooks?${params.toString()}`, { credentials: 'include' });
    const { data, total, page, pageSize } = await res.json();

    // Cartes
    listEl.innerHTML = data.map(e => `
      <article class="card">
        <div class="card-cover">
          ${e.cover_path ? `<img src="${escapeHtml(e.cover_path)}" alt="${escapeHtml(e.title || '')}">`
                         : `<div class="no-cover">Aucune couverture</div>`}
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(e.title || '')}</h3>
          <p class="card-author">${escapeHtml(e.author || '')}</p>
          ${e.description ? `<p class="card-desc">${escapeHtml(e.description)}</p>` : ''}
          <div class="card-actions">
            ${e.pdf_path ? `<a class="btn" href="${escapeHtml(e.pdf_path)}" target="_blank" rel="noopener">Voir</a>` : ''}
          </div>
        </div>
      </article>
    `).join('');

    // Pagination
    const pages = Math.max(Math.ceil((total || 0) / pageSize), 1);
    pagerEl.innerHTML = `
      <button class="btn min" ${page <= 1 ? 'disabled' : ''} data-go="first">«</button>
      <button class="btn" ${page <= 1 ? 'disabled' : ''} data-go="prev">Précédent</button>
      <span class="page-indicator">Page ${page} / ${pages}</span>
      <button class="btn" ${page >= pages ? 'disabled' : ''} data-go="next">Suivant</button>
      <button class="btn min" ${page >= pages ? 'disabled' : ''} data-go="last">»</button>
    `;

    pagerEl.querySelectorAll('button[data-go]').forEach(b => {
      b.addEventListener('click', () => {
        const action = b.getAttribute('data-go');
        if (action === 'first') state.page = 1;
        if (action === 'prev') state.page = Math.max(state.page - 1, 1);
        if (action === 'next') state.page = state.page + 1;
        if (action === 'last') state.page = pages;
        loadEbooks();
      });
    });

  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="error">Erreur de chargement.</div>`;
  }
}

// Filtres
searchEl?.addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  state.page = 1;
  loadEbooks();
});
languageEl?.addEventListener('change', (e) => {
  state.language = e.target.value.trim();
  state.page = 1;
  loadEbooks();
});
categoryEl?.addEventListener('input', (e) => {
  state.category = e.target.value.trim();
  state.page = 1;
  loadEbooks();
});

// Première charge
loadEbooks();
