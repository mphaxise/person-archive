#!/usr/bin/env node
/**
 * deploy.js — Cloudflare Pages Direct Upload deployer
 * Implements the manifest-based upload format required by CF Pages API.
 *
 * Usage: node deploy.js <project-name> <dist-dir>
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

// Load .env
const envPath = new URL('.env', import.meta.url).pathname;
const envVars = {};
if (fs.existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) envVars[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
  });
}

const CF_TOKEN = process.env.CF_TOKEN || envVars.CF_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || envVars.CF_ACCOUNT_ID;
const projectName = process.argv[2];
const distDir = path.resolve(process.argv[3] || 'dist');

if (!projectName || !distDir) {
  console.error('Usage: node deploy.js <project-name> <dist-dir>');
  process.exit(1);
}

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function getMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream';
}

function collectFiles(dir, base = dir) {
  const files = [];
  const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const abs = path.join(dir, entry);
    if (fs.statSync(abs).isDirectory()) {
      files.push(...collectFiles(abs, base));
    } else {
      const rel = '/' + path.relative(base, abs);
      const content = fs.readFileSync(abs);
      files.push({ rel, abs, content, hash: sha256(content), mime: getMime(abs) });
    }
  }
  return files;
}

function buildMultipart(fields, boundary) {
  const parts = [];
  for (const { name, value, filename, mime, isBuffer } of fields) {
    if (filename) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'));
      parts.push(isBuffer ? value : Buffer.from(value, 'utf8'));
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`, 'utf8'));
    }
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(parts);
}

async function cfApi(method, urlPath, body, contentType) {
  const opts = {
    hostname: 'api.cloudflare.com',
    path: urlPath,
    method,
    headers: {
      'Authorization': `Bearer ${CF_TOKEN}`,
      'User-Agent': 'PersonArchive/0.1',
    }
  };
  if (contentType) opts.headers['Content-Type'] = contentType;
  if (body) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    opts.headers['Content-Length'] = buf.length;
    return httpsReq(opts, buf);
  }
  return httpsReq(opts);
}

async function ensureProject(name) {
  const check = await cfApi('GET', `/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${name}`);
  if (check.status === 200 && check.body.success) {
    console.log(`   ✅ Project "${name}" already exists`);
    return;
  }
  console.log(`   Creating new project "${name}"...`);
  const create = await cfApi('POST', `/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
    JSON.stringify({ name, production_branch: 'main' }), 'application/json');
  if (!create.body.success) {
    throw new Error(`Failed to create project: ${JSON.stringify(create.body.errors)}`);
  }
  console.log(`   ✅ Created project "${name}"`);
}

async function main() {
  console.log(`\n🚀 PersonArchive → Cloudflare Pages`);
  console.log(`   Project : ${projectName}`);
  console.log(`   Source  : ${distDir}\n`);

  // 1. Ensure project exists
  console.log('1️⃣  Ensuring Pages project exists...');
  await ensureProject(projectName);

  // 2. Collect files + compute hashes
  console.log('\n2️⃣  Collecting files...');
  const files = collectFiles(distDir);
  console.log(`   Found ${files.length} file(s)`);
  files.forEach(f => console.log(`   ${f.rel}  (${f.hash.slice(0,8)}…)`));

  // 3. Build manifest: { "/path": "hash" }
  const manifest = {};
  for (const f of files) manifest[f.rel] = f.hash;

  // 4. Build multipart with manifest + files keyed by hash
  console.log('\n3️⃣  Building upload payload...');
  const boundary = 'PABoundary' + Date.now().toString(36);
  const fields = [
    { name: 'manifest', value: JSON.stringify(manifest) }
  ];
  for (const f of files) {
    fields.push({ name: f.hash, value: f.content, filename: f.rel, mime: f.mime, isBuffer: true });
  }
  const payload = buildMultipart(fields, boundary);
  console.log(`   Payload: ${(payload.length / 1024).toFixed(1)} KB`);

  // 5. POST deployment
  console.log('\n4️⃣  Uploading deployment...');
  const res = await cfApi(
    'POST',
    `/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${projectName}/deployments`,
    payload,
    `multipart/form-data; boundary=${boundary}`
  );

  if (res.body.success) {
    const deployUrl = res.body.result?.url || `https://${projectName}.pages.dev`;
    const prodUrl = `https://${projectName}.pages.dev`;
    console.log(`\n✅ Deployed!`);
    console.log(`   Deployment URL : ${deployUrl}`);
    console.log(`   Production URL : ${prodUrl}\n`);
    return prodUrl;
  } else {
    console.error(`\n❌ Deployment failed (HTTP ${res.status}):`);
    console.error(JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
