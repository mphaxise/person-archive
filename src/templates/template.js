/**
 * templates/template.js
 *
 * HTML archive template bundled as a JS module so it can be
 * imported in both Node.js CLI builds AND Cloudflare Workers
 * (where fs.readFileSync is unavailable).
 *
 * Placeholders replaced at build time:
 *   {{PERSONA_NAME}}        – Full name
 *   {{PERSONA_BIO}}         – Short biography paragraph
 *   {{TOTAL_ARTICLES}}      – Number of articles
 *   {{PUBLICATION_COUNT}}   – Number of unique publications
 *   {{YEAR_RANGE}}          – e.g. "2005–2024"
 *   {{CAREER_NARRATIVE}}    – HTML block (or empty string)
 *   {{ARTICLES_JSON}}       – JSON array of article objects
 *   {{STATS_JSON}}          – JSON stats object (unused in JS but kept for compat)
 *   {{CONFIG_JSON}}         – JSON config object (unused in JS but kept for compat)
 */

export const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{PERSONA_NAME}} — Article Archive</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"><\/script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0c0c0b;
  --surface: #161614;
  --surface2: #1e1e1b;
  --border: #262622;
  --border2: #333330;
  --gold: #c9a84c;
  --gold-dim: rgba(201,168,76,0.12);
  --gold-glow: rgba(201,168,76,0.06);
  --text: #d8d4cc;
  --text-muted: #8a867e;
  --text-dim: #4a4844;
  --radius: 6px;
  --serif: 'EB Garamond', Georgia, serif;
  --sans: 'Inter', system-ui, sans-serif;
}

html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--serif); min-height: 100vh; line-height: 1.65; -webkit-font-smoothing: antialiased; }

/* ── TOP NAV BAR ── */
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  background: rgba(12,12,11,0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 16px;
  padding: 0 40px; height: 52px;
}
.topbar-brand { font-family: var(--sans); font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); font-weight: 500; white-space: nowrap; }
.topbar-divider { width: 1px; height: 20px; background: var(--border2); flex-shrink: 0; }
.topbar-search { flex: 1; background: transparent; border: none; color: var(--text); font-family: var(--sans); font-size: 13px; outline: none; padding: 0; }
.topbar-search::placeholder { color: var(--text-dim); }
.topbar-count { font-family: var(--sans); font-size: 11px; color: var(--text-dim); white-space: nowrap; }
.topbar-filters { display: flex; gap: 8px; }
select.pill-filter {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 20px; padding: 4px 28px 4px 12px; color: var(--text-muted);
  font-family: var(--sans); font-size: 11px; outline: none; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%234a4844' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  transition: border-color 0.2s, color 0.2s;
}
select.pill-filter:focus, select.pill-filter:hover { border-color: var(--gold); color: var(--text); }

/* ── HERO ── */
.hero {
  max-width: 820px; margin: 0 auto;
  padding: 120px 40px 72px;
  border-bottom: 1px solid var(--border);
}
.hero-eyebrow {
  font-family: var(--sans); font-size: 10px; letter-spacing: 4px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 28px; font-weight: 500;
}
.hero-name {
  font-size: clamp(2.8rem, 6vw, 4.2rem);
  font-weight: 400; letter-spacing: -0.02em; line-height: 1.05;
  margin-bottom: 24px; color: #e8e4dc;
}
.hero-bio {
  font-size: 1.1rem; color: var(--text-muted); max-width: 580px;
  line-height: 1.75; margin-bottom: 48px;
}
.hero-bio a { color: var(--gold); text-decoration: none; }
.hero-bio a:hover { text-decoration: underline; }
.hero-stats { display: flex; gap: 48px; flex-wrap: wrap; }
.stat { display: flex; flex-direction: column; gap: 5px; }
.stat-value { font-family: var(--serif); font-size: 2rem; color: var(--gold); line-height: 1; font-weight: 400; }
.stat-label { font-family: var(--sans); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-dim); }
.hero-line { width: 40px; height: 1px; background: var(--gold); opacity: 0.4; margin-bottom: 48px; }

