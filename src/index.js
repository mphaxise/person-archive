#!/usr/bin/env node
/**
 * PersonArchive CLI
 * Generate article-archive static sites from any person's public byline corpus
 *
 * Usage:
 *   person-archive generate "Shiv Visvanathan"
 *     → scrapes articles, builds site, creates GitHub repo, deploys to Cloudflare Pages
 *
 *   person-archive generate "Shiv Visvanathan" --deep
 *     → runs ALL 7 deep-crawl strategies for maximum coverage before building
 *
 *   person-archive deep-collect "Shiv Visvanathan"
 *     → standalone deep crawl: runs all strategies, saves merged articles.json
 */

import { Command } from 'commander';
import { collectAll } from './collectors/index.js';
import { deepCrawl } from './deep_crawl.js';
import { generateSite } from './generator/index.js';
import { enrichArticles } from './enricher.js';
import { readPersonaConfig, writeJson, readJson, ensureDir } from './utils.js';
import { getGitHubUser, createRepo, pushDirToRepo } from './github.js';
import { fullDeploy } from './cloudflare.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
  }
} catch {}

const program = new Command();

program
  .name('person-archive')
  .description('Generate article-archive static sites from any person\'s public byline corpus')
  .version('0.2.0');

// ─────────────────────────────────────────────────────────────
// GENERATE — THE MAIN COMMAND
// ─────────────────────────────────────────────────────────────
program
  .command('generate <name>')
  .description('Full pipeline: scrape → [deep crawl] → enrich → build → GitHub → Cloudflare Pages')
  .option('--deep', 'Run deep crawl (7 strategies: RSS, Wayback, DDG blast, sitemaps, pagination, Muck Rack, Scholar) for maximum coverage')
  .option('--no-github', 'Skip GitHub repo creation')
  .option('--no-deploy', 'Skip Cloudflare Pages deployment')
  .option('--no-enrich', 'Skip metadata enrichment pass')
  .option('--github-token <token>', 'GitHub Personal Access Token (or set GITHUB_TOKEN env)')
  .option('--cf-token <token>', 'Cloudflare API Token (or set CF_TOKEN env)')
  .option('--cf-account <id>', 'Cloudflare Account ID (or set CF_ACCOUNT_ID env)')
  .option('--private', 'Make GitHub repo private')
  .option('--load <file>', 'Skip scraping, load articles from this JSON file instead')
  .action(async (name, opts) => {
    const modeLabel = opts.deep ? '(deep crawl mode)' : '';
    console.log(`\n🚀 PersonArchive — generating archive for "${name}" ${modeLabel}\n`);

    const githubToken = opts.githubToken || process.env.GITHUB_TOKEN;
    const cfToken = opts.cfToken || process.env.CF_TOKEN;
    const cfAccountId = opts.cfAccount || process.env.CF_ACCOUNT_ID;

    const slug = slugify(name);
    const personaDir = path.join(process.cwd(), 'personas', slug);
    const configPath = path.join(personaDir, 'persona.json');
    const outDir = path.join(process.cwd(), 'dist', slug);
    const repoName = `${slug}-archive`;

    // ── Step 1: Init persona config ─────────────────────────
    console.log(`📋 Step 1/6 — Initializing persona...`);
    if (!fs.existsSync(configPath)) {
      ensureDir(personaDir);
      const config = buildDefaultConfig(name, slug, outDir);
      writeJson(configPath, config);
      console.log(`   Created: ${configPath}`);
    } else {
      console.log(`   Using existing: ${configPath}`);
    }
    const config = readPersonaConfig(configPath);
    config.outputDir = outDir;

    // ── Step 2: Collect articles ─────────────────────────────
    let articles;
    if (opts.load) {
      console.log(`\n📰 Step 2/6 — Loading articles from file...`);
      articles = readJson(opts.load);
      console.log(`   Loaded ${articles.length} articles from ${opts.load}`);
    } else {
      console.log(`\n📰 Step 2/6 — Collecting articles (standard pass)...`);
      articles = await collectAll(config);
      console.log(`   Standard collection: ${articles.length} articles`);
    }

    // ── Step 2b: Deep Crawl (optional) ───────────────────────
    if (opts.deep) {
      console.log(`\n🔭 Step 2b/6 — Deep crawl (7 strategies)...`);
      articles = await deepCrawl(config, articles);
      console.log(`   After deep crawl: ${articles.length} articles`);
    }

    // ── Step 2c: Enrich metadata ─────────────────────────────
    if (opts.enrich !== false) {
      const needsEnrichment = articles.filter(a => !a.date || !a.excerpt || a.excerpt.length < 40);
      if (needsEnrichment.length > 0) {
        console.log(`\n🔬 Step 2c/6 — Enriching metadata for ${needsEnrichment.length} articles...`);
        await enrichArticles(articles, name);
      } else {
        console.log(`\n✅ Step 2c/6 — All articles have metadata, skipping enrichment`);
      }
    }

    writeJson(path.join(personaDir, 'articles.json'), articles);
    console.log(`\n   ✅ ${articles.length} articles ready`);
    console.log(`      With dates:     ${articles.filter(a => a.date).length}`);
    console.log(`      With summaries: ${articles.filter(a => a.excerpt && a.excerpt.length > 20).length}`);

    // ── Step 3: Build static site ────────────────────────────
    console.log(`\n🏗  Step 3/6 — Building site...`);
    generateSite({ config, articles, outDir });
    console.log(`   ✅ Site built → ${outDir}/index.html`);

    // ── Step 4: GitHub repo ──────────────────────────────────
    let repoUrl = null;
    if (opts.github !== false) {
      if (!githubToken) {
        console.warn(`\n⚠️  Step 4/6 — Skipping GitHub (no GITHUB_TOKEN set)`);
      } else {
        console.log(`\n🐙 Step 4/6 — Creating GitHub repo...`);
        try {
          const ghUser = await getGitHubUser(githubToken);
          const repo = await createRepo(githubToken, {
            repoName,
            description: `Article archive for ${name} — generated by PersonArchive`,
            isPrivate: opts.private || false
          });
          repoUrl = repo.html_url;
          await pushDirToRepo(githubToken, {
            owner: ghUser,
            repoName,
            dirPath: outDir,
            message: `feat: generate archive for ${name}`,
            branch: 'main'
          });
          console.log(`   ✅ GitHub: ${repoUrl}`);
        } catch (err) {
          console.error(`   ❌ GitHub failed: ${err.message}`);
        }
      }
    }

    // ── Step 5: Cloudflare Pages deploy ──────────────────────
    let deployUrl = null;
    if (opts.deploy !== false) {
      if (!cfToken || !cfAccountId) {
        console.warn(`\n⚠️  Step 5/6 — Skipping Cloudflare deploy (no CF_TOKEN or CF_ACCOUNT_ID set)`);
      } else {
        console.log(`\n☁️  Step 5/6 — Deploying to Cloudflare Pages...`);
        try {
          deployUrl = await fullDeploy(cfToken, cfAccountId, repoName, outDir);
          console.log(`   ✅ Live: ${deployUrl}`);
        } catch (err) {
          console.error(`   ❌ Cloudflare deploy failed: ${err.message}`);
          deployUrl = `https://${repoName}.pages.dev (deploy may have failed — check CF dashboard)`;
        }
      }
    }

    // ── Summary ──────────────────────────────────────────────
    printSummary({ name, articles, outDir, repoUrl, deployUrl });
    return { articles, outDir, repoUrl, deployUrl };
  });

