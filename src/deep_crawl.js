/**
 * PersonArchive — Deep Crawl Engine
 *
 * Runs 7 parallel strategies for maximum article coverage:
 *   1. RSS / Atom feed detection + parsing
 *   2. Wayback Machine CDX API (time-travel through archived author pages)
 *   3. DuckDuckGo Deep Blast (30+ targeted search queries)
 *   4. Sitemap.xml author page mining
 *   5. Paginated scrape (page 1..N author pages, heuristic limit)
 *   6. Muck Rack author profile
 *   7. Google Scholar (academic citations, abstracts)
 *
 * Each strategy returns Article[] with consistent shape:
 *   { title, url, date?, excerpt?, source, deepCrawlSource }
 *
 * Deduplication is applied by URL after merging all results.
 */

import { deduplicateByUrl } from './utils.js';

const FETCH_TIMEOUT = 12_000; // ms

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * @param {Object} config - persona config
 * @param {Array}  existingArticles - already-known articles (for dedup)
 * @returns {Promise<Article[]>} merged, deduplicated article list
 */
export async function deepCrawl(config, existingArticles = []) {
  const name = config.name;
  const selectedStrategies = config._deepCrawlStrategies || null; // null = run all

  console.log(`\n🔭 Deep Crawl — "${name}"`);
  console.log(`   Existing articles: ${existingArticles.length}`);

  const strategies = [
    { id: 'rss',       label: 'RSS / Atom feeds',           fn: strategyRss },
    { id: 'wayback',   label: 'Wayback Machine CDX API',    fn: strategyWayback },
    { id: 'ddg',       label: 'DuckDuckGo Deep Blast',      fn: strategyDdgBlast },
    { id: 'sitemap',   label: 'Sitemap.xml mining',         fn: strategySitemap },
    { id: 'paginate',  label: 'Paginated author pages',     fn: strategyPaginate },
    { id: 'muckrack',  label: 'Muck Rack profile',          fn: strategyMuckRack },
    { id: 'scholar',   label: 'Google Scholar',             fn: strategyScholar }
  ].filter(s => !selectedStrategies || selectedStrategies.includes(s.id));

  // Run all strategies in parallel
  const results = await Promise.allSettled(
    strategies.map(async s => {
      const startTime = Date.now();
      try {
        console.log(`   ↳ Starting: ${s.label}...`);
        const articles = await s.fn(config);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`   ✅ ${s.label}: ${articles.length} articles (${elapsed}s)`);
        return articles.map(a => ({ ...a, deepCrawlSource: s.id }));
      } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.warn(`   ⚠️  ${s.label}: failed after ${elapsed}s — ${err.message}`);
        return [];
      }
    })
  );

  // Merge all results
  const newArticles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Merge with existing, deduplicate by URL
  const merged = deduplicateByUrl([...existingArticles, ...newArticles]);

  const added = merged.length - existingArticles.length;
  console.log(`\n   Deep crawl total: ${newArticles.length} raw → ${added} new (${merged.length} total after dedup)\n`);

  return merged;
}

// ─────────────────────────────────────────────────────────────
// Strategy 1: RSS / Atom feed detection
// ─────────────────────────────────────────────────────────────

async function strategyRss(config) {
  const name = config.name;
  const articles = [];

  // Build candidate RSS URLs from configured publications
  const rssPatterns = buildRssPatterns(config);

  for (const feedUrl of rssPatterns) {
    try {
      const res = await fetchWithTimeout(feedUrl, FETCH_TIMEOUT);
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parseRss(xml, feedUrl, name);
      articles.push(...parsed);
    } catch {
      // silent — not all patterns will exist
    }
  }

  return articles;
}

function buildRssPatterns(config) {
  const { name, publications = [] } = config;
  const slug = config.slug || name.toLowerCase().replace(/\s+/g, '-');
  const urls = [];

  for (const pub of publications) {
    switch (pub.id) {
      case 'new_indian_express':
        if (pub.authorSlug) {
          urls.push(`https://www.newindianexpress.com/author/rss/${pub.authorSlug}`);
          urls.push(`https://www.newindianexpress.com/rss/author/${pub.authorSlug}.xml`);
        }
        break;
      case 'the_wire':
        if (pub.authorSlug) {
          urls.push(`https://thewire.in/author/${pub.authorSlug}/feed`);
          urls.push(`https://thewire.in/author/${pub.authorSlug}/feed/`);
        }
        break;
      case 'scroll_in':
        if (pub.authorSlug) {
          urls.push(`https://scroll.in/author/${pub.authorSlug}/feed`);
        }
        break;
      case 'epw':
        urls.push(`https://www.epw.in/rss.xml`);
        break;
    }
  }

  // Generic Muck Rack RSS (often has author RSS)
  const muckRackSlug = name.toLowerCase().replace(/\s+/g, '-');
  urls.push(`https://muckrack.com/${muckRackSlug}/rss`);

  return [...new Set(urls)];
}

