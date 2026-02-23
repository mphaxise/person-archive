/**
 * enricher.js
 *
 * Metadata enrichment pass for articles missing dates or excerpts.
 *
 * Two-stage strategy:
 *   1. Open Graph fetch  — GET the article URL, parse og:description,
 *      article:published_time, og:title from the HTML <head>.
 *      Fast (only reads ~10 KB of HTML), no JS execution required.
 *
 *   2. DuckDuckGo snippet — If OG fetch fails/returns nothing useful,
 *      run a targeted DDG search and use the search snippet as the excerpt.
 *
 * Articles are enriched in-place (mutation of the passed array).
 */

import fetch from 'node-fetch';

// How many articles to enrich in parallel
const CONCURRENCY = 6;

// Max bytes to read per article (enough for <head> OG tags)
const MAX_BYTES = 15_000;

// Minimum acceptable excerpt length (chars)
const MIN_EXCERPT_LEN = 40;

/**
 * Enrich articles array in-place.
 * Only processes articles missing `date` or `excerpt`.
 *
 * @param {Array}  articles   - full article list (mutated in-place)
 * @param {string} personName - used for DDG fallback queries
 */
export async function enrichArticles(articles, personName = '') {
  const toEnrich = articles.filter(a => !a.date || !a.excerpt || a.excerpt.length < MIN_EXCERPT_LEN);

  // Chunk into batches of CONCURRENCY
  for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
    const batch = toEnrich.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(a => enrichOne(a, personName)));
    // Brief pause to avoid hammering servers
    if (i + CONCURRENCY < toEnrich.length) {
      await sleep(400);
    }
  }

  const enriched = articles.filter(a => a.date || (a.excerpt && a.excerpt.length >= MIN_EXCERPT_LEN));
  console.log(`    ✅ Enrichment complete — ${enriched.length}/${articles.length} articles have metadata`);
}

async function enrichOne(article, personName) {
  // ── Stage 1: Open Graph fetch ────────────────────────────
  try {
    const ogData = await fetchOpenGraph(article.url);

    if (ogData.title && !article.title?.trim()) {
      article.title = ogData.title;
    }
    if (ogData.description && (!article.excerpt || article.excerpt.length < MIN_EXCERPT_LEN)) {
      article.excerpt = ogData.description;
    }
    if (ogData.publishedTime && !article.date) {
      article.date = normalizeDate(ogData.publishedTime);
    }
    if (ogData.siteName && !article.publication) {
      article.publication = ogData.siteName;
    }

    // If we got both date and excerpt, we're done
    if (article.date && article.excerpt?.length >= MIN_EXCERPT_LEN) return;
  } catch {
    // Silent — fall through to DDG
  }

  // ── Stage 2: DuckDuckGo snippet fallback ─────────────────
  if (!article.excerpt || article.excerpt.length < MIN_EXCERPT_LEN) {
    try {
      const snippet = await ddgSnippet(article.title || article.url, personName);
      if (snippet && snippet.length >= MIN_EXCERPT_LEN) {
        article.excerpt = snippet;
      }
    } catch {
      // Silent
    }
  }
}

/**
 * Fetch a URL and parse Open Graph + article metadata from <head>.
 * Uses range/stream read to avoid downloading full pages.
 */
async function fetchOpenGraph(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PersonArchiveBot/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'Range': `bytes=0-${MAX_BYTES}`
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    if (!res.ok && res.status !== 206) {
      // 206 = Partial Content (our Range request was honored)
      return {};
    }

    // Read only the first MAX_BYTES
    const buf = [];
    let total = 0;
    for await (const chunk of res.body) {
      buf.push(chunk);
      total += chunk.length;
      if (total >= MAX_BYTES) break;
    }
    const html = Buffer.concat(buf).toString('utf-8');
    return parseOGTags(html);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse Open Graph and article meta tags from an HTML string.
 */
function parseOGTags(html) {
  const result = {};

  // Grab just the <head> section for speed
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i) || [html];
  const head = headMatch[0];

  // og:title / twitter:title / <title>
  result.title = extractMeta(head, ['og:title', 'twitter:title']) || extractTitle(head);

  // og:description / twitter:description / description
  result.description = extractMeta(head, [
    'og:description', 'twitter:description', 'description'
  ]);

  // Article published time — covers most CMSes
  result.publishedTime = extractMeta(head, [
    'article:published_time',
    'article:modified_time',
    'og:updated_time',
    'datePublished',
    'DC.date',
    'pubdate'
  ]) || extractJsonLdDate(head);

  // og:site_name
  result.siteName = extractMeta(head, ['og:site_name']);

  return result;
}

function extractMeta(head, names) {
  for (const name of names) {
    // <meta property="..." content="..."> or <meta name="..." content="...">
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRe(name)}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRe(name)}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = head.match(re);
      if (m?.[1]?.trim()) return decodeHtmlEntities(m[1].trim());
    }
  }
  return '';
}

function extractTitle(head) {
  const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : '';
}

function extractJsonLdDate(head) {
  try {
    const scripts = [...head.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const s of scripts) {
      const data = JSON.parse(s[1]);
      const candidates = [data, ...(data['@graph'] || [])];
      for (const item of candidates) {
        const d = item?.datePublished || item?.dateModified;
        if (d) return d;
      }
    }
  } catch {}
  return '';
}

function escapeRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function normalizeDate(raw) {
  if (!raw) return '';
  // ISO 8601, e.g. "2023-04-15T10:30:00Z" → "2023-04-15"
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Try JS Date parse
  try {
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  } catch {}
  return raw;
}

/**
 * DuckDuckGo snippet lookup for a given article title.
 * Returns the first snippet that looks meaningful.
 */
async function ddgSnippet(titleOrUrl, personName) {
  const query = personName
    ? `"${personName}" ${stripUrlToTitle(titleOrUrl)}`
    : stripUrlToTitle(titleOrUrl);

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html'
      },
      timeout: 8000
    });
    if (!res.ok) return '';

    const html = await res.text();

    // Pull all result snippets
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/g;
    let m;
    while ((m = snippetRe.exec(html)) !== null) {
      const snippet = m[1].replace(/<[^>]+>/g, '').trim();
      if (snippet.length >= MIN_EXCERPT_LEN) return decodeHtmlEntities(snippet);
    }
  } catch {}
  return '';
}

function stripUrlToTitle(str) {
  if (!str.startsWith('http')) return str.slice(0, 120);
  try {
    const parts = new URL(str).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1].replace(/-/g, ' ');
  } catch {
    return str.slice(0, 120);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