// ─────────────────────────────────────────────────────────────
// DEEP-COLLECT — standalone deep crawl command
//
// Runs all 7 strategies for maximum article coverage.
// Optionally merges with an existing articles.json.
// Can rebuild + redeploy after crawling.
//
// Usage:
//   node src/index.js deep-collect "Shiv Visvanathan"
//   node src/index.js deep-collect "Shiv Visvanathan" --rebuild --deploy
//   node src/index.js deep-collect "Shiv Visvanathan" --strategies rss,wayback,ddg
// ─────────────────────────────────────────────────────────────
program
  .command('deep-collect <name>')
  .description('Maximum-coverage article discovery: runs 7 parallel crawl strategies')
  .option('--strategies <list>', 'Comma-separated list of strategies to run (rss,wayback,ddg,sitemap,paginate,muckrack,scholar). Default: all', 'all')
  .option('--merge', 'Merge results with existing personas/<name>/articles.json (default: true)', true)
  .option('--no-merge', 'Replace existing articles instead of merging')
  .option('--rebuild', 'Rebuild the static site after deep crawl')
  .option('--deploy', 'Rebuild and redeploy to Cloudflare Pages after deep crawl')
  .option('--no-enrich', 'Skip metadata enrichment after crawling')
  .option('-o, --output <file>', 'Output JSON file path (overrides default personas/<slug>/articles.json)')
  .action(async (name, opts) => {
    console.log(`\n🔭 PersonArchive Deep Crawl — "${name}"\n`);

    const slug = slugify(name);
    const personaDir = path.join(process.cwd(), 'personas', slug);
    const configPath = path.join(personaDir, 'persona.json');

    // Init persona if needed
    if (!fs.existsSync(configPath)) {
      ensureDir(personaDir);
      const config = buildDefaultConfig(name, slug, path.join(process.cwd(), 'dist', slug));
      writeJson(configPath, config);
      console.log(`   Created persona config: ${configPath}`);
    }

    const config = readPersonaConfig(configPath);
    const outDir = config.outputDir || path.join(process.cwd(), 'dist', slug);
    const articlesPath = opts.output || path.join(personaDir, 'articles.json');

    // Load existing articles for merge
    let existingArticles = [];
    if (opts.merge && fs.existsSync(articlesPath)) {
      existingArticles = readJson(articlesPath);
      console.log(`   Loaded ${existingArticles.length} existing articles to merge with`);
    }

    // Parse strategy filter
    const selectedStrategies = opts.strategies === 'all' ? null : opts.strategies.split(',').map(s => s.trim());
    if (selectedStrategies) {
      console.log(`   Strategies: ${selectedStrategies.join(', ')}`);
    } else {
      console.log(`   Strategies: all 7 (RSS, Wayback CDX, DDG Deep Blast, Sitemaps, Paginated Scrape, Muck Rack, Scholar)`);
    }

    // Run deep crawl (with strategy filter injected into config)
    const crawlConfig = { ...config, _deepCrawlStrategies: selectedStrategies };
    const articles = await deepCrawl(crawlConfig, existingArticles);

    // Enrich metadata
    if (opts.enrich !== false) {
      const needsEnrichment = articles.filter(a => !a.date || !a.excerpt || a.excerpt.length < 40);
      if (needsEnrichment.length > 0) {
        console.log(`\n🔬 Enriching metadata for ${needsEnrichment.length} articles...`);
        await enrichArticles(articles, name);
      }
    }

    // Save results
    ensureDir(path.dirname(articlesPath));
    writeJson(articlesPath, articles);

    // Print breakdown by source
    printSourceBreakdown(articles, existingArticles.length);

    // Optionally rebuild
    if (opts.rebuild || opts.deploy) {
      console.log(`\n🏗  Rebuilding site...`);
      generateSite({ config, articles, outDir });
      console.log(`   ✅ Site built → ${outDir}/index.html`);
    }

    // Optionally deploy
    if (opts.deploy) {
      const cfToken = process.env.CF_TOKEN;
      const cfAccountId = process.env.CF_ACCOUNT_ID;
      if (!cfToken || !cfAccountId) {
        console.warn(`\n⚠️  No CF_TOKEN or CF_ACCOUNT_ID — skipping deploy`);
      } else {
        const repoName = `${slug}-archive`;
        console.log(`\n☁️  Deploying to Cloudflare Pages...`);
        try {
          const deployUrl = await fullDeploy(cfToken, cfAccountId, repoName, outDir);
          console.log(`   ✅ Live: ${deployUrl}`);
        } catch (err) {
          console.error(`   ❌ Deploy failed: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Deep crawl complete — ${articles.length} total articles saved to ${articlesPath}`);
    return articles;
  });

// ─────────────────────────────────────────────
// ENRICH — standalone metadata enrichment pass
// ─────────────────────────────────────────────
program
  .command('enrich <personaDir>')
  .description('Enrich article metadata (dates + summaries) via Open Graph + DuckDuckGo')
  .option('-a, --articles <file>', 'Articles JSON file path', 'articles.json')
  .option('--rebuild', 'Rebuild the static site after enrichment')
  .option('--deploy', 'Rebuild and redeploy to Cloudflare Pages after enrichment')
  .action(async (personaDir, opts) => {
    const configPath = path.join(personaDir, 'persona.json');
    const config = readPersonaConfig(configPath);
    const articlesPath = path.join(personaDir, opts.articles);
    const outDir = config.outputDir || path.join(process.cwd(), 'dist', config.slug);

    if (!fs.existsSync(articlesPath)) {
      console.error(`❌ Articles file not found: ${articlesPath}`);
      process.exit(1);
    }

    const articles = readJson(articlesPath);
    const before = {
      total: articles.length,
      withDates: articles.filter(a => a.date).length,
      withExcerpts: articles.filter(a => a.excerpt && a.excerpt.length > 20).length
    };

    console.log(`\n🔬 Enriching "${config.name}" articles...`);
    console.log(`   Before: ${before.total} total | ${before.withDates} dates | ${before.withExcerpts} excerpts\n`);

    await enrichArticles(articles, config.name);

    const after = {
      withDates: articles.filter(a => a.date).length,
      withExcerpts: articles.filter(a => a.excerpt && a.excerpt.length > 20).length
    };

    writeJson(articlesPath, articles);

    console.log(`\n✅ Enrichment complete`);
    console.log(`   Dates:    ${before.withDates} → ${after.withDates} (+${after.withDates - before.withDates})`);
    console.log(`   Excerpts: ${before.withExcerpts} → ${after.withExcerpts} (+${after.withExcerpts - before.withExcerpts})`);
    console.log(`   Saved → ${articlesPath}`);

    if (opts.rebuild || opts.deploy) {
      console.log(`\n🏗  Rebuilding site...`);
      generateSite({ config, articles, outDir });
      console.log(`   ✅ Site built → ${outDir}/index.html`);
    }

    if (opts.deploy) {
      const cfToken = process.env.CF_TOKEN;
      const cfAccountId = process.env.CF_ACCOUNT_ID;
      if (!cfToken || !cfAccountId) {
        console.warn(`⚠️  No CF_TOKEN or CF_ACCOUNT_ID set — skipping deploy`);
      } else {
        const repoName = `${config.slug}-archive`;
        console.log(`\n☁️  Deploying to Cloudflare Pages...`);
        try {
          const deployUrl = await fullDeploy(cfToken, cfAccountId, repoName, outDir);
          console.log(`   ✅ Live: ${deployUrl}`);
        } catch (err) {
          console.error(`   ❌ Deploy failed: ${err.message}`);
        }
      }
    }
  });

// ─────────────────────────────────────────────
// INIT — scaffold a new persona config
// ─────────────────────────────────────────────
program
  .command('init <name>')
  .description('Initialize a new persona config directory')
  .action(async (name) => {
    const slug = slugify(name);
    const configDir = path.join(process.cwd(), 'personas', slug);
    ensureDir(configDir);
    const config = buildDefaultConfig(name, slug, `dist/${slug}`);
    const configPath = path.join(configDir, 'persona.json');
    writeJson(configPath, config);
    console.log(`✅ Initialized persona config at ${configPath}`);
    console.log(`\nNext: edit ${configPath} then run:`);
    console.log(`  node src/index.js generate "${name}"`);
    console.log(`  node src/index.js generate "${name}" --deep  # for maximum coverage`);
  });

// ─────────────────────────────────────────────
// COLLECT — standard article collection
// ─────────────────────────────────────────────
program
  .command('collect <personaDir>')
  .description('Collect articles from all configured publications')
  .option('-o, --output <file>', 'Output JSON file', 'articles.json')
  .option('--merge', 'Merge with existing articles.json')
  .action(async (personaDir, opts) => {
    const configPath = path.join(personaDir, 'persona.json');
    const config = readPersonaConfig(configPath);
    console.log(`🔍 Collecting articles for ${config.name}...`);
    let articles = await collectAll(config);

    if (opts.merge) {
      const outPath = path.join(personaDir, opts.output);
      if (fs.existsSync(outPath)) {
        const existing = readJson(outPath);
        const existingUrls = new Set(existing.map(a => a.url));
        const newOnly = articles.filter(a => !existingUrls.has(a.url));
        articles = [...existing, ...newOnly];
        console.log(`  Merged: ${newOnly.length} new + ${existing.length} existing = ${articles.length} total`);
      }
    }

    const outPath = path.join(personaDir, opts.output);
    writeJson(outPath, articles);
    console.log(`✅ Collected ${articles.length} articles → ${outPath}`);
  });

// ─────────────────────────────────────────────
// BUILD — generate static site
// ─────────────────────────────────────────────
program
  .command('build <personaDir>')
  .description('Build the static archive site from collected articles')
  .option('-a, --articles <file>', 'Articles JSON file', 'articles.json')
  .action(async (personaDir, opts) => {
    const configPath = path.join(personaDir, 'persona.json');
    const config = readPersonaConfig(configPath);
    const articlesPath = path.join(personaDir, opts.articles);
    const articles = readJson(articlesPath);
    const outDir = config.outputDir || path.join(process.cwd(), 'dist', config.slug);
    console.log(`🏗  Building site for ${config.name} (${articles.length} articles)...`);
    generateSite({ config, articles, outDir });
    console.log(`✅ Site built → ${outDir}/index.html`);
  });

// ─────────────────────────────────────────────
// SERVE — local preview server
// ─────────────────────────────────────────────
program
  .command('serve <distDir>')
  .description('Serve a built site locally for preview')
  .option('-p, --port <number>', 'Port to serve on', '3000')
  .action(async (distDir, opts) => {
    const { createServer } = await import('http');
    const mime = {
      '.html': 'text/html',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.ico': 'image/x-icon'
    };
    const server = createServer((req, res) => {
      let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);
      const ext = path.extname(filePath);
      try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(parseInt(opts.port), () => {
      console.log(`🌐 Serving ${distDir} at http://localhost:${opts.port}`);
    });
  });

// ─────────────────────────────────────────────
// LOAD — build from an existing articles JSON
// ─────────────────────────────────────────────
program
  .command('load <personaDir> <articlesFile>')
  .description('Build a site from an externally provided articles JSON file (with auto-enrichment)')
  .option('--no-enrich', 'Skip metadata enrichment pass')
  .action(async (personaDir, articlesFile, opts) => {
    const configPath = path.join(personaDir, 'persona.json');
    const config = readPersonaConfig(configPath);
    const outDir = config.outputDir || path.join(process.cwd(), 'dist', config.slug);
    let articles = readJson(articlesFile);

    if (opts.enrich !== false) {
      const needsEnrichment = articles.filter(a => !a.date || !a.excerpt || a.excerpt.length < 40);
      if (needsEnrichment.length > 0) {
        console.log(`🔬 Enriching metadata for ${needsEnrichment.length}/${articles.length} articles...`);
        await enrichArticles(articles, config.name);
      }
    }

    writeJson(path.join(personaDir, 'articles.json'), articles);
    generateSite({ config, articles, outDir });
    console.log(`✅ Loaded ${articles.length} articles → ${outDir}/index.html`);
    console.log(`   With dates: ${articles.filter(a=>a.date).length} | With summaries: ${articles.filter(a=>a.excerpt&&a.excerpt.length>20).length}`);
  });

// ─────────────────────────────────────────────
// UPDATE — re-collect + optional deep crawl + rebuild
// ─────────────────────────────────────────────
program
  .command('update <name>')
  .description('Incrementally collect new articles and rebuild')
  .option('--deep', 'Use deep crawl for maximum coverage')
  .action(async (name, opts) => {
    const slug = slugify(name);
    const personaDir = path.join(process.cwd(), 'personas', slug);
    const configPath = path.join(personaDir, 'persona.json');
    const config = readPersonaConfig(configPath);
    const outDir = config.outputDir || path.join(process.cwd(), 'dist', slug);
    const existingPath = path.join(personaDir, 'articles.json');

    console.log(`🔄 Updating archive for ${config.name}${opts.deep ? ' (deep mode)' : ''}...`);

    // Load existing articles
    const existingArticles = fs.existsSync(existingPath) ? readJson(existingPath) : [];
    console.log(`   Existing: ${existingArticles.length} articles`);

    let articles;
    if (opts.deep) {
      articles = await deepCrawl(config, existingArticles);
    } else {
      const newArticles = await collectAll(config);
      const existingUrls = new Set(existingArticles.map(a => a.url));
      const added = newArticles.filter(a => !existingUrls.has(a.url));
      articles = [...existingArticles, ...added];
      console.log(`  ${added.length} new articles added`);
    }

    writeJson(existingPath, articles);
    generateSite({ config, articles, outDir });
    console.log(`✅ Updated! ${articles.length} articles → ${outDir}/index.html`);
  });

// ─────────────────────────────────────────────
// CONFIG — set credentials in .env
// ─────────────────────────────────────────────
program
  .command('config')
  .description('Set API credentials (saves to .env)')
  .option('--github-token <token>', 'GitHub Personal Access Token')
  .option('--cf-token <token>', 'Cloudflare API Token')
  .option('--cf-account <id>', 'Cloudflare Account ID')
  .action(async (opts) => {
    const envPath = path.join(process.cwd(), '.env');
    let env = {};

    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const [key, ...rest] = line.split('=');
        if (key?.trim()) env[key.trim()] = rest.join('=').trim();
      }
    }

    if (opts.githubToken) env['GITHUB_TOKEN'] = opts.githubToken;
    if (opts.cfToken)     env['CF_TOKEN']      = opts.cfToken;
    if (opts.cfAccount)   env['CF_ACCOUNT_ID'] = opts.cfAccount;

    const content = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(envPath, content, 'utf-8');
    console.log(`✅ Credentials saved to ${envPath}`);

    if (opts.githubToken) {
      try {
        const { getGitHubUser } = await import('./github.js');
        const user = await getGitHubUser(opts.githubToken);
        console.log(`   GitHub: authenticated as @${user}`);
      } catch (err) {
        console.error(`   GitHub: token invalid — ${err.message}`);
      }
    }
    if (opts.cfToken) {
      try {
        const { verifyToken } = await import('./cloudflare.js');
        await verifyToken(opts.cfToken);
        console.log(`   Cloudflare: token valid`);
      } catch (err) {
        console.error(`   Cloudflare: token invalid — ${err.message}`);
      }
    }
  });

program.parse(process.argv);

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildDefaultConfig(name, slug, outputDir) {
  return {
    name,
    slug,
    bio: '',
    publications: [
      { id: 'new_indian_express', authorSlug: '' },
      { id: 'the_wire', authorSlug: '' },
      { id: 'scroll_in', authorSlug: '' },
      { id: 'epw', authorSlug: '' },
      { id: 'outlook_india', authorSlug: '' },
      { id: 'muck_rack', authorSlug: name }
    ],
    searchQueries: [
      `"${name}" opinion article`,
      `"${name}" essay column`
    ],
    links: { twitter: '', linkedin: '', website: '' },
    outputDir
  };
}

function printSummary({ name, articles, outDir, repoUrl, deployUrl }) {
  const SEP = '─'.repeat(60);
  console.log(`\n${SEP}`);
  console.log(`✨ Archive ready for "${name}"`);
  console.log(`   Articles:    ${articles.length}`);
  console.log(`   With dates:  ${articles.filter(a => a.date).length}`);
  console.log(`   With summ.:  ${articles.filter(a => a.excerpt && a.excerpt.length > 20).length}`);
  console.log(`   Local:       ${outDir}/index.html`);
  if (repoUrl)   console.log(`   GitHub:      ${repoUrl}`);
  if (deployUrl) console.log(`   Live URL:    ${deployUrl}`);
  console.log(`${SEP}\n`);
}

function printSourceBreakdown(articles, existingCount) {
  const newCount = articles.length - existingCount;
  console.log(`\n📊 Results — ${articles.length} total (+${newCount} new from deep crawl)`);
  console.log(`   With dates:     ${articles.filter(a => a.date).length}`);
  console.log(`   With summaries: ${articles.filter(a => a.excerpt && a.excerpt.length > 20).length}`);

  // Break down by source
  const bySource = {};
  for (const a of articles) {
    const src = a.deepCrawlSource || a.source || 'standard';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  console.log(`\n   By source:`);
  for (const [src, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${src.padEnd(30)} ${count} articles`);
  }
}
