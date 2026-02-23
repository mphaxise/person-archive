/**
 * Collector: Scroll.in
 */

import * as cheerio from 'cheerio';
import { safeFetch, sleep } from '../utils.js';

const BASE_URL = 'https://scroll.in';

export async function collectScrollIn(pub, config) {
  const articles = [];
  let page = 1;

  while (page <= 20) {
    const url = page === 1
      ? `${BASE_URL}/author/${pub.authorSlug}`
      : `${BASE_URL}/author/${pub.authorSlug}?page=${page}`;

    const resp = await safeFetch(url);
    if (!resp.ok) break;

    const html = await resp.text();
    const $ = cheerio.load(html);
    const found = [];

    $('article, .content-card, .story-item').each((_, el) => {
      const titleEl = $(el).find('h2 a, h3 a, .headline a').first();
      const title = titleEl.text().trim();
      const href = titleEl.attr('href');
      const date = $(el).find('time, .date').first().text().trim();
      const summary = $(el).find('p, .description').first().text().trim();

      if (title && href) {
        found.push({
          title,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          date, summary,
          publication: 'Scroll.in',
          author: config.name
        });
      }
    });

    if (found.length === 0) break;
    articles.push(...found);
    page++;
    await sleep(600);
  }
  return articles;
}
