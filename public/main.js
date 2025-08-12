/* main.js — liste publique avec filtres + pagination + styles conservés */

const $ = (sel) => document.querySelector(sel);

async function loadEbooks({ q = '', lang = '', cat = '', page = 1, pageSize = 6 } = {}) {
  const list = $('#ebook-list');
  const pagerPrev = $('#pager-prev');
  const pagerNext = $('#pager-next');
  const countSpan = $('#count');

  try {
    list.innerHTML = '<div class="loading">Chargement…</div>';
    const params = new URLSearchParams({ q, lang, cat, page, pageSize });
    const res = await fetch(`/api/ebooks?${params.toString()}`);
    const data = await res.json();

    const items = data.items || [];
    countSpan.textContent = data.total || 0;

    if (!items.length) {
      list.innerHTML = '<p>Aucun livre pour l’instant.</p>';
      pagerPrev.disabled = true;
      pagerNext.disabled = true;
      return;
    }

    list.innerHTML = items.map(e => `
      <article class="card">
        ${e.cover_path ? `<img class="cover" src="${e.cover_path}" alt="couverture">` : `<div class="cover placeholder"></div>`}
        <div class="info">
          <h3>${e.title || ''}</h3>
          <p class="author">${e.author || ''}</p>
          ${e.description ? `<p class="desc">${e.description}</p>` : ''}
          <div class="actions">
            <a class="btn" href="/ebook?id=${e.id}">Voir</a>
          </div>
        </div>
      </article>
    `).join('');

    pagerPrev.disabled = data.page <= 1;
    pagerNext.disabled = data.page >= data.pages;

    pagerPrev.onclick = () => {
      if (data.page > 1) {
        const s = readSearch();
        loadEbooks({ ...s, page: data.page - 1, pageSize });
      }
    };
    pagerNext.onclick = () => {
      if (data.page < data.pages) {
        const s = readSearch();
        loadEbooks({ ...s, page: data.page + 1, pageSize });
      }
    };

  } catch (err) {
    console.error(err);
    list.innerHTML = '<p>Erreur de chargement.</p>';
    if (pagerPrev) pagerPrev.disabled = true;
    if (pagerNext) pagerNext.disabled = true;
  }
}

function readSearch() {
  return {
    q: ($('#search')?.value || '').trim(),
    lang: ($('#lang')?.value || '').trim(),
    cat: ($('#cat')?.value || '').trim(),
  };
}

window.addEventListener('DOMContentLoaded', () => {
  // champs de filtre s’ils existent dans la page
  $('#search')?.addEventListener('input', () => loadEbooks({ ...readSearch(), page: 1 }));
  $('#lang')?.addEventListener('change', () => loadEbooks({ ...readSearch(), page: 1 }));
  $('#cat')?.addEventListener('change', () => loadEbooks({ ...readSearch(), page: 1 }));

  loadEbooks({ ...readSearch(), page: 1 });
});
