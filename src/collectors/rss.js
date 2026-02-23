/**
 * rss.js
 *
 * RSS/Atom feed collector for global publications.
 * Handles Medium, Google News, Substack, and any RSS-enabled source.
 */

import { safeFetch } from '../utils.js';

/**
 * Given a person name + optional Medium handle, collect articles via RSS.
 * Returns article-shaped objects.
 */
export async function collectRSS(config) {
  const articles = [];
  const seen = new Set();
  const name = config.name;

  const feeds = buildFeedUrls(name, config.rssHandles || {});

  for (const { url, label } of feeds) {
    try {
      const res = await safeFetch(url, { timeout: 10000 });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRSSOrAtom(xml);
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue;
        // Basic relevance filter: title or feed label should relate to the person
        seen.add(item.url);
        articles.push({
          title:       item.title,
          url:         item.url,
          date:        item.date || '',
          excerpt:     item.excerpt || '',
          publication: label,
          author:      name,
          source:      'rss'
        });
      }
    } catch (_) {
      // silently skip broken feeds
    }
  }

  return articles;
}

/**
 * Build feed URLs to try for a given person name.
 * Incorporates optional handles from config.rssHandles:
 *   { medium: '@barackobama', substack: 'slug', ... }
 */
function buildFeedUrls(name, handles = {}) {
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const slugNoDash = slug.replace(/-/g, '');
  const feeds = [];

  // ── Medium ──────────────────────────────────────────────────
  if (handles.medium) {
    // Explicit handle provided
    const handle = handles.medium.startsWith('@') ? handles.medium : `@${handles.medium}`;
    feeds.push({ url: `https://medium.com/feed/${handle}`, label: 'Medium' });
  } else {
    // Try common patterns
    feeds.push({ url: `https://medium.com/feed/@${slug}`, label: 'Medium' });
    feeds.push({ url: `https://medium.com/feed/@${slugNoDash}`, label: 'Medium' });
  }

  // ── Substack ────────────────────────────────────────────────
  if (handles.substack) {
    feeds.push({ url: `https://${handles.substack}.substack.com/feed`, label: 'Substack' });
  } else {
    feeds.push({ url: `https://${slug}.substack.com/feed`, label: 'Substack' });
  }

  // ── Google News RSS (most reliable for public figures) ─────
  const gnQuery = encodeURIComponent(`"${name}" author`);
  feeds.push({
    url: `https://news.google.com/rss/search?q=${gnQuery}&hl=en-US&gl=US&ceid=US:en`,
    label: 'Google News'
  });

  // ── Bing News RSS ────────────────────────────────────────────
  feeds.push({
    url: `https://www.bing.com/news/search?q=${encodeURIComponent(`"${name}"`)}&format=rss`,
    label: 'Bing News'
  });

  return feeds;
}

/**
 * Parse RSS 2.0 or Atom 1.0 XML into a normalized article list.
 */
function parseRSSOrAtom(xml) {
  const items = [];

  // Determine feed type
  const isAtom = /<feed[\s>]/i.test(xml);

  if (isAtom) {
    // Atom entries
    const entryMatches = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
    for (const entry of entryMatches) {
      const title   = extractTag(entry, 'title');
      const url     = extractAtomLink(entry);
      const date    = extractTag(entry, 'published') || extractTag(entry, 'updated');
      const excerpt = extractTag(entry, 'summary') || extractTag(entry, 'content');
      if (title && url) items.push({ title: cleanText(title), url, date: normalizeDate(date), excerpt: cleanText(excerpt) });
    }
  } else {
    // RSS 2.0 items
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    for (const item of itemMatches) {
      const title   = extractTag(item, 'title');
      const url     = extractTag(item, 'link') || extractTag(item, 'guid');
      const date    = extractTag(item, 'pubDate') || extractTag(item, 'dc:date');
      const excerpt = extractTag(item, 'description') || extractTag(item, 'content:encoded');
      if (title && url) items.push({ title: cleanText(title), url: url.trim(), date: normalizeDate(date), excerpt: cleanText(excerpt?.slice(0, 300)) });
    }
  }

  return items;
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
         || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function extractAtomLink(entry) {
  // Prefer rel="alternate" href
  const m = entry.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i)
         || entry.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']alternate["']/i)
         || entry.match(/<link[^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function cleanText(str = '') {
  return str
    .replace(/<[^>]+>/g, '') // strip HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(raw = '') {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  } catch {
    return '';
  }
}