function parseRss(xml, feedUrl, authorName) {
  const articles = [];
  const nameLC = authorName.toLowerCase();

  // Match <item> blocks
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const item = match[1];
    const title = extractXmlTag(item, 'title');
    const url   = extractXmlTag(item, 'link') || extractXmlTag(item, 'guid');
    const date  = extractXmlTag(item, 'pubDate') || extractXmlTag(item, 'dc:date') || extractXmlTag(item, 'published');
    const excerpt = extractXmlTag(item, 'description') || extractXmlTag(item, 'summary') || '';
    const author  = extractXmlTag(item, 'dc:creator') || extractXmlTag(item, 'author') || '';

    if (!title || !url) continue;

    // Author filter: include if no author specified, or author matches
    if (author && !author.toLowerCase().includes(nameLC)) continue;

    articles.push({
      title: cleanText(title),
      url: cleanUrl(url),
      date: normalizeDate(date),
      excerpt: cleanText(excerpt.replace(/<[^>]+>/g, '')).slice(0, 400),
      source: new URL(url.startsWith('http') ? url : feedUrl).hostname
    });
  }

  // Also handle Atom <entry> blocks
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRe.exec(xml)) !== null) {
    const item = match[1];
    const title = extractXmlTag(item, 'title');
    const url   = extractXmlHref(item, 'link');
    const date  = extractXmlTag(item, 'published') || extractXmlTag(item, 'updated');
    const excerpt = extractXmlTag(item, 'summary') || extractXmlTag(item, 'content') || '';

    if (!title || !url) continue;

    articles.push({
      title: cleanText(title),
      url: cleanUrl(url),
      date: normalizeDate(date),
      excerpt: cleanText(excerpt.replace(/<[^>]+>/g, '')).slice(0, 400),
      source: new URL(url.startsWith('http') ? url : feedUrl).hostname
    });
  }

  return articles;
}

// ─────────────────────────────────────────────────────────────
// Strategy 2: Wayback Machine CDX API
// ─────────────────────────────────────────────────────────────

async function strategyWayback(config) {
  const { name, publications = [] } = config;
  const articles = [];

  // Build author page URLs to look up in Wayback CDX
  const authorPages = buildAuthorPageUrls(config);

  for (const pageUrl of authorPages) {
    try {
      // CDX API: get all captures of this URL
      const cdxUrl = `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pageUrl)}&output=json&limit=100&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=urlkey`;
      const res = await fetchWithTimeout(cdxUrl, FETCH_TIMEOUT);
      if (!res.ok) continue;

      const records = await res.json();
      if (!Array.isArray(records) || records.length < 2) continue;

      // records[0] is the header row
      for (let i = 1; i < records.length; i++) {
        const [timestamp, originalUrl] = records[i];
        if (!originalUrl || !timestamp) continue;

        // Fetch the archived snapshot and extract article links
        const snapshotUrl = `https://web.archive.org/web/${timestamp}/${originalUrl}`;
        try {
          const snapRes = await fetchWithTimeout(snapshotUrl, FETCH_TIMEOUT * 2);
          if (!snapRes.ok) continue;
          const html = await snapRes.text();
          const found = extractLinksFromHtml(html, name, originalUrl);
          articles.push(...found);
        } catch {
          // individual snapshot failure is ok
        }
      }
    } catch {
      // URL lookup failure is ok
    }
  }

  return deduplicateByUrl(articles);
}

function buildAuthorPageUrls(config) {
  const { publications = [], name } = config;
  const urls = [];

  for (const pub of publications) {
    switch (pub.id) {
      case 'new_indian_express':
        if (pub.authorSlug) urls.push(`https://www.newindianexpress.com/author/${pub.authorSlug}`);
        break;
      case 'the_wire':
        if (pub.authorSlug) urls.push(`https://thewire.in/author/${pub.authorSlug}`);
        break;
      case 'scroll_in':
        if (pub.authorSlug) urls.push(`https://scroll.in/author/${pub.authorSlug}`);
        break;
      case 'epw':
        if (pub.authorSlug) urls.push(`https://www.epw.in/author/${pub.authorSlug}`);
        break;
      case 'outlook_india':
        if (pub.authorSlug) urls.push(`https://www.outlookindia.com/author/${pub.authorSlug}`);
        break;
    }
  }

  return urls;
}

