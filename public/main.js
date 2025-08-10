async function search(query='') {
  const q = document.getElementById('q').value;
  const lang = document.getElementById('lang').value;
  const cat = document.getElementById('category').value;
  const params = new URLSearchParams({ q, lang, category: cat });
  const res = await fetch('/api/ebooks?' + params.toString());
  const items = await res.json();
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