/* ── CAREER NARRATIVE ── */
.narrative-section { border-bottom: 1px solid var(--border); }
.narrative-inner { max-width: 820px; margin: 0 auto; padding: 60px 40px; }
.narrative-label { font-family: var(--sans); font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); margin-bottom: 16px; font-weight: 500; }
.narrative-headline { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 400; letter-spacing: -0.01em; margin-bottom: 16px; color: var(--text); }
.narrative-summary { font-size: 1rem; color: var(--text-muted); max-width: 680px; line-height: 1.7; margin-bottom: 48px; }
.era-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 20px; }
.era-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; transition: border-color 0.2s; }
.era-card:hover { border-color: rgba(201,168,76,0.4); }
.era-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.era-years { font-family: var(--sans); font-size: 11px; letter-spacing: 1px; color: var(--gold); white-space: nowrap; }
.era-title { font-size: 1.05rem; color: var(--text); font-style: italic; }
.era-meta { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; }
.era-meta-item { font-family: var(--sans); font-size: 11px; color: var(--text-dim); }
.era-meta-label { text-transform: uppercase; letter-spacing: 1px; margin-right: 6px; color: var(--text-dim); }
.era-description { font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; }

/* ── PUB LEGEND ── */
.pub-legend {
  max-width: 820px; margin: 0 auto;
  padding: 32px 40px;
  border-bottom: 1px solid var(--border);
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
}
.legend-label { font-family: var(--sans); font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-dim); margin-right: 8px; }
.pub-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 20px;
  font-family: var(--sans); font-size: 11px; font-weight: 500;
  border: 1px solid transparent; cursor: pointer; transition: all 0.2s;
  background: var(--surface); color: var(--text-muted);
}
.pub-chip:hover { color: var(--text); border-color: var(--border2); }
.pub-chip.active { background: var(--gold-dim); border-color: rgba(201,168,76,0.3); color: var(--gold); }
.pub-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.7; }

/* ── ARCHIVE BODY ── */
.archive-body { max-width: 820px; margin: 0 auto; padding: 0 40px 100px; }

/* ── YEAR GROUP ── */
.year-group { border-bottom: 1px solid var(--border); }
.year-header {
  display: flex; align-items: baseline; gap: 16px;
  padding: 36px 0 20px; cursor: pointer; user-select: none;
}
.year-header:hover .year-number { color: var(--gold); }
.year-number {
  font-family: var(--serif); font-size: 1.8rem; color: var(--text-dim);
  transition: color 0.2s; line-height: 1; min-width: 60px;
}
.year-count {
  font-family: var(--sans); font-size: 10px; letter-spacing: 1px;
  color: var(--text-dim); text-transform: uppercase;
}
.year-toggle { margin-left: auto; font-family: var(--sans); font-size: 11px; color: var(--text-dim); }
.year-articles { padding-bottom: 16px; }
.year-articles.collapsed { display: none; }

/* ── ARTICLE ITEM ── */
.article-item {
  display: grid; grid-template-columns: 90px 1fr auto;
  gap: 20px; padding: 20px 0;
  border-top: 1px solid var(--border);
  cursor: pointer; transition: background 0.15s;
  border-radius: 4px;
  position: relative;
}
.article-item:hover { background: var(--gold-glow); }
.article-item:hover .article-title { color: var(--gold); }
.article-item a { display: contents; text-decoration: none; color: inherit; }
.article-date-col { padding-top: 3px; }
.article-date {
  font-family: var(--sans); font-size: 11px;
  color: var(--text-dim); letter-spacing: 0.5px; white-space: nowrap;
}
.article-body { min-width: 0; }
.article-title {
  font-family: var(--serif); font-size: 1.1rem;
  color: var(--text); line-height: 1.4; margin-bottom: 6px;
  transition: color 0.2s;
}
.article-excerpt {
  font-family: var(--sans); font-size: 12px;
  color: var(--text-muted); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word; overflow-wrap: break-word;
}
.article-pub-col { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; padding-top: 3px; }
.pub-badge {
  font-family: var(--sans); font-size: 10px; letter-spacing: 0.5px;
  padding: 2px 8px; border-radius: 3px; white-space: nowrap;
  border: 1px solid transparent;
}
.article-link-icon {
  font-size: 10px; color: var(--text-dim); opacity: 0;
  transition: opacity 0.2s; font-family: var(--sans);
}
.article-item:hover .article-link-icon { opacity: 1; }

