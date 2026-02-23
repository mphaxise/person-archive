/**
 * github.js
 *
 * GitHub REST API utilities for PersonArchive.
 * Handles: get user, create repo, push directory contents as initial commit.
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'PersonArchive/0.1'
  };
}

/**
 * Get the authenticated user's login name.
 */
export async function getGitHubUser(token) {
  const res = await fetch(`${BASE}/user`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.login;
}

/**
 * Create a new GitHub repository under the authenticated user.
 * Returns the full repo object.
 */
export async function createRepo(token, { repoName, description = '', isPrivate = false }) {
  // Check if repo already exists
  const owner = await getGitHubUser(token);
  const checkRes = await fetch(`${BASE}/repos/${owner}/${repoName}`, { headers: headers(token) });
  if (checkRes.ok) {
    console.log(`   GitHub repo ${owner}/${repoName} already exists — reusing`);
    return await checkRes.json();
  }

  const res = await fetch(`${BASE}/user/repos`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      name: repoName,
      description,
      private: isPrivate,
      auto_init: true,
      has_issues: false,
      has_projects: false,
      has_wiki: false
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create repo: ${res.status} ${err}`);
  }
  const repo = await res.json();
  // Wait a moment for auto_init to complete
  await delay(1500);
  return repo;
}

/**
 * Push all files in a local directory to a GitHub repo via the Git Trees API.
 * This creates a single commit with all files — no local git install needed.
 */
export async function pushDirToRepo(token, { owner, repoName, dirPath, message = 'chore: update archive', branch = 'main' }) {
  // 1. Get current HEAD commit SHA
  const refRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    headers: headers(token)
  });

  let parentSha = null;
  let baseTreeSha = null;

  if (refRes.ok) {
    const ref = await refRes.json();
    parentSha = ref.object.sha;
    // Get tree SHA from that commit
    const commitRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/commits/${parentSha}`, {
      headers: headers(token)
    });
    if (commitRes.ok) {
      const commit = await commitRes.json();
      baseTreeSha = commit.tree.sha;
    }
  }

  // 2. Collect all files recursively
  const files = collectFilesRecursively(dirPath, dirPath);
  if (files.length === 0) throw new Error(`No files found in ${dirPath}`);

  console.log(`   Pushing ${files.length} files to ${owner}/${repoName}/${branch}...`);

  // 3. Create blobs for all files
  const treeItems = await Promise.all(files.map(async ({ relativePath, absolutePath }) => {
    const content = fs.readFileSync(absolutePath);
    const isText = isTextFile(relativePath);

    const blobBody = isText
      ? { content: content.toString('utf-8'), encoding: 'utf-8' }
      : { content: content.toString('base64'), encoding: 'base64' };

    const blobRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/blobs`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(blobBody)
    });
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${relativePath}: ${await blobRes.text()}`);
    const blob = await blobRes.json();

    return {
      path: relativePath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    };
  }));

  // 4. Create a tree
  const treeBody = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;

  const treeRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/trees`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(treeBody)
  });
  if (!treeRes.ok) throw new Error(`Failed to create tree: ${await treeRes.text()}`);
  const tree = await treeRes.json();

  // 5. Create a commit
  const commitBody = {
    message,
    tree: tree.sha,
    ...(parentSha ? { parents: [parentSha] } : {})
  };

  const commitRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/commits`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(commitBody)
  });
  if (!commitRes.ok) throw new Error(`Failed to create commit: ${await commitRes.text()}`);
  const commit = await commitRes.json();

  // 6. Update the ref (or create it)
  const updateRefRes = await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ sha: commit.sha, force: true })
  });

  if (!updateRefRes.ok) {
    // Ref might not exist yet — create it
    await fetch(`${BASE}/repos/${owner}/${repoName}/git/refs`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
    });
  }

  return commit.sha;
}

function collectFilesRecursively(baseDir, currentDir) {
  const results = [];
  const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.env']);

  for (const entry of fs.readdirSync(currentDir)) {
    if (SKIP.has(entry)) continue;
    const absPath = path.join(currentDir, entry);
    const relPath = path.relative(baseDir, absPath);
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      results.push(...collectFilesRecursively(baseDir, absPath));
    } else {
      results.push({ relativePath: relPath, absolutePath: absPath });
    }
  }
  return results;
}

function isTextFile(filename) {
  const textExts = new Set([
    '.html', '.css', '.js', '.json', '.md', '.txt', '.xml',
    '.svg', '.ts', '.jsx', '.tsx', '.yaml', '.yml', '.toml', '.sh'
  ]);
  return textExts.has(path.extname(filename).toLowerCase());
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
