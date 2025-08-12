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

// === ADMIN: gestion du formulaire d'ajout (UN SEUL handler) ===
const form = document.getElementById('ebookForm');

if (form) {
  // Évite d'attacher deux fois le même listener si la page recharge partiellement
  if (!form.dataset.bound) {
    form.dataset.bound = '1';

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); // bloque l'envoi HTML par défaut
      const fd = new FormData(form);

      try {
        const res = await fetch('/api/ebooks', {
          method: 'POST',
          body: fd,
          credentials: 'include', // indispensable pour la session admin
        });

        // Essaye de lire la réponse JSON, même si le serveur renvoie une erreur
        let data = {};
        try { data = await res.json(); } catch {}

        if (!res.ok || data?.ok !== true) {
          throw new Error(data?.error || 'upload_failed');
        }

        alert('Ebook ajouté !');
        form.reset();

        // Recharge la liste d'ebooks dans l'admin si la fonction existe
        if (typeof loadAdminList === 'function') {
          await loadAdminList();
        }
      } catch (err) {
        console.error('submit error', err);
        alert("Échec de l'envoi.");
      }
    });
  }
}

// === ADMIN: chargement de la liste (si pas déjà présent ou à remplacer) ===
async function loadAdminList() {
  const box = document.getElementById('admin-list');
  if (!box) return;

  box.textContent = 'Chargement…';
  try {
    const res = await fetch('/api/ebooks', { credentials: 'include' });
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      box.textContent = 'Aucun ebook pour l’instant.';
      return;
    }

    box.innerHTML = rows.map(e => `
      <div class="row">
        <div class="thumb">
          ${e.cover_path ? `<img src="${e.cover_path}" alt="">` : ''}
        </div>
        <div class="meta">
          <div class="title">${e.title || ''}</div>
          <div class="sub">${e.author || ''}</div>
        </div>
        <div class="actions">
          <a class="btn-outline" href="/ebook.html?id=${e.id}">Voir</a>
          <button class="btn-danger" data-del="${e.id}">Supprimer</button>
        </div>
      </div>
    `).join('');

    box.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer cet ebook ?')) return;
        const id = btn.dataset.del;
        const r = await fetch(`/api/ebooks/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (r.ok) loadAdminList();
      });
    });
  } catch (err) {
    console.error(err);
    box.textContent = 'Erreur de chargement.';
  }
}
  loadEbooks({ ...readSearch(), page: 1 });
});
