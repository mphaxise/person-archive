/**
 * cloudflare.js
 *
 * Cloudflare Pages deployment.
 *
 * Two variants:
 *   deployInMemory()  — accepts {path: contentString} map, no fs/execSync (Workers-safe)
 *   fullDeploy()      — accepts a distDir path, uses wrangler CLI or REST API (CLI)
 *
 * Uses native fetch (Node 18+ / Workers).
 */

const BASE = 'https://api.cloudflare.com/client/v4';

function cfHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'User-Agent':    'PersonArchive/0.1'
  };
}

// ── SHA-256 helper ────────────────────────────────────────────────────────────

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Ensure project exists ─────────────────────────────────────────────────────

export async function ensureProject(token, accountId, projectName) {
  const checkRes = await fetch(
    `${BASE}/accounts/${accountId}/pages/projects/${projectName}`,
    { headers: cfHeaders(token) }
  );
  if (checkRes.ok) {
    console.log(`   CF project "${projectName}" already exists`);
    return;
  }
  console.log(`   Creating CF Pages project "${projectName}"...`);
  const createRes = await fetch(
    `${BASE}/accounts/${accountId}/pages/projects`,
    {
      method:  'POST',
      headers: { ...cfHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: projectName, production_branch: 'main' })
    }
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create CF project: ${createRes.status} ${err}`);
  }
}

// ── In-memory deploy (Workers-safe) ──────────────────────────────────────────

/**
 * Deploy an archive to Cloudflare Pages using only in-memory file contents.
 *
 * @param {string} token       - Cloudflare API token
 * @param {string} accountId   - Cloudflare account ID
 * @param {string} projectName - Pages project name (will be created if absent)
 * @param {Object} files       - { 'index.html': '...', 'data/articles.json': '...' }
 * @returns {string}           - Live URL
 */
export async function deployInMemory(token, accountId, projectName, files) {
  await ensureProject(token, accountId, projectName);

  // Build manifest: { '/path': sha256 }
  const manifest  = {};
  const hashToContent = {};

  for (const [filePath, content] of Object.entries(files)) {
    const key  = '/' + filePath.replace(/\\/g, '/').replace(/^\//, '');
    const hash = await sha256Hex(content);
    manifest[key]         = hash;
    hashToContent[hash]   = { content, filePath };
  }

  // Step 1: Create deployment with manifest
  const deployRes = await fetch(
    `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method:  'POST',
      headers: { ...cfHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ manifest })
    }
  );

  if (!deployRes.ok) {
    const err = await deployRes.text();
    throw new Error(`CF deploy init failed: ${deployRes.status} ${err}`);
  }

  const deployData   = await deployRes.json();
  const deploymentId = deployData.result?.id;
  if (!deploymentId) throw new Error('No deployment ID returned from CF');

  console.log(`   CF deployment created: ${deploymentId}`);

  // Step 2: Upload required files
  const required = deployData.result?.required_hash_list || Object.keys(hashToContent);
  for (const hash of required) {
    const entry = hashToContent[hash];
    if (!entry) continue;

    const mime = getMimeType(entry.filePath);
    const uploadRes = await fetch(
      `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/files/${hash}`,
      {
        method:  'PUT',
        headers: { ...cfHeaders(token), 'Content-Type': mime },
        body:    entry.content
      }
    );
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.warn(`   Warning: upload failed for ${entry.filePath}: ${err}`);
    }
  }

  // Step 3: Mark complete
  await fetch(
    `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
    {
      method:  'PATCH',
      headers: { ...cfHeaders(token), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'complete' })
    }
  );

  return deployData.result?.url || `https://${projectName}.pages.dev`;
}

// ── Disk-based deploy (CLI only) ──────────────────────────────────────────────

/**
 * Full deploy from a local dist directory.
 * Tries wrangler CLI first, falls back to REST API.
 */
export async function fullDeploy(token, accountId, projectName, distDir) {
  const { execSync }    = await import('child_process');
  const { default: fs } = await import('fs');
  const { default: path } = await import('path');

  await ensureProject(token, accountId, projectName);
  const liveUrl = `https://${projectName}.pages.dev`;

  // Try wrangler
  try {
    execSync('npx wrangler --version', { stdio: 'pipe' });
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId };
    console.log(`   Deploying via wrangler from ${distDir}...`);
    execSync(
      `npx wrangler pages deploy "${distDir}" --project-name "${projectName}" --commit-message "PersonArchive deploy"`,
      { env, stdio: 'inherit' }
    );
    return liveUrl;
  } catch (e) {
    console.log(`   wrangler unavailable (${e.message?.slice(0, 60)}), using REST API...`);
  }

  // Fallback: load files from disk and use in-memory deploy
  const diskFiles = {};
  const allFiles  = collectFilesFromDisk(distDir, distDir, fs, path);
  for (const { relativePath, absolutePath } of allFiles) {
    diskFiles[relativePath] = fs.readFileSync(absolutePath, 'utf-8');
  }
  return await deployInMemory(token, accountId, projectName, diskFiles);
}

function collectFilesFromDisk(baseDir, currentDir, fs, path) {
  const results = [];
  const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.env']);
  for (const entry of fs.readdirSync(currentDir)) {
    if (SKIP.has(entry)) continue;
    const absPath = path.join(currentDir, entry);
    const relPath = path.relative(baseDir, absPath);
    if (fs.statSync(absPath).isDirectory()) {
      results.push(...collectFilesFromDisk(baseDir, absPath, fs, path));
    } else {
      results.push({ relativePath: relPath, absolutePath: absPath });
    }
  }
  return results;
}

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', css: 'text/css', js: 'application/javascript',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', ico: 'image/x-icon', woff2: 'font/woff2',
    woff: 'font/woff', ttf: 'font/ttf'
  };
  return map[ext] || 'application/octet-stream';
}
