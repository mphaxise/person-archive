/**
 * search.js
 *
 * DuckDuckGo-based fallback collector.
 * Used when author-page scrapers don't find enough articles,
 * or when a publication has no dedicated collector.
 */



/**
 * Search DuckDuckGo for "[Person Name] article/essay/opinion"
 * and return article-shaped objects for any URLs not already seen.
 */
export async function searchAndCollect(personName, seenUrls = new Set()) {
  const queries = [
    `"${personName}" opinion article`,
    `"${personName}" essay author`,
    `"${personName}" column writes`,
  ];

  const allResults = [];
  const seenLocal = new Set(seenUrls);

  for (const query of queries) {
    const results = await ddgSearch(query, 15);
    for (const r of results) {
      if (seenLocal.has(r.url)) continue;
      if (!isLikelyArticle(r.url)) continue;
      seenLocal.add(r.url);
      allResults.push({
        title: r.title,
        url: r.url,
        date: '',
        excerpt: r.snippet,
        publication: extractDomain(r.url),
        source: 'duckduckgo'
      });
    }
  }

  return allResults;
}

async function ddgSearch(query, maxResults = 10) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
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
  const linkRegex = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/g;
  const titleRegex = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/g;

  const urls = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    try {
      urls.push(decodeURIComponent(m[1]));
    } catch {}
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
    results.push({
      url: urls[i],
      title: titles[i] || '',
      snippet: snippets[i] || ''
    });
  }

  return results;
}

function isLikelyArticle(url) {
  // Filter out homepages, search pages, social profiles
  const skipPatterns = [
    /\/(tag|category|section|topic|search|profile|about|contact)\//i,
    /\?q=/,
    /twitter\.com/,
    /facebook\.com/,
    /linkedin\.com\/in/,
    /instagram\.com/,
    /wikipedia\.org/,
    /amazon\.com/,
    /youtube\.com/,
  ];
  return !skipPatterns.some(p => p.test(url));
}

function extractDomain(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace('www.', '');
  } catch {
    return url;
  }
}
