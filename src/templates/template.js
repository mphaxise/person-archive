/**
 * templates/template.js
 *
 * HTML archive template bundled as a JS module so it can be
 * imported in both Node.js CLI builds AND Cloudflare Workers
 * (where fs.readFileSync is unavailable).
 */

// The template string is auto-derived from templates/index.html
// Keep in sync with that file.
export const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{PERSONA_NAME}} — Article Archive</title>
<script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f0f; --surface: #1a1a1a; --border: #2a2a2a;
    --accent: #e8d5a3; --accent-dim: rgba(232,213,163,0.15);
    --text: #e0e0e0; --text-muted: #888; --text-dim: #555;
    --radius: 8px; --font: 'Georgia', serif; --mono: 'SF Mono', 'Fira Code', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; line-height: 1.6; }
  .hero { padding: 80px 40px 60px; max-width: 900px; margin: 0 auto; border-bottom: 1px solid var(--border); }
  .hero-label { font-family: var(--mono); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--accent); margin-bottom: 20px; }
  .hero h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: normal; letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 16px; }
  .hero-bio { font-size: 1.05rem; color: var(--text-muted); max-width: 600px; margin-bottom: 32px; }
  .hero-stats { display: flex; gap: 40px; flex-wrap: wrap; }
  .stat { display: flex; flex-direction: column; gap: 4px; }
  .stat-value { font-family: var(--mono); font-size: 1.6rem; color: var(--accent); }
  .stat-label { font-family: var(--mono); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-dim); }
  .controls { max-width: 900px; margin: 0 auto; padding: 28px 40px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); z-index: 10; }
  .search-box { flex: 1; min-width: 200px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 16px; color: var(--text); font-family: var(--font); font-size: 0.95rem; outline: none; transition: border-color 0.2s; }
  .search-box:focus { border-color: var(--accent); }
  .search-box::placeholder { color: var(--text-dim); }
  select.filter { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; color: var(--text); font-family: var(--font); font-size: 0.9rem; outline: none; cursor: pointer; appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
  select.filter:focus { border-color: var(--accent); }
  .result-count { font-family: var(--mono); font-size: 11px; color: var(--text-dim); letter-spacing: 1px; margin-left: auto; }
  .archive-container { max-width: 900px; margin: 0 auto; padding: 0 40px 80px; }
  .article-list { list-style: none; }
  .article-item { border-bottom: 1px solid var(--border); transition: background 0.15s; }
  .article-item:hover { background: var(--accent-dim); }
  .article-link { display: grid; grid-template-columns: 100px 1fr 160px; gap: 16px; padding: 18px 12px; text-decoration: none; color: inherit; align-items: start; }
  .article-date { font-family: var(--mono); font-size: 12px; color: var(--text-dim); padding-top: 2px; white-space: nowrap; }
  .article-title { font-size: 1rem; color: var(--text); line-height: 1.4; margin-bottom: 4px; transition: color 0.15s; }
  .article-item:hover .article-title { color: var(--accent); }
  .article-summary { font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .article-pub { font-family: var(--mono); font-size: 11px; color: var(--text-dim); text-align: right; padding-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty-state { padding: 80px 0; text-align: center; color: var(--text-dim); }
  .empty-state p { font-family: var(--mono); font-size: 13px; }
  footer { border-top: 1px solid var(--border); padding: 32px 40px; max-width: 900px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  .footer-meta { font-family: var(--mono); font-size: 11px; color: var(--text-dim); letter-spacing: 1px; }
  .footer-meta a { color: var(--accent); text-decoration: none; }
  .footer-meta a:hover { text-decoration: underline; }
  @media (max-width: 640px) {
    .hero, .controls, .archive-container { padding-left: 20px; padding-right: 20px; }
    .article-link { grid-template-columns: 1fr; gap: 6px; }
    .article-date, .article-pub { text-align: left; }
    .hero-stats { gap: 24px; }
  }
<\/style>
</head>
<body>
<header class="hero">
  <div class="hero-label">Article Archive</div>
  <h1>{{PERSONA_NAME}}</h1>
  <p class="hero-bio">{{PERSONA_BIO}}</p>
  <div class="hero-stats">
    <div class="stat"><span class="stat-value" id="stat-total">{{TOTAL_ARTICLES}}</span><span class="stat-label">Articles</span></div>
    <div class="stat"><span class="stat-value">{{PUBLICATION_COUNT}}</span><span class="stat-label">Publications</span></div>
    <div class="stat"><span class="stat-value">{{YEAR_RANGE}}</span><span class="stat-label">Active Years</span></div>
  </div>
</header>
<div class="controls">
  <input class="search-box" id="search" type="search" placeholder="Search articles, titles, summaries…" aria-label="Search articles" />
  <select class="filter" id="filter-pub" aria-label="Filter by publication"><option value="">All publications</option></select>
  <select class="filter" id="filter-year" aria-label="Filter by year"><option value="">All years</option></select>
  <span class="result-count" id="result-count"></span>
</div>
<main class="archive-container">
  <ul class="article-list" id="article-list" aria-live="polite"></ul>
  <div class="empty-state" id="empty-state" style="display:none"><p>No articles match your search.</p></div>
</main>
<footer>
  <div class="footer-meta">Generated by <a href="https://github.com/mphaxise/person-archive" target="_blank" rel="noopener">PersonArchive</a></div>
  <div class="footer-meta" id="footer-generated"></div>
</footer>
<script>
  const ARTICLES = {{ARTICLES_JSON}};
  const STATS = {{STATS_JSON}};
  const CONFIG = {{CONFIG_JSON}};
  const fuse = new Fuse(ARTICLES, { keys: [{ name: 'title', weight: 2 }, { name: 'summary', weight: 1 }, { name: 'publication', weight: 0.5 }], threshold: 0.35, includeScore: true });
  const searchInput = document.getElementById('search');
  const filterPub = document.getElementById('filter-pub');
  const filterYear = document.getElementById('filter-year');
  const articleList = document.getElementById('article-list');
  const emptyState = document.getElementById('empty-state');
  const resultCount = document.getElementById('result-count');
  const publications = [...new Set(ARTICLES.map(a => a.publication).filter(Boolean))].sort();
  publications.forEach(pub => { const opt = document.createElement('option'); opt.value = pub; opt.textContent = pub; filterPub.appendChild(opt); });
  const years = [...new Set(ARTICLES.map(a => a.date ? a.date.split('-')[0] : null).filter(Boolean))].sort((a, b) => b - a);
  years.forEach(year => { const opt = document.createElement('option'); opt.value = year; opt.textContent = year; filterYear.appendChild(opt); });
  function formatDate(dateStr) { if (!dateStr) return '—'; try { const d = new Date(dateStr + 'T00:00:00'); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return dateStr; } }
  function escHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function renderArticles(articles) {
    articleList.innerHTML = '';
    if (articles.length === 0) { emptyState.style.display = 'block'; resultCount.textContent = '0 results'; return; }
    emptyState.style.display = 'none';
    resultCount.textContent = articles.length === ARTICLES.length ? articles.length + ' articles' : articles.length + ' of ' + ARTICLES.length;
    const fragment = document.createDocumentFragment();
    articles.forEach(article => {
      const li = document.createElement('li');
      li.className = 'article-item';
      li.innerHTML = '<a class="article-link" href="' + escHtml(article.url || '#') + '" target="_blank" rel="noopener noreferrer"><span class="article-date">' + formatDate(article.date) + '<\/span><span class="article-body"><span class="article-title">' + escHtml(article.title || 'Untitled') + '<\/span>' + (article.summary ? '<span class="article-summary">' + escHtml(article.summary) + '<\/span>' : '') + '<\/span><span class="article-pub">' + escHtml(article.publication || '') + '<\/span><\/a>';
      fragment.appendChild(li);
    });
    articleList.appendChild(fragment);
  }
  function applyFilters() {
    const query = searchInput.value.trim();
    const pubFilter = filterPub.value;
    const yearFilter = filterYear.value;
    let results = query ? fuse.search(query).map(r => r.item) : [...ARTICLES];
    if (pubFilter) results = results.filter(a => a.publication === pubFilter);
    if (yearFilter) results = results.filter(a => a.date && a.date.startsWith(yearFilter));
    renderArticles(results);
  }
  let debounceTimer;
  searchInput.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 180); });
  filterPub.addEventListener('change', applyFilters);
  filterYear.addEventListener('change', applyFilters);
  document.getElementById('footer-generated').textContent = 'Generated ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  renderArticles(ARTICLES);
<\/script>
</body>
</html>`;
