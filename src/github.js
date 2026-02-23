/**
 * github.js
 *
 * GitHub REST API utilities for PersonArchive.
 *
 * Two variants:
 *   pushFilesInMemory() — accepts {path: contentString} map (Workers-safe)
 *   pushDirToRepo()     — reads from local directory (CLI)
 *
 * Uses native fetch (Node 18+ / Workers).
 */

const BASE = 'https://api.github.com';

function ghHeaders(token) {
  return {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
    'User-Agent':           'PersonArchive/0.1'
  };
}

// ── Auth / user ───────────────────────────────────────────────────────────────

export async function getGitHubUser(token) {
  const res = await fetch(`${BASE}/user`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).login;
}

// ── Repo creation ─────────────────────────────────────────────────────────────

export async function createRepo(token, { repoName, description = '', isPrivate = false }) {
  const owner    = await getGitHubUser(token);
  const checkRes = await fetch(`${BASE}/repos/${owner}/${repoName}`, { headers: ghHeaders(token) });
  if (checkRes.ok) {
    console.log(`   GitHub repo ${owner}/${repoName} already exists — reusing`);
    return await checkRes.json();
  }
  const res = await fetch(`${BASE}/user/repos`, {
    method:  'POST',
    headers: ghHeaders(token),
    body:    JSON.stringify({ name: repoName, description, private: isPrivate, auto_init: true, has_issues: false, has_projects: false, has_wiki: false })
  });
  if (!res.ok) throw new Error(`Failed to create repo: ${res.status} ${await res.text()}`);
  const repo = await res.json();
  await delay(1500); // wait for auto_init
  return repo;
}

// ── Shared Git tree push logic ────────────────────────────────────────────────

async function pushFileMap(token, { owner, repoName, files, message = 'chore: update archive', branch = 'main' }) {
  // 1. Get current HEAD
  const refRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs/heads/${branch}`, { headers: ghHeaders(token) });
  let parentSha = null, baseTreeSha = null;
  if (refRes.ok) {
    const ref = await refRes.json();
    parentSha = ref.object?.sha;
    if (parentSha) {
      const commitRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/commits/${parentSha}`, { headers: ghHeaders(token) });
      if (commitRes.ok) baseTreeSha = (await commitRes.json()).tree?.sha;
    }
  }

  // 2. Create blobs
  const treeItems = await Promise.all(
    Object.entries(files).map(async ([filePath, content]) => {
      const blobRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/blobs`, {
        method:  'POST',
        headers: ghHeaders(token),
        body:    JSON.stringify({ content: btoa(unescape(encodeURIComponent(content))), encoding: 'base64' })
      });
      if (!blobRes.ok) throw new Error(`Blob create failed for ${filePath}: ${await blobRes.text()}`);
      const blob = await blobRes.json();
      return { path: filePath, mode: '100644', type: 'blob', sha: blob.sha };
    })
  );

  console.log(`   Pushing ${treeItems.length} files to ${owner}/${repoName}/${branch}...`);

  // 3. Create tree
  const treeBody = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;
  const treeRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/trees`, {
    method:  'POST',
    headers: ghHeaders(token),
    body:    JSON.stringify(treeBody)
  });
  if (!treeRes.ok) throw new Error(`Tree create failed: ${await treeRes.text()}`);
  const tree = await treeRes.json();

  // 4. Create commit
  const commitBody = { message, tree: tree.sha, ...(parentSha ? { parents: [parentSha] } : {}) };
  const commitRes  = await fetch(`${BASE}/repos/${owner}/${repoName}/git/commits`, {
    method:  'POST',
    headers: ghHeaders(token),
    body:    JSON.stringify(commitBody)
  });
  if (!commitRes.ok) throw new Error(`Commit create failed: ${await commitRes.text()}`);
  const commit = await commitRes.json();

  // 5. Update ref
  const patchRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method:  'PATCH',
    headers: ghHeaders(token),
    body:    JSON.stringify({ sha: commit.sha, force: true })
  });
  if (!patchRes.ok) {
    await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs`, {
      method:  'POST',
      headers: ghHeaders(token),
      body:    JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
    });
  }
  return commit.sha;
}

// ── In-memory variant (Workers-safe) ─────────────────────────────────────────

/**
 * Push an in-memory file map to a GitHub repo.
 * @param {string} token
 * @param {{ owner: string, repoName: string, files: {[path]: string}, message?: string, branch?: string }} opts
 */
export async function pushFilesInMemory(token, { owner, repoName, files, message, branch }) {
  return pushFileMap(token, { owner, repoName, files, message, branch });
}

// ── Disk-based variant (CLI only) ─────────────────────────────────────────────

/**
 * Push all files from a local directory to a GitHub repo.
 */
export async function pushDirToRepo(token, { owner, repoName, dirPath, message = 'chore: update archive', branch = 'main' }) {
  const { default: fs }   = await import('fs');
  const { default: path } = await import('path');

  const diskFiles = {};
  for (const { relativePath, absolutePath } of collectFilesFromDisk(dirPath, dirPath, fs, path)) {
    diskFiles[relativePath] = fs.readFileSync(absolutePath, 'utf-8');
  }
  return pushFileMap(token, { owner, repoName, files: diskFiles, message, branch });
}

function collectFilesFromDisk(baseDir, currentDir, fs, path) {
  const results = [];
  const SKIP    = new Set(['.git', 'node_modules', '.DS_Store', '.env']);
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
