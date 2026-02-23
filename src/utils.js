/**
 * PersonArchive — shared utilities
 */

import fs from 'fs';
import path from 'path';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function readPersonaConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Persona config not found: ${configPath}`);
  }
  return readJson(configPath);
}

/**
 * Deduplicate articles by URL
 */
export function dedupe(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

/**
 * Normalize an article to the canonical schema:
 * { title, url, date, publication, author, summary, tags }
 */
export function normalizeArticle(raw, publication) {
  return {
    title: (raw.title || '').trim(),
    url: (raw.url || '').trim(),
    date: raw.date ? parseDate(raw.date) : null,
    publication: raw.publication || publication || 'Unknown',
    author: (raw.author || '').trim(),
    summary: (raw.summary || raw.description || '').trim(),
    tags: raw.tags || []
  };
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return str;
}

/**
 * Sleep utility for rate-limiting
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safe fetch with timeout and retry
 */
export async function safeFetch(url, opts = {}, retries = 2) {
  // Use native fetch (Node 18+ / Workers)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);
  try {
    const response = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PersonArchive/0.1; +https://github.com/mphaxise/shiv-archive)',
        ...(opts.headers || {})
      }
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    if (retries > 0) {
      await sleep(1000);
      return safeFetch(url, opts, retries - 1);
    }
    throw err;
  }
}

/**
 * Alias for dedupe — deduplicate articles by URL
 */
export function deduplicateByUrl(articles) {
  return dedupe(articles);
}
