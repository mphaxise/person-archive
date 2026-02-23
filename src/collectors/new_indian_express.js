/**
 * Collector: The New Indian Express
 * Scrapes the author page at /authors/{slug}
 */

import * as cheerio from 'cheerio';
import { safeFetch, sleep } from '../utils.js';

const BASE_URL = 'https://www.newindianexpress.com';

export async function collectNewIndianExpress(pub, config) {
  const authorSlug = pub.authorSlug;
  const articles = [];
  let page = 1;

  while (page <= 20) {
    const url = page === 1
      ? `${BASE_URL}/authors/${authorSlug}`
      : `${BASE_URL}/authors/${authorSlug}?page=${page}`;

    const resp = await safeFetch(url);
    if (!resp.ok) break;
    const html = await resp.text();
    const $ = cheerio.load(html);

    const found = [];
    $('div.story-list .story-card, article.story-card, .author-stories .story').each((_, el) => {
      const titleEl = $(el).find('h3 a, h2 a, .title a').first();
      const title = titleEl.text().trim();
      const href = titleEl.attr('href');
      const date = $(el).find('time, .publish-date, .date').first().text().trim();
      const summary = $(el).find('p, .summary').first().text().trim();

      if (title && href) {
        found.push({
          title,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          date,
          summary,
          publication: 'The New Indian Express',
          author: config.name
        });
      }
    });

    if (found.length === 0) break;
    articles.push(...found);
    page++;
    await sleep(500);
  }

  return articles;
}
