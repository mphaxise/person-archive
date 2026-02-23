/**
 * PersonArchive — Site Generator
 *
 * Two modes:
 *   generateSiteInMemory() — pure in-memory, no fs (safe for Cloudflare Workers)
 *   generateSite()         — writes output to disk (CLI only, async)
 */

import { TEMPLATE } from '../templates/template.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

function normalizeArticles(articles) {
  return articles.map(a => ({
    title:       a.title       || '',
    url:         a.url         || '',
    date:        a.date        || '',
    publication: a.publication || '',
    source:      a.source      || '',
    summary:     a.summary || a.excerpt || a.description || '',
  }));
}

function buildStats(normalized) {
  const publications = [...new Set(normalized.map(a => a.publication).filter(Boolean))];
  const years = normalized
    .map(a => a.date ? parseInt(a.date.split('-')[0]) : null)
    .filter(Boolean);
  const yearRange = years.length
    ? `${Math.min(...years)}\u2013${Math.max(...years)}`
    : 'Unknown';
  return {
    totalArticles:   normalized.length,
    publications:    publications.length,
    yearRange,
    publicationList: publications,
    withDates:       normalized.filter(a => a.date).length,
    withSummaries:   normalized.filter(a => a.summary && a.summary.length > 20).length,
  };
}

function injectTemplate(template, config, normalized, stats) {
  return template
    .replace(/\{\{PERSONA_NAME\}\}/g,      escapeHtml(config.name))
    .replace(/\{\{PERSONA_SLUG\}\}/g,      escapeHtml(config.slug || ''))
    .replace(/\{\{PERSONA_BIO\}\}/g,       escapeHtml(config.bio || ''))
    .replace(/\{\{TOTAL_ARTICLES\}\}/g,    stats.totalArticles)
    .replace(/\{\{PUBLICATION_COUNT\}\}/g, stats.publications)
    .replace(/\{\{YEAR_RANGE\}\}/g,        stats.yearRange)
    .replace(/\{\{ARTICLES_JSON\}\}/g,     JSON.stringify(normalized))
    .replace(/\{\{STATS_JSON\}\}/g,        JSON.stringify(stats))
    .replace(/\{\{CONFIG_JSON\}\}/g,       JSON.stringify({
      name:  config.name,
      slug:  config.slug,
      bio:   config.bio  || '',
      links: config.links || {}
    }));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── In-memory variant (Workers-safe) ─────────────────────────────────────────

/**
 * Generate the archive site entirely in memory.
 * @returns {{ indexHtml: string, articlesJson: string }}
 */
export function generateSiteInMemory({ config, articles }) {
  const normalized   = normalizeArticles(articles);
  const stats        = buildStats(normalized);
  const indexHtml    = injectTemplate(TEMPLATE, config, normalized, stats);
  const articlesJson = JSON.stringify(normalized, null, 2);
  return { indexHtml, articlesJson };
}

// ── Disk-based variant (CLI only) ─────────────────────────────────────────────

/**
 * Generate the archive site and write it to outDir.
 * Async — uses dynamic imports for Node built-ins (safe: never called in Workers).
 */
export async function generateSite({ config, articles, outDir }) {
  const { default: fs }   = await import('fs');
  const { default: path } = await import('path');

  const mkDir = (p) => fs.mkdirSync(p, { recursive: true });

  mkDir(outDir);
  mkDir(path.join(outDir, 'data'));

  const normalized   = normalizeArticles(articles);
  const stats        = buildStats(normalized);

  fs.writeFileSync(
    path.join(outDir, 'data', 'articles.json'),
    JSON.stringify(normalized, null, 2),
    'utf-8'
  );

  const html = injectTemplate(TEMPLATE, config, normalized, stats);
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
}
