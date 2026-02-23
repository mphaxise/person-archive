/**
 * discovery.js
 *
 * Smart publication discovery: given a person's name, search the web
 * to find where they publish, then return a list of (publication, authorSlug, articles)
 * pairs that the collector modules can use.
 */

import fetch from 'node-fetch';

// Known publications the collector supports, with their domain patterns
const KNOWN_PUBLICATIONS = [
  { id: 'new_indian_express', domain: 'newindianexpress.com', label: 'New Indian Express' },
  { id: 'the_wire',           domain: 'thewire.in',           label: 'The Wire' },
  { id: 'scroll_in',          domain: 'scroll.in',            label: 'Scroll.in' },
  { id: 'epw',                domain: 'epw.in',               label: 'Economic & Political Weekly' },
  { id: 'outlook_india',      domain: 'outlookindia.com',     label: 'Outlook India' },
  { id: 'deccan_herald',      domain: 'deccanherald.com',     label: 'Deccan Herald' },
  { id: 'deccan_chronicle',   domain: 'deccanchronicle.com',  label: 'Deccan Chronicle' },
  { id: 'the_hindu',          domain: 'thehindu.com',         label: 'The Hindu' },
  { id: 'hindustan_times',    domain: 'hindustantimes.com',   label: 'Hindustan Times' },
  { id: 'indian_express',     domain: 'indianexpress.com',    label: 'Indian Express' },
  { id: 'livemint',           domain: 'livemint.com',         label: 'Livemint' },
  { id: 'business_standard',  domain: 'business-standard.com',label: 'Business Standard' },
  { id: 'firstpost',          domain: 'firstpost.com',        label: 'Firstpost' },
  { id: 'the_quint',          domain: 'thequint.com',         label: 'The Quint' },
  { id: 'national_herald',    domain: 'nationalheraldindia.com', label: 'National Herald' },
  { id: 'muck_rack',          domain: 'muckrack.com',         label: 'Muck Rack' },
  { id: 'guardian',           domain: 'theguardian.com',      label: 'The Guardian' },
  { id: 'nyt',                domain: 'nytimes.com',          label: 'New York Times' },
  { id: 'wapo',               domain: 'washingtonpost.com',   label: 'Washington Post' },
  { id: 'aljazeera',          domain: 'aljazeera.com',        label: 'Al Jazeera' },
  { id: 'bbc',                domain: 'bbc.com',              label: 'BBC' },
];

/**
 * Discover publications for a given person name.
 * Returns: { publications: [{id, domain, label, articles: [{title, url, snippet}], authorSlug}] }
 *
 * Strategy:
 *   1. DuckDuckGo HTML search for "Name" site:domain for each known pub
 *   2. Muck Rack profile lookup
 *   3. DuckDuckGo general search to surface any unlisted publications
 */
export async function discoverPublications(personName) {
  console.log(`  🔍 Discovering publications for "${personName}"...`);

  const found = [];
  const allUrls = new Set();

  // ── Phase 1: targeted site: searches for each known publication ──
  for (const pub of KNOWN_PUBLICATIONS) {
    const results = await ddgSearch(`"${personName}" site:${pub.domain}`);
    const matching = results.filter(r =>
      r.url.includes(pub.domain) &&
      !r.url.match(/\/(tag|category|section|topic)\//i)
    );
    if (matching.length > 0) {
      const authorSlug = extractAuthorSlug(matching.map(r => r.url), pub.domain);
      found.push({ ...pub, articles: matching, authorSlug });
      matching.forEach(r => allUrls.add(r.url));
      console.log(`    ✓ ${pub.label}: ${matching.length} articles found`);
    }
  }

  // ── Phase 2: general search to surface any publications we missed ──
  const generalResults = await ddgSearch(`"${personName}" opinion essay article author`);
  for (const r of generalResults) {
    if (allUrls.has(r.url)) continue;
    const knownPub = KNOWN_PUBLICATIONS.find(p => r.url.includes(p.domain));
    if (knownPub && !found.find(f => f.id === knownPub.id)) {
      found.push({ ...knownPub, articles: [r], authorSlug: '' });
      allUrls.add(r.url);
      console.log(`    ✓ ${knownPub.label}: found via general search`);
    }
  }

  // ── Phase 3: Muck Rack profile (aggregator — catches everything else) ──
  const muckRackSlug = personName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const muckRackProfile = await checkMuckRack(muckRackSlug);
  if (muckRackProfile) {
    const existing = found.find(f => f.id === 'muck_rack');
    if (!existing) {
      found.push({
        id: 'muck_rack',
        domain: 'muckrack.com',
        label: 'Muck Rack',
        articles: [{ title: 'Muck Rack Profile', url: muckRackProfile, snippet: '' }],
        authorSlug: muckRackSlug
      });
      console.log(`    ✓ Muck Rack profile found`);
    } else {
      existing.authorSlug = muckRackSlug;
    }
  }

  if (found.length === 0) {
    console.log(`    ⚠️  No known publications found. Will use DuckDuckGo fallback search only.`);
  }

  return { publications: found, allSearchUrls: [...allUrls] };
}

/**
 * Given a set of article URLs for a domain, try to extract the author slug.
 * e.g. "https://thewire.in/author/shiv-visvanathan" → "shiv-visvanathan"
 */
function extractAuthorSlug(urls, domain) {
  const authorPatterns = [
    /\/author\/([^/?#]+)/i,
    /\/authors?\/([^/?#]+)/i,
    /\/writer\/([^/?#]+)/i,
    /\/contributors?\/([^/?#]+)/i,
    /\/people\/([^/?#]+)/i,
    /\/profile\/([^/?#]+)/i,
  ];
  for (const url of urls) {
    for (const pattern of authorPatterns) {
      const m = url.match(pattern);
      if (m) return m[1];
    }
  }
  return ''; // Will need manual config or DuckDuckGo-based collection
}

/**
 * DuckDuckGo HTML search (no API key required).
 * Returns array of {title, url, snippet}.
 */
async function ddgSearch(query, maxResults = 10) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseDdgHtml(html).slice(0, maxResults);
  } catch {
    return [];
  }
}

function parseDdgHtml(html) {
  const results = [];

  // Extract redirect URLs
  const urlRegex = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/g;
  const titleRegex = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/g;

  const urls = [];
  let m;
  while ((m = urlRegex.exec(html)) !== null) {
    try { urls.push(decodeURIComponent(m[1])); } catch {}
  }

  const titles = [];
  while ((m = titleRegex.exec(html)) !== null) {
    titles.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  const snippets = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < urls.length; i++) {
    if (!urls[i]?.startsWith('http')) continue;
    if (urls[i]?.includes('duckduckgo.com')) continue;
    results.push({
      url: urls[i],
      title: titles[i] || '',
      snippet: snippets[i] || ''
    });
  }

  return results;
}

/**
 * Check if a Muck Rack profile exists for the given slug.
 */
async function checkMuckRack(slug) {
  try {
    const url = `https://muckrack.com/${slug}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    if (res.ok && res.status === 200) return url;
    return null;
  } catch {
    return null;
  }
}

/**
 * Quick search: just return top article URLs for a person across all publications.
 * Used by the collector as a fast path when author page scrapers fail.
 */
export async function searchArticlesForPerson(personName, publication = null) {
  const query = publication
    ? `"${personName}" site:${publication}`
    : `"${personName}" opinion article essay`;
  return await ddgSearch(query, 20);
}
