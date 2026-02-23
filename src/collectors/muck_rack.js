/**
 * Collector: Muck Rack (cross-publication aggregator)
 */

import * as cheerio from 'cheerio';
import { safeFetch } from '../utils.js';

const BASE_URL = 'https://muckrack.com';

export async function collectMuckRack(pub, config) {
  if (!pub.authorSlug) return [];

  const url = `${BASE_URL}/${pub.authorSlug}`;
  const resp = await safeFetch(url);
  if (!resp.ok) return [];

  const html = await resp.text();
  const $ = cheerio.load(html);
  const articles = [];

  $('article, .article-card, .portfolio-item, li.article').each((_, el) => {
    const titleEl = $(el).find('h3 a, h2 a, .title a').first();
    const title = titleEl.text().trim();
    const href = titleEl.attr('href') || $(el).find('a').first().attr('href');
    const date = $(el).find('time, .date').first().text().trim();
    const pubName = $(el).find('.publication, .outlet').first().text().trim();
    const summary = $(el).find('.summary, p').first().text().trim();

    if (title && href) {
      articles.push({
        title,
        url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
        date, summary,
        publication: pubName || 'Muck Rack',
        author: config.name
      });
    }
  });

  return articles;
}
