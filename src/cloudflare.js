/**
 * cloudflare.js
 *
 * Cloudflare Pages deployment via wrangler CLI (primary) or REST API (fallback).
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BASE = 'https://api.cloudflare.com/client/v4';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'PersonArchive/0.1'
  };
}

/**
 * Verify a Cloudflare API token is valid.
 */
export async function verifyToken(token) {
  const res = await fetch(`${BASE}/user/tokens/verify`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Token invalid: ${res.status}`);
  return await res.json();
}

/**
 * Full deploy pipeline:
 *   1. Create (or get existing) Cloudflare Pages project
 *   2. Deploy all files via wrangler pages deploy (primary) or Direct Upload API (fallback)
 *   3. Return the live URL
 */
export async function fullDeploy(token, accountId, projectName, distDir) {
  // Step 1: Ensure project exists
  await ensureProject(token, accountId, projectName);
  const liveUrl = `https://${projectName}.pages.dev`;

  // Step 2: Deploy
  console.log(`   Deploying to Cloudflare Pages: ${projectName}...`);

  // Try wrangler first (most reliable — handles manifest automatically)
  try {
    execSync('npx wrangler --version', { stdio: 'pipe' });
    return await deployWithWrangler(token, accountId, projectName, distDir, liveUrl);
  } catch (e) {
    console.log(`   wrangler not available (${e.message?.slice(0, 60)}), trying REST API...`);
  }

  // Fallback: Direct Upload via REST API with manifest
  return await deployWithApi(token, accountId, projectName, distDir, liveUrl);
}

async function ensureProject(token, accountId, projectName) {
  // Check if project exists
  const listRes = await fetch(`${BASE}/accounts/${accountId}/pages/projects/${projectName}`, {
    headers: headers(token)
  });

  if (listRes.ok) {
    console.log(`   Cloudflare Pages project "${projectName}" already exists`);
    return await listRes.json();
  }

  // Create new project
  console.log(`   Creating Cloudflare Pages project "${projectName}"...`);
  const createRes = await fetch(`${BASE}/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      production_branch: 'main'
    })
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create Cloudflare Pages project: ${createRes.status} ${err}`);
  }

  return await createRes.json();
}

async function deployWithWrangler(token, accountId, projectName, distDir, liveUrl) {
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: accountId
  };

  console.log(`   Using wrangler to deploy from ${distDir}...`);
  execSync(
    `npx wrangler pages deploy "${distDir}" --project-name "${projectName}" --commit-message "PersonArchive deploy"`,
    { env, stdio: 'inherit' }
  );
  return liveUrl;
}

/**
 * Cloudflare Pages Direct Upload via REST API.
 * Uses the two-step approach: create deployment with manifest, then upload files.
 */
async function deployWithApi(token, accountId, projectName, distDir, liveUrl) {
  const crypto = await import('crypto');
  const files = collectFiles(distDir, distDir);

  // Step A: Build manifest (path → sha256 hash)
  const manifest = {};
  const fileContents = {};

  for (const { relativePath, absolutePath } of files) {
    const content = fs.readFileSync(absolutePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    manifest['/' + relativePath.replace(/\\/g, '/')] = hash;
    fileContents[hash] = { content, relativePath, absolutePath };
  }

  // Step B: Create deployment with manifest
  const deployRes = await fetch(
    `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest })
    }
  );

  if (!deployRes.ok) {
    const err = await deployRes.text();
    throw new Error(`Cloudflare deploy init failed: ${deployRes.status} ${err}`);
  }

  const deployData = await deployRes.json();
  const deploymentId = deployData.result?.id;
  if (!deploymentId) throw new Error('No deployment ID returned');

  console.log(`   Deployment created: ${deploymentId}`);

  // Step C: Upload all required files
  const required = deployData.result?.required_hash_list || [];
  const toUpload = required.length > 0
    ? required.map(hash => fileContents[hash]).filter(Boolean)
    : Object.values(fileContents);

  for (const { content, relativePath, absolutePath } of toUpload) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const mime = getMimeType(relativePath);

    const uploadRes = await fetch(
      `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/files/${hash}`,
      {
        method: 'PUT',
        headers: { ...headers(token), 'Content-Type': mime },
        body: content
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.warn(`   Warning: Failed to upload ${relativePath}: ${err}`);
    }
  }

  // Step D: Mark deployment complete
  const completeRes = await fetch(
    `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
    {
      method: 'PATCH',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'complete' })
    }
  );

  const deployUrl = deployData.result?.url || liveUrl;
  return deployUrl;
}

function collectFiles(baseDir, currentDir) {
  const results = [];
  const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.env']);

  for (const entry of fs.readdirSync(currentDir)) {
    if (SKIP.has(entry)) continue;
    const absPath = path.join(currentDir, entry);
    const relPath = path.relative(baseDir, absPath);
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      results.push(...collectFiles(baseDir, absPath));
    } else {
      results.push({ relativePath: relPath, absolutePath: absPath });
    }
  }
  return results;
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  return map[ext] || 'application/octet-stream';
}