/* ── EMPTY STATE ── */
.empty-state { padding: 80px 0; text-align: center; }
.empty-state-icon { font-size: 2rem; margin-bottom: 16px; opacity: 0.3; }
.empty-state p { font-family: var(--sans); font-size: 13px; color: var(--text-dim); }

/* ── FOOTER ── */
footer {
  border-top: 1px solid var(--border);
  max-width: 820px; margin: 0 auto;
  padding: 32px 40px;
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
}
.footer-text { font-family: var(--sans); font-size: 11px; color: var(--text-dim); letter-spacing: 0.5px; }
.footer-text a { color: var(--gold); text-decoration: none; }
.footer-text a:hover { text-decoration: underline; }

/* ── RESPONSIVE ── */
@media (max-width: 640px) {
  .hero, .pub-legend, .archive-body, footer { padding-left: 20px; padding-right: 20px; }
  .narrative-inner { padding-left: 20px; padding-right: 20px; }
  .topbar { padding: 0 20px; }
  .topbar-brand { display: none; }
  .topbar-filters { display: none; }
  .article-item { grid-template-columns: 70px 1fr; gap: 12px; }
  .article-pub-col { display: none; }
  .hero-stats { gap: 28px; }
  .era-grid { grid-template-columns: 1fr; }
}
<\/style>
</head>
<body>

<!-- Fixed top bar -->
<nav class="topbar">
  <span class="topbar-brand">{{PERSONA_NAME}}</span>
  <div class="topbar-divider"></div>
  <input class="topbar-search" id="search" type="search" placeholder="Search articles…" autocomplete="off" spellcheck="false" />
  <span class="topbar-count" id="result-count"></span>
  <div class="topbar-filters">
    <select class="pill-filter" id="filter-pub"><option value="">All sources</option><\/select>
    <select class="pill-filter" id="filter-decade"><option value="">All years</option><\/select>
  </div>
</nav>

<!-- Hero -->
<header class="hero">
  <div class="hero-eyebrow">Article Archive</div>
  <h1 class="hero-name">{{PERSONA_NAME}}</h1>
  <div class="hero-line"></div>
  <p class="hero-bio">{{PERSONA_BIO}}</p>
  <div class="hero-stats">
    <div class="stat">
      <span class="stat-value" id="stat-total">{{TOTAL_ARTICLES}}</span>
      <span class="stat-label">Articles</span>
    </div>
    <div class="stat">
      <span class="stat-value" id="stat-pubs">{{PUBLICATION_COUNT}}</span>
      <span class="stat-label">Sources</span>
    </div>
    <div class="stat">
      <span class="stat-value" id="stat-span">{{YEAR_RANGE}}</span>
      <span class="stat-label">Year span</span>
    </div>
  </div>
</header>

{{CAREER_NARRATIVE}}

<!-- Publication filter chips -->
<div class="pub-legend" id="pub-legend">
  <span class="legend-label">Filter</span>
</div>

<!-- Archive -->
<main class="archive-body" id="archive-body">
  <div class="empty-state" id="empty-state" style="display:none">
    <div class="empty-state-icon">◌</div>
    <p>No articles match your search.</p>
  </div>
</main>

<footer>
  <span class="footer-text">Archive generated by <a href="https://github.com/mphaxise/person-archive" target="_blank" rel="noopener">PersonArchive</a><\/span>
  <span class="footer-text" id="footer-updated"></span>
</footer>

<script>
// ── Raw data ──
const RAW_ARTICLES = {{ARTICLES_JSON}};