// ─────────────────────────────────────────────────────────────
// Strategy 3: DuckDuckGo Deep Blast (30+ targeted queries)
// ─────────────────────────────────────────────────────────────

async function strategyDdgBlast(config) {
  const { name, searchQueries = [] } = config;
  const articles = [];

  // Build 30+ targeted query variants
  const queries = buildDdgQueries(name, searchQueries);

  // Run queries in small batches to avoid rate-limiting
  const BATCH_SIZE = 4;
  const BATCH_DELAY = 1200; // ms

  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(q => runDdgQuery(q, name))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') articles.push(...r.value);
    }
    if (i + BATCH_SIZE < queries.length) {
      await sleep(BATCH_DELAY);
    }
  }

  return deduplicateByUrl(articles);
}

function buildDdgQueries(name, customQueries = []) {
  const queries = [
    // General
    `"${name}" article`,
    `"${name}" essay`,
    `"${name}" column`,
    `"${name}" opinion`,
    `"${name}" interview`,
    `"${name}" analysis`,
    `"${name}" commentary`,

    // Academic
    `"${name}" journal`,
    `"${name}" research paper`,
    `"${name}" published in`,
    `"${name}" writes about`,
    `author "${name}"`,
    `by "${name}"`,

    // Time-targeted
    `"${name}" 2024`,
    `"${name}" 2023`,
    `"${name}" 2022`,
    `"${name}" 2021`,
    `"${name}" 2020`,

    // Specific publication searches (won't know which apply, let DDG filter)
    `site:thewire.in "${name}"`,
    `site:scroll.in "${name}"`,
    `site:epw.in "${name}"`,
    `site:outlookindia.com "${name}"`,
    `site:newindianexpress.com "${name}"`,
    `site:theprint.in "${name}"`,
    `site:thehindu.com "${name}"`,
    `site:hindustantimes.com "${name}"`,
    `site:ndtv.com "${name}"`,
    `site:telegraphindia.com "${name}"`,
    `site:firstpost.com "${name}"`,
    `site:deccanherald.com "${name}"`,
    `site:nationalheraldindia.com "${name}"`,

    ...customQueries
  ];

  return [...new Set(queries)];
}

async function runDdgQuery(query, authorName) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT, {
      'User-Agent': 'Mozilla/5.0 (compatible; PersonArchive/1.0)',
      'Accept-Language': 'en-US,en;q=0.9'
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseDdgResults(html, authorName);
  } catch {
    return [];
  }
}

function parseDdgResults(html, authorName) {
  const articles = [];
  const nameLC = authorName.toLowerCase();

  // DDG result blocks: <div class="result">
  const resultRe = /<div class="result[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = resultRe.exec(html)) !== null) {
    const block = match[1];

    // Extract URL
    const urlMatch = block.match(/href="([^"]+)"/);
    if (!urlMatch) continue;
    let url = urlMatch[1];

    // DDG redirects: extract actual URL from uddg= param
    if (url.includes('uddg=')) {
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
    }

    if (!url.startsWith('http')) continue;

    // Extract title
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? cleanText(titleMatch[1].replace(/<[^>]+>/g, '')) : '';

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/i);
    const excerpt = snippetMatch ? cleanText(snippetMatch[1].replace(/<[^>]+>/g, '')) : '';

    if (!title || !url) continue;

    // Filter: must mention the author name somewhere in title or snippet
    const combined = (title + ' ' + excerpt).toLowerCase();
    if (!combined.includes(nameLC.split(' ')[0].toLowerCase()) &&
        !combined.includes(nameLC.split(' ').pop().toLowerCase())) continue;

    // Skip obvious non-article URLs
    if (/\/(tag|category|search|topic)\//i.test(url)) continue;

    articles.push({
      title: title.slice(0, 200),
      url,
      date: null,
      excerpt: excerpt.slice(0, 400),
      source: new URL(url).hostname
    });
  }

  return articles;
}

// ─────────────────────────────────────────────────────────────
// Strategy 4: Sitemap.xml mining
// ─────────────────────────────────────────────────────────────

async function strategySitemap(config) {
  const { name, publications = [] } = config;
  const nameLC = name.toLowerCase();
  const articles = [];

  const domains = getDomains(publications);

  for (const domain of domains) {
    try {
      // Try sitemap index first, then direct sitemap
      const candidates = [
        `https://${domain}/sitemap.xml`,
        `https://${domain}/sitemap_index.xml`,
        `https://${domain}/news-sitemap.xml`,
        `https://${domain}/author-sitemap.xml`
      ];

      for (const sitemapUrl of candidates) {
        try {
          const res = await fetchWithTimeout(sitemapUrl, FETCH_TIMEOUT);
          if (!res.ok) continue;
          const xml = await res.text();
          const found = parseSitemap(xml, name, domain);
          articles.push(...found);
          if (found.length > 0) break; // found articles, no need to try other sitemaps
        } catch {
          // try next candidate
        }
      }
    } catch {
      // domain failed entirely
    }
  }

  return deduplicateByUrl(articles);
}

