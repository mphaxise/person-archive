/**
 * pipeline.js
 *
 * Pure orchestration: collect → generate → push → deploy.
 * No disk I/O — fully in-memory so it runs in Cloudflare Workers.
 *
 * Usage (Workers or Node):
 *   import { runPipeline } from './pipeline.js';
 *   const result = await runPipeline({ name, strategies, options }, env);
 */

import { collectAll }          from './collectors/index.js';
import { generateSiteInMemory } from './generator/index.js';
import { getGitHubUser, createRepo, pushFilesInMemory } from './github.js';
import { deployInMemory }      from './cloudflare.js';

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Run the full PersonArchive pipeline in-memory.
 *
 * @param {{ name: string, strategies?: string[], options?: object }} params
 * @param {object} env  — { GITHUB_TOKEN, CF_TOKEN, CF_ACCOUNT_ID } (process.env or CF env bindings)
 * @returns {{ articleCount, indexHtml, githubUrl?, liveUrl? }}
 */
export async function runPipeline({ name, strategies = [], options = {} }, env = {}) {
  if (!name?.trim()) throw new Error('name is required');

  const slug   = slugify(name.trim());
  const config = { name: name.trim(), slug, bio: '', publications: [], links: {} };

  const githubToken = env.GITHUB_TOKEN || '';
  const cfToken     = env.CF_TOKEN     || '';
  const cfAccountId = env.CF_ACCOUNT_ID || '';

  // ── 1. Collect articles ───────────────────────────────────────────────────
  console.log(`\n📚 Collecting articles for "${config.name}"...`);

  const deepStrats = ['rss', 'wayback', 'ddg', 'sitemap', 'paginate', 'muckrack', 'academic'];
  const useDeep    = strategies.some(s => deepStrats.includes(s));

  let articles;
  if (useDeep) {
    // Dynamic import keeps deep_crawl.js out of the Workers bundle if unused
    const { deepCrawl } = await import('./deep_crawl.js');
    articles = await deepCrawl(config, []);
  } else {
    articles = await collectAll(config);
  }
  console.log(`✅ ${articles.length} articles collected`);

  if (articles.length === 0) {
    console.log(`⚠️  No articles found — try a different name or enable deep crawl strategies`);
  }

  // ── 2. Generate site in-memory ────────────────────────────────────────────
  console.log(`\n🏗️  Building site...`);
  const { indexHtml, articlesJson } = generateSiteInMemory({ config, articles });
  const files = {
    'index.html':          indexHtml,
    'data/articles.json':  articlesJson,
  };
  console.log(`✅ Site built (${Math.round(indexHtml.length / 1024)}KB)`);

  const results = { articleCount: articles.length, indexHtml };

  // ── 3. Push to GitHub ─────────────────────────────────────────────────────
  const projectName = `${slug}-archive`;
  const doGithub    = options.github !== false && githubToken;

  if (doGithub) {
    try {
      console.log(`\n🐙 Pushing to GitHub...`);
      const owner = await getGitHubUser(githubToken);
      await createRepo(githubToken, { repoName: projectName, description: `Article archive for ${config.name}` });
      await pushFilesInMemory(githubToken, { owner, repoName: projectName, files });
      results.githubUrl = `https://github.com/${owner}/${projectName}`;
      console.log(`✅ GitHub: ${results.githubUrl}`);
    } catch (e) {
      console.warn(`⚠️  GitHub push failed: ${e.message}`);
    }
  }

  // ── 4. Deploy to Cloudflare Pages ─────────────────────────────────────────
  const doDeploy = options.deploy !== false && cfToken && cfAccountId;

  if (doDeploy) {
    try {
      console.log(`\n☁️  Deploying to Cloudflare Pages...`);
      const liveUrl = await deployInMemory(cfToken, cfAccountId, projectName, files);
      results.liveUrl = liveUrl;
      console.log(`✅ Live: ${results.liveUrl}`);
    } catch (e) {
      console.warn(`⚠️  Cloudflare deploy failed: ${e.message}`);
    }
  }

  return results;
}
