/**
 * PersonArchive — Site Generator
 * Reads the HTML template, injects article data & persona config, outputs a self-contained static site.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDir, writeJson } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '../../templates/index.html');

export function generateSite({ config, articles, outDir }) {
  ensureDir(outDir);
  ensureDir(path.join(outDir, 'data'));

  // Normalize articles — unify excerpt/summary → summary, clean missing fields
  const normalized = articles.map(a => ({
    title:       a.title       || '',
    url:         a.url         || '',
    date:        a.date        || '',
    publication: a.publication || '',
    source:      a.source      || '',
    // Collectors use `excerpt`, template uses `summary` — bridge the gap
    summary:     a.summary || a.excerpt || a.description || '',
  }));

  // Write raw data file
  writeJson(path.join(outDir, 'data', 'articles.json'), normalized);

  // Read template
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // Compute summary stats
  const publications = [...new Set(normalized.map(a => a.publication).filter(Boolean))];
  const years = normalized
    .map(a => a.date ? parseInt(a.date.split('-')[0]) : null)
    .filter(Boolean);
  const yearRange = years.length
    ? `${Math.min(...years)}–${Math.max(...years)}`
    : 'Unknown';

  const stats = {
    totalArticles: normalized.length,
    publications: publications.length,
    yearRange,
    publicationList: publications,
    // Enrichment stats for UI display
    withDates:    normalized.filter(a => a.date).length,
    withSummaries: normalized.filter(a => a.summary && a.summary.length > 20).length,
  };

  // Inject variables
  html = html
    .replace(/\{\{PERSONA_NAME\}\}/g, escapeHtml(config.name))
    .replace(/\{\{PERSONA_SLUG\}\}/g, escapeHtml(config.slug || ''))
    .replace(/\{\{PERSONA_BIO\}\}/g, escapeHtml(config.bio || ''))
    .replace(/\{\{TOTAL_ARTICLES\}\}/g, stats.totalArticles)
    .replace(/\{\{PUBLICATION_COUNT\}\}/g, stats.publications)
    .replace(/\{\{YEAR_RANGE\}\}/g, stats.yearRange)
    .replace(/\{\{ARTICLES_JSON\}\}/g, JSON.stringify(normalized))
    .replace(/\{\{STATS_JSON\}\}/g, JSON.stringify(stats))
    .replace(/\{\{CONFIG_JSON\}\}/g, JSON.stringify({
      name: config.name,
      slug: config.slug,
      bio: config.bio || '',
      links: config.links || {}
    }));

  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