function parseSitemap(xml, authorName, domain) {
  const nameLC = authorName.toLowerCase();
  const parts = nameLC.split(' ');
  const articles = [];

  // Extract <loc> URLs from sitemap
  const locRe = /<loc>\s*(.*?)\s*<\/loc>/gi;
  const dateRe = /<lastmod>\s*(.*?)\s*<\/lastmod>/gi;

  const locs = [];
  let m;
  while ((m = locRe.exec(xml)) !== null) {
    const url = m[1].trim();
    if (!url.startsWith('http')) continue;

    // If it's a sub-sitemap (sitemap index), we'd need to recurse — skip for now
    if (url.includes('sitemap')) continue;

    // Filter by author name in URL path
    const urlLC = url.toLowerCase();
    if (parts.some(p => p.length > 3 && urlLC.includes(p))) {
      locs.push(url);
    }
  }

  for (const url of locs) {
    // Derive title from URL path
    const pathParts = new URL(url).pathname.split('/').filter(Boolean);
    const rawTitle = pathParts[pathParts.length - 1]
      .replace(/-/g, ' ')
      .replace(/\.(html?|php|aspx?)$/i, '')
      .trim();
    const title = capitalize(rawTitle);

    if (title.length < 5) continue;

    articles.push({
      title,
      url,
      date: null,
      excerpt: '',
      source: domain
    });
  }

  return articles;
}

// ─────────────────────────────────────────────────────────────
// Strategy 5: Paginated author page scrape
// ─────────────────────────────────────────────────────────────

async function strategyPaginate(config) {
  const { publications = [], name } = config;
  const articles = [];
  const MAX_PAGES = 20;

  for (const pub of publications) {
    const paginatedUrls = buildPaginatedUrls(pub, MAX_PAGES);
    for (const url of paginatedUrls) {
      try {
        const res = await fetchWithTimeout(url, FETCH_TIMEOUT);
        if (!res.ok) break; // stop paginating this pub if we get a non-200
        const html = await res.text();
        const found = extractLinksFromHtml(html, name, url);
        if (found.length === 0) break; // no results on this page, stop
        articles.push(...found);
        await sleep(500); // gentle pacing
      } catch {
        break;
      }
    }
  }

  return deduplicateByUrl(articles);
}

function buildPaginatedUrls(pub, maxPages) {
  const urls = [];
  const { id, authorSlug } = pub;
  if (!authorSlug) return urls;

  for (let page = 1; page <= maxPages; page++) {
    switch (id) {
      case 'new_indian_express':
        if (page === 1) urls.push(`https://www.newindianexpress.com/author/${authorSlug}`);
        else urls.push(`https://www.newindianexpress.com/author/${authorSlug}/${page}`);
        break;
      case 'the_wire':
        if (page === 1) urls.push(`https://thewire.in/author/${authorSlug}`);
        else urls.push(`https://thewire.in/author/${authorSlug}/page/${page}`);
        break;
      case 'scroll_in':
        if (page === 1) urls.push(`https://scroll.in/author/${authorSlug}`);
        else urls.push(`https://scroll.in/author/${authorSlug}?page=${page}`);
        break;
      case 'outlook_india':
        if (page === 1) urls.push(`https://www.outlookindia.com/author/${authorSlug}`);
        else urls.push(`https://www.outlookindia.com/author/${authorSlug}?page=${page}`);
        break;
    }
  }

  return urls;
}

// ─────────────────────────────────────────────────────────────
// Strategy 6: Muck Rack profile
// ─────────────────────────────────────────────────────────────

async function strategyMuckRack(config) {
  const { name, publications } = config;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Try different slug variants
  const slugVariants = [
    slug,
    slug.replace(/-/g, ''),
    name.split(' ').map(s => s.toLowerCase()).join('-')
  ];

  const articles = [];

  for (const variant of slugVariants) {
    try {
      const profileUrl = `https://muckrack.com/${variant}`;
      const res = await fetchWithTimeout(profileUrl, FETCH_TIMEOUT);
      if (!res.ok) continue;
      const html = await res.text();
      const found = extractLinksFromHtml(html, name, profileUrl);
      if (found.length > 0) {
        articles.push(...found);
        break; // found the right slug
      }
    } catch {
      // try next variant
    }
  }

  // Also try Muck Rack search API
  try {
    const searchUrl = `https://muckrack.com/search/journalists?q=${encodeURIComponent(name)}`;
    const res = await fetchWithTimeout(searchUrl, FETCH_TIMEOUT);
    if (res.ok) {
      const html = await res.text();
      const found = extractLinksFromHtml(html, name, searchUrl);
      articles.push(...found);
    }
  } catch {}

  return deduplicateByUrl(articles);
}

