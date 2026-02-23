/**
 * collectors/index.js
 *
 * Dispatch article collection across all configured/discovered publications.
 * Runs discoverPublications() first to find where a person publishes,
 * then scrapes each source, then enriches any articles missing
 * dates/summaries via Open Graph metadata + DuckDuckGo snippets.
 */

import { discoverPublications } from '../discovery.js';
import { collectNewIndianExpress } from './new_indian_express.js';
import { collectTheWire } from './the_wire.js';
import { collectScrollIn } from './scroll_in.js';
import { collectEPW } from './epw.js';
import { collectOutlookIndia } from './outlook_india.js';
import { collectMuckRack } from './muck_rack.js';
import { collectRSS } from './rss.js';
import { searchAndCollect } from './search.js';
import { enrichArticles } from '../enricher.js';

// Map publication IDs → collector functions + metadata
const PUBLICATIONS = {
  new_indian_express: { collector: collectNewIndianExpress, label: 'New Indian Express' },
  the_wire:           { collector: collectTheWire,          label: 'The Wire' },
  scroll_in:          { collector: collectScrollIn,         label: 'Scroll.in' },
  epw:                { collector: collectEPW,              label: 'Economic & Political Weekly' },
  outlook_india:      { collector: collectOutlookIndia,     label: 'Outlook India' },
  muck_rack:          { collector: collectMuckRack,         label: 'Muck Rack' },
};

/**
 * Main entry point.
 * 1. Run discovery to find where this person publishes
 * 2. RSS feeds (Medium, Google News, Substack) — always run first as fast path
 * 3. For each configured/discovered publication, run its collector
 * 4. DuckDuckGo fallback search to catch anything missed
 * 5. Metadata enrichment — fill in missing dates/summaries
 * 6. De-duplicate + sort by date
 */
export async function collectAll(config) {
  const allArticles = [];
  const seenUrls = new Set();

  function addArticles(articles) {
    for (const a of articles) {
      if (!a.url || seenUrls.has(a.url)) continue;
      seenUrls.add(a.url);
      allArticles.push(a);
    }
  }

  // ── Step 0: RSS / Atom feeds (fast, reliable, no JS needed) ──
  console.log(`\n  📡 Collecting via RSS feeds...`);
  try {
    const rssArticles = await collectRSS(config);
    if (rssArticles.length > 0) {
      console.log(`    → ${rssArticles.length} articles from RSS`);
      addArticles(rssArticles);
    }
  } catch (err) {
    console.warn(`    RSS collection error: ${err.message}`);
  }

  // ── Step 1: Discovery ──────────────────────────────────────
  console.log(`\n  Running publication discovery for "${config.name}"...`);
  let discoveredPubs = [];
  try {
    const result = await discoverPublications(config.name);
    discoveredPubs = result.publications;
    console.log(`  Discovery found ${discoveredPubs.length} publication source(s)`);
  } catch (err) {
    console.warn(`  Discovery error: ${err.message}`);
  }

  // Build discovery map: pubId → discovered data
  const discoveryMap = new Map(discoveredPubs.map(p => [p.id, p]));

  // ── Step 2: Run scrapers for configured publications ──────
  const configPubs = config.publications || Object.keys(PUBLICATIONS).map(id => ({ id, authorSlug: '' }));

  for (const pub of configPubs) {
    const pubMeta = PUBLICATIONS[pub.id];
    if (!pubMeta) continue;

    const label = pub.label || pubMeta.label;
    const disc = discoveryMap.get(pub.id);

    const authorSlug = pub.authorSlug || disc?.authorSlug || '';

    if (!authorSlug && pub.id !== 'muck_rack') {
      if (disc?.articles?.length) {
        console.log(`  ${label}: no author slug — seeding ${disc.articles.length} discovery articles`);
        addArticles(disc.articles.map(a => ({
          title:       a.title || formatTitleFromUrl(a.url),
          url:         a.url,
          excerpt:     a.snippet || '',
          date:        '',
          publication: label,
          source:      pub.id
        })));
      }
      continue;
    }

    const enrichedPub = { ...pub, authorSlug, label };
    console.log(`  Collecting from ${label} (${authorSlug || 'default'})...`);

    try {
      const articles = await pubMeta.collector(enrichedPub, config);
      console.log(`    → ${articles.length} articles`);
      addArticles(articles);
    } catch (err) {
      console.warn(`    ⚠️  ${label} failed: ${err.message}`);
      if (disc?.articles?.length) {
        addArticles(disc.articles.map(a => ({
          title:       a.title || formatTitleFromUrl(a.url),
          url:         a.url,
          excerpt:     a.snippet || '',
          date:        '',
          publication: label,
          source:      pub.id
        })));
      }
    }
  }

  // ── Step 3: Also try any discovered pubs not in config ────
  for (const disc of discoveredPubs) {
    if (configPubs.find(p => p.id === disc.id)) continue;
    const pubMeta = PUBLICATIONS[disc.id];
    if (!pubMeta || !disc.authorSlug) {
      if (disc?.articles?.length) {
        addArticles(disc.articles.map(a => ({
          title:       a.title || formatTitleFromUrl(a.url),
          url:         a.url,
          excerpt:     a.snippet || '',
          date:        '',
          publication: disc.label,
          source:      disc.id
        })));
      }
      continue;
    }

    console.log(`  [Discovery] Collecting from ${disc.label} (${disc.authorSlug})...`);
    try {
      const articles = await pubMeta.collector(disc, config);
      console.log(`    → ${articles.length} articles`);
      addArticles(articles);
    } catch (err) {
      console.warn(`    ⚠️  ${disc.label} failed: ${err.message}`);
      if (disc?.articles?.length) {
        addArticles(disc.articles.map(a => ({
          title:       a.title || formatTitleFromUrl(a.url),
          url:         a.url,
          excerpt:     a.snippet || '',
          date:        '',
          publication: disc.label,
          source:      disc.id
        })));
      }
    }
  }

  // ── Step 4: DuckDuckGo fallback ───────────────────────────
  console.log(`  Running DuckDuckGo search fallback...`);
  try {
    const fallback = await searchAndCollect(config.name, seenUrls);
    if (fallback.length > 0) {
      console.log(`    → ${fallback.length} additional articles`);
      addArticles(fallback);
    }
  } catch (err) {
    console.warn(`    Fallback failed: ${err.message}`);
  }

  // ── Step 5: Metadata enrichment ───────────────────────────
  const needsEnrichment = allArticles.filter(a => !a.date || !a.excerpt);
  if (needsEnrichment.length > 0) {
    console.log(`\n  🔬 Enriching metadata for ${needsEnrichment.length} articles...`);
    await enrichArticles(allArticles, config.name);
  }

  // ── Step 6: Sort by date desc ─────────────────────────────
  allArticles.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  console.log(`\n  Total: ${allArticles.length} articles collected`);
  return allArticles;
}

function formatTitleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || parts[parts.length - 2] || '';
    return slug.replace(/-\d+$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch {
    return url;
  }
}
