/**
 * Collector: Economic and Political Weekly (EPW)
 */

import * as cheerio from 'cheerio';
import { safeFetch, sleep } from '../utils.js';

const BASE_URL = 'https://www.epw.in';

export async function collectEPW(pub, config) {
  const articles = [];
  let page = 0;

  while (page < 20) {
    const url = `${BASE_URL}/authors/${pub.authorSlug}?page=${page}`;
    const resp = await safeFetch(url);
    if (!resp.ok) break;

    const html = await resp.text();
    const $ = cheerio.load(html);
    const found = [];

    $('article, .views-row, .search-result').each((_, el) => {
      const titleEl = $(el).find('h3 a, h2 a, .field-title a').first();
      const title = titleEl.text().trim();
      const href = titleEl.attr('href');
      const date = $(el).find('time, .date, .field-date').first().text().trim();
      const summary = $(el).find('p, .summary').first().text().trim();

      if (title && href) {
        found.push({
          title,
          url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
          date, summary,
          publication: 'Economic and Political Weekly',
          author: config.name
        });
      }
    });

    if (found.length === 0) break;
    articles.push(...found);
    page++;
    await sleep(800);
  }
  return articles;
}