// ─────────────────────────────────────────────────────────────
// Strategy 7: Google Scholar
// ─────────────────────────────────────────────────────────────

async function strategyScholar(config) {
  const { name } = config;
  const articles = [];

  const scholarUrl = `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(name)}"&hl=en`;

  try {
    const res = await fetchWithTimeout(scholarUrl, FETCH_TIMEOUT, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    if (!res.ok) return articles;
    const html = await res.text();

    // Parse Scholar result cards
    const cardRe = /<div class="gs_r gs_or gs_scl">([\s\S]*?)<\/div>\s*<\/div>/gi;
    let match;
    while ((match = cardRe.exec(html)) !== null) {
      const card = match[1];

      const titleMatch = card.match(/<h3[^>]*class="gs_rt"[^>]*>([\s\S]*?)<\/h3>/i);
      const linkMatch = card.match(/href="(https?:\/\/[^"]+)"/);
      const snippetMatch = card.match(/class="gs_rs"[^>]*>([\s\S]*?)<\/div>/i);
      const yearMatch = card.match(/\b(19|20)\d{2}\b/);

      if (!titleMatch || !linkMatch) continue;

      const title = cleanText(titleMatch[1].replace(/<[^>]+>/g, ''));
      const url = linkMatch[1];
      const excerpt = snippetMatch ? cleanText(snippetMatch[1].replace(/<[^>]+>/g, '')) : '';
      const date = yearMatch ? yearMatch[0] : null;

      if (!title || !url) continue;

      articles.push({
        title: title.slice(0, 200),
        url,
        date,
        excerpt: excerpt.slice(0, 400),
        source: 'scholar.google.com'
      });
    }
  } catch {
    // Scholar blocks bots aggressively — that's fine
  }

  return articles;
}

// ─────────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────────

function extractLinksFromHtml(html, authorName, baseUrl) {
  const articles = [];
  const nameLC = authorName.toLowerCase();
  const nameParts = nameLC.split(' ').filter(p => p.length > 2);

  let base;
  try { base = new URL(baseUrl); } catch { return []; }

  // Find all anchor tags with meaningful href + text
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    let href = match[1];
    const text = cleanText(match[2].replace(/<[^>]+>/g, ''));

    if (!href || !text || text.length < 15 || text.length > 250) continue;

    // Resolve relative URLs
    try {
      href = new URL(href, base.origin).href;
    } catch { continue; }

    // Must be same domain
    if (!href.startsWith(base.origin)) continue;

    // Skip navigation/tag/category pages
    if (/\/(tag|category|search|page|author|topic|feed)\/?$/i.test(href)) continue;
    if (/#/.test(href)) continue;

    // Prefer article-looking URLs (have slug-like path segment)
    const path = new URL(href).pathname;
    if (path === '/' || path.split('/').filter(Boolean).length < 1) continue;

    articles.push({
      title: text.slice(0, 200),
      url: href,
      date: null,
      excerpt: '',
      source: base.hostname
    });
  }

  return articles;
}

async function fetchWithTimeout(url, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PersonArchive/1.0; +https://github.com/mphaxise/person-archive)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...extraHeaders
      }
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function getDomains(publications) {
  const domainMap = {
    new_indian_express: 'www.newindianexpress.com',
    the_wire: 'thewire.in',
    scroll_in: 'scroll.in',
    epw: 'www.epw.in',
    outlook_india: 'www.outlookindia.com',
    muck_rack: 'muckrack.com',
    the_print: 'theprint.in',
    deccan_herald: 'www.deccanherald.com',
    the_hindu: 'www.thehindu.com',
    national_herald: 'www.nationalheraldindia.com'
  };
  return publications.map(p => domainMap[p.id]).filter(Boolean);
}

// XML helpers
function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return (m[1] || m[2] || '').trim();
}

function extractXmlHref(xml, tag) {
  const re = new RegExp(`<${tag}[^>]+href="([^"]+)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

// Date normalizer
function normalizeDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (!raw) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // Try parsing
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return null;
}

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUrl(url) {
  if (!url) return '';
  return url.split('?')[0].split('#')[0].trim();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
