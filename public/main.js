// main.js — Page publique : recherche + filtres + pagination + rendu cartes

const listEl = document.getElementById('ebook-list');
const searchEl = document.getElementById('search');
const langEl   = document.getElementById('lang');
const catEl    = document.getElementById('cat');
const prevBtn  = document.getElementById('pagerPrev');
const nextBtn  = document.getElementById('pagerNext');
const pageInfo = document.getElementById('pageInfo');
const countEl  = document.getElementById('count');

const state = { page: 1, pageSize: 8, q: '', language: '', category: '' };

function readFilters(){
  return {
    q: (searchEl?.value || '').trim(),
    language: (langEl?.value || '').trim(),
    category: (catEl?.value || '').trim()
  };
}

function card(e){
  return `
    <article class="card">
      ${e.cover_path
        ? `<img class="cover" src="${e.cover_path}" alt="${e.title || ''}">`
        : `<div class="cover placeholder"></div>`}
      <div class="info">
        <h3>${e.title || ''}</h3>
        <p class="author">${e.author || ''}</p>
        ${e.description ? `<p class="desc">${e.description}</p>` : ''}
        <div class="actions">
          <a class="btn" href="/ebook.html?id=${e.id}">Voir</a>
          ${e.pdf_path ? `<a class="btn" href="${e.pdf_path}" target="_blank" rel="noopener">Télécharger</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

async function load(){
  const { q, language, category } = readFilters();
  const params = new URLSearchParams({
    q, language, category,
    page: String(state.page),
    pageSize: String(state.pageSize)
  });
  listEl.innerHTML = '<div class="loading">Chargement…</div>';

  try{
    const r = await fetch('/api/ebooks?' + params.toString());
    const { items, total, page, pages, hasPrev, hasNext } = await r.json();

    countEl && (countEl.textContent = String(total || 0));
    pageInfo && (pageInfo.textContent = `Page ${page} / ${pages}`);

    if(!Array.isArray(items) || items.length === 0){
      listEl.innerHTML = '<p>Aucun livre pour l’instant.</p>';
    }else{
      listEl.innerHTML = items.map(card).join('');
    }

    prevBtn && (prevBtn.disabled = !hasPrev);
    nextBtn && (nextBtn.disabled = !hasNext);
  }catch(err){
    console.error(err);
    listEl.innerHTML = '<p>Erreur de chargement.</p>';
    prevBtn && (prevBtn.disabled = true);
    nextBtn && (nextBtn.disabled = true);
  }
}

// events
searchEl?.addEventListener('input', ()=>{ state.page = 1; load(); });
langEl?.addEventListener('change', ()=>{ state.page = 1; load(); });
catEl?.addEventListener('input', ()=>{ state.page = 1; load(); });
prevBtn?.addEventListener('click', ()=>{ if(state.page>1){ state.page--; load(); }});
nextBtn?.addEventListener('click', ()=>{ state.page++; load(); });

// first load
load();