// ── Publication color map ──
const PUB_COLORS = {
  'The Hindu':           { bg: 'rgba(192,57,43,0.12)',   border: 'rgba(192,57,43,0.35)',   text: '#e07060' },
  'Scroll.in':           { bg: 'rgba(52,152,219,0.1)',   border: 'rgba(52,152,219,0.35)',  text: '#5eaad4' },
  'New Indian Express':  { bg: 'rgba(201,168,76,0.1)',   border: 'rgba(201,168,76,0.35)',  text: '#c9a84c' },
  'The Telegraph':       { bg: 'rgba(155,89,182,0.1)',   border: 'rgba(155,89,182,0.35)',  text: '#b07dd4' },
  'The Caravan':         { bg: 'rgba(230,126,34,0.1)',   border: 'rgba(230,126,34,0.35)',  text: '#d4854a' },
  'EPW':                 { bg: 'rgba(26,188,156,0.1)',   border: 'rgba(26,188,156,0.35)',  text: '#48c9b0' },
  'Economic and Political Weekly': { bg: 'rgba(26,188,156,0.1)', border: 'rgba(26,188,156,0.35)', text: '#48c9b0' },
  'Hindustan Times':     { bg: 'rgba(236,240,241,0.06)', border: 'rgba(236,240,241,0.2)', text: '#a0a09a' },
  'Outlook India':       { bg: 'rgba(241,196,15,0.08)',  border: 'rgba(241,196,15,0.25)',  text: '#c0a530' },
  'Mint':                { bg: 'rgba(22,160,133,0.1)',   border: 'rgba(22,160,133,0.3)',   text: '#3cb49a' },
  'ESPN Cricinfo':       { bg: 'rgba(52,73,94,0.2)',     border: 'rgba(52,73,94,0.5)',     text: '#7f8c8d' },
  'Financial Times':     { bg: 'rgba(246,218,141,0.08)', border: 'rgba(246,218,141,0.25)', text: '#c8a850' },
  'Firstpost':           { bg: 'rgba(231,76,60,0.08)',   border: 'rgba(231,76,60,0.25)',   text: '#c0645a' },
  'NDTV':                { bg: 'rgba(41,128,185,0.1)',   border: 'rgba(41,128,185,0.3)',   text: '#4a90c0' },
  'The Wire':            { bg: 'rgba(142,68,173,0.1)',   border: 'rgba(142,68,173,0.3)',   text: '#a87cc0' },
  'Deccan Herald':       { bg: 'rgba(52,73,94,0.12)',    border: 'rgba(52,73,94,0.3)',     text: '#6e8496' },
  'Deccan Chronicle':    { bg: 'rgba(52,73,94,0.12)',    border: 'rgba(52,73,94,0.3)',     text: '#6e8496' },
  'The Guardian':        { bg: 'rgba(0,118,100,0.1)',    border: 'rgba(0,118,100,0.3)',    text: '#3aab94' },
  'The Times of India':  { bg: 'rgba(220,50,50,0.08)',   border: 'rgba(220,50,50,0.25)',   text: '#c06060' },
  'Indian Express':      { bg: 'rgba(41,128,185,0.08)',  border: 'rgba(41,128,185,0.25)',  text: '#5a9ab5' },
  'The Indian Express':  { bg: 'rgba(41,128,185,0.08)',  border: 'rgba(41,128,185,0.25)',  text: '#5a9ab5' },
};
const DEFAULT_COLOR = { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', text: '#6a6862' };

// ── Clean + enrich articles ──
function cleanArticles(raw) {
  return raw.map(a => {
    let title = (a.title || '').trim();
    let pub = a.publication || '';
    const url = a.url || '';
    let summary = (a.summary || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '').trim();

    // Extract real URL from Bing/Google News redirects
    let realUrl = url;
    if (url.includes('bing.com/news/apiclick.aspx')) {
      const urlMatch = url.match(/[?&]url=([^&]+)/i);
      if (urlMatch) realUrl = decodeURIComponent(urlMatch[1]);
    }

    // Infer real pub from URL when source is an aggregator
    const urlForPub = realUrl || url;
    if (pub === 'Bing News' || pub === 'Google News' || pub === 'RSS') {
      const urlDecode = decodeURIComponent(urlForPub);
      if (/scroll\.in/.test(urlDecode)) pub = 'Scroll.in';
      else if (/thehindu\.com/.test(urlDecode)) pub = 'The Hindu';
      else if (/telegraphindia\.com|telegraph\.co\.uk/.test(urlDecode)) pub = 'The Telegraph';
      else if (/thewire\.in/.test(urlDecode)) pub = 'The Wire';
      else if (/hindustantimes\.com/.test(urlDecode)) pub = 'Hindustan Times';
      else if (/caravanmagazine\.in/.test(urlDecode)) pub = 'The Caravan';
      else if (/espncricinfo/.test(urlDecode)) pub = 'ESPN Cricinfo';
      else if (/outlookindia\.com/.test(urlDecode)) pub = 'Outlook India';
      else if (/economictimes\.indiatimes/.test(urlDecode)) pub = 'Economic Times';
      else if (/livemint\.com/.test(urlDecode)) pub = 'Mint';
      else if (/firstpost\.com/.test(urlDecode)) pub = 'Firstpost';
      else if (/ndtv\.com/.test(urlDecode)) pub = 'NDTV';
      else if (/newindianexpress\.com/.test(urlDecode)) pub = 'New Indian Express';
      else if (/ft\.com/.test(urlDecode)) pub = 'Financial Times';
      else if (/theguardian\.com/.test(urlDecode)) pub = 'The Guardian';
      else if (/deccanherald\.com/.test(urlDecode)) pub = 'Deccan Herald';
      else if (/deccanchronicle\.com/.test(urlDecode)) pub = 'Deccan Chronicle';
      else if (/indianexpress\.com/.test(urlDecode)) pub = 'The Indian Express';
      else if (/timesofindia/.test(urlDecode)) pub = 'The Times of India';
    }

    // Clean title suffixes (remove publication names at end)
    title = title
      .replace(/\\s[-–|]\\s*(The New Indian Express|The Hindu|Scroll\\.in|The Telegraph|The Wire|Outlook India|Hindustan Times|Economic Times|ESPN Cricinfo|The Caravan|Financial Times|EPW|Firstpost|NDTV|Mint|Livemint|The Guardian|Deccan Herald|The Indian Express|The Times of India)$/i, '')
      .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .trim();

    // Parse date
    const dateStr = a.date || '';
    const dateObj = dateStr ? new Date(dateStr) : null;
    const year = dateObj && !isNaN(dateObj) ? dateObj.getFullYear() : null;
    const dayMonth = dateObj && !isNaN(dateObj) ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

    // Scrub summary if it looks like a Google News redirect blob
    if (summary.includes('news.google.com/rss/articles/') || summary.length < 10) summary = '';

    return { ...a, title, publication: pub, summary, url: realUrl, year, dayMonth };
  });
}

// ── Bootstrap ──
const ARTICLES = cleanArticles(RAW_ARTICLES);
const ALL_PUBS = [...new Set(ARTICLES.map(a => a.publication))].filter(Boolean).sort();
const ALL_YEARS = [...new Set(ARTICLES.map(a => a.year).filter(Boolean))].sort((a,b) => b-a);
const DECADES = [...new Set(ALL_YEARS.map(y => Math.floor(y/5)*5))].sort((a,b) => b-a);

// Update live stats
document.getElementById('stat-total').textContent = ARTICLES.length;
document.getElementById('stat-pubs').textContent = ALL_PUBS.length;
if (ALL_YEARS.length) {
  document.getElementById('stat-span').textContent = ALL_YEARS[ALL_YEARS.length-1] + '–' + ALL_YEARS[0];
}
document.getElementById('footer-updated').textContent = 'Updated ' + new Date().toLocaleDateString('en-US', { month:'long', year:'numeric' });

// ── Build pub legend chips ──
const legend = document.getElementById('pub-legend');
const filterSelect = document.getElementById('filter-pub');

ALL_PUBS.forEach(pub => {
  const col = PUB_COLORS[pub] || DEFAULT_COLOR;
  const chip = document.createElement('button');
  chip.className = 'pub-chip';
  chip.dataset.pub = pub;
  chip.innerHTML = '<span class="pub-dot" style="color:' + col.text + '"><\/span>' + escHtml(pub);
  chip.addEventListener('click', () => {
    const isActive = chip.classList.contains('active');
    document.querySelectorAll('.pub-chip').forEach(c => c.classList.remove('active'));
    filterSelect.value = isActive ? '' : pub;
    if (!isActive) chip.classList.add('active');
    render();
  });
  legend.appendChild(chip);

  const opt = document.createElement('option');
  opt.value = pub; opt.textContent = pub;
  filterSelect.appendChild(opt);
});

// Decade filter
const decadeSelect = document.getElementById('filter-decade');
DECADES.forEach(d => {
  const opt = document.createElement('option');
  opt.value = d; opt.textContent = d + 's';
  decadeSelect.appendChild(opt);
});

// ── Fuse search ──
const fuse = new Fuse(ARTICLES, { keys: ['title','summary','publication'], threshold: 0.35, minMatchCharLength: 2 });

// ── Render ──
let currentFilter = { pub: '', decade: '', query: '' };

function getPubColor(pub) { return PUB_COLORS[pub] || DEFAULT_COLOR; }

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildArticleItem(a) {
  const col = getPubColor(a.publication);
  const li = document.createElement('div');
  li.className = 'article-item';
  const linkHref = a.url || '#';
  li.innerHTML =
    '<a href="' + escHtml(linkHref) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' +
      '<div class="article-date-col">' +
        '<span class="article-date">' + escHtml(a.dayMonth || (a.date||'').slice(5)) + '<\/span>' +
      '<\/div>' +
      '<div class="article-body">' +
        '<div class="article-title">' + escHtml(a.title) + '<\/div>' +
        (a.summary ? '<div class="article-excerpt">' + escHtml(a.summary) + '<\/div>' : '') +
      '<\/div>' +
      '<div class="article-pub-col">' +
        '<span class="pub-badge" style="background:' + col.bg + ';border-color:' + col.border + ';color:' + col.text + '">' + escHtml(a.publication) + '<\/span>' +
        '<span class="article-link-icon">↗<\/span>' +
      '<\/div>' +
    '<\/a>';
  return li;
}

function render() {
  const { pub, decade, query } = currentFilter;
  const body = document.getElementById('archive-body');
  const emptyState = document.getElementById('empty-state');
  const countEl = document.getElementById('result-count');

  let results = query ? fuse.search(query).map(r => r.item) : [...ARTICLES];
  if (pub) results = results.filter(a => a.publication === pub);
  if (decade) results = results.filter(a => a.year && Math.floor(a.year/5)*5 === +decade);

  countEl.textContent = results.length === ARTICLES.length ? '' : results.length + ' results';
  body.querySelectorAll('.year-group').forEach(el => el.remove());
  emptyState.style.display = results.length ? 'none' : 'block';
  if (!results.length) return;

  // Group by year
  const byYear = {};
  results.forEach(a => {
    const y = a.year || 'Undated';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(a);
  });

  const years = Object.keys(byYear).sort((a,b) => b - a);
  const isFiltered = !!(pub || decade || query);
  const thisYear = new Date().getFullYear();

  years.forEach(year => {
    const articles = byYear[year];
    const group = document.createElement('div');
    group.className = 'year-group';

    const header = document.createElement('div');
    header.className = 'year-header';
    header.innerHTML =
      '<span class="year-number">' + year + '<\/span>' +
      '<span class="year-count">' + articles.length + ' piece' + (articles.length!==1?'s':'') + '<\/span>' +
      '<span class="year-toggle" id="toggle-' + year + '">collapse<\/span>';

    const articleList = document.createElement('div');
    const startCollapsed = !isFiltered && +year < thisYear - 1;
    articleList.className = 'year-articles' + (startCollapsed ? ' collapsed' : '');

    articles.forEach(a => articleList.appendChild(buildArticleItem(a)));

    header.addEventListener('click', () => {
      const collapsed = articleList.classList.toggle('collapsed');
      header.querySelector('.year-toggle').textContent = collapsed ? 'expand' : 'collapse';
    });
    if (startCollapsed) {
      header.querySelector('.year-toggle').textContent = 'expand';
    }

    group.appendChild(header);
    group.appendChild(articleList);
    body.appendChild(group);
  });
}

// ── Events ──
document.getElementById('search').addEventListener('input', e => {
  currentFilter.query = e.target.value.trim();
  render();
});
document.getElementById('filter-pub').addEventListener('change', e => {
  currentFilter.pub = e.target.value;
  document.querySelectorAll('.pub-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.pub === e.target.value);
  });
  render();
});
document.getElementById('filter-decade').addEventListener('change', e => {
  currentFilter.decade = e.target.value;
  render();
});

render();
<\/script>
</body>
</html>`;
