#!/usr/bin/env node
import express from 'express';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const app = express();
app.use(express.json());

// ── Job store ───────────────────────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, logs, result, sseClients }

function createJob(id) {
  jobs.set(id, { id, status: 'running', logs: [], result: null, sseClients: [] });
}

function pushLog(id, line) {
  const job = jobs.get(id);
  if (!job) return;
  job.logs.push(line);
  job.sseClients.forEach(res => res.write(`data: ${JSON.stringify({ type: 'log', text: line })}\n\n`));
}

function finishJob(id, result) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = result.success ? 'done' : 'error';
  job.result = result;
  job.sseClients.forEach(res => {
    res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`);
    res.end();
  });
  job.sseClients = [];
}

// ── API: start a generate job ────────────────────────────────────────────────
app.post('/api/generate', (req, res) => {
  const { name, strategies = [], options = {} } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const jobId = uuidv4();
  createJob(jobId);
  res.json({ jobId });

  // Build CLI args
  const args = ['src/index.js', 'generate', name.trim()];

  // Any deep strategy checked → enable --deep mode (runs all 7 strategies in parallel)
  const deepStrats = ['rss','wayback','ddg','sitemap','paginate','muckrack','academic'];
  const hasDeep = strategies.some(s => deepStrats.includes(s));
  if (hasDeep) {
    args.push('--deep');
  }

  if (options.noEnrich) args.push('--no-enrich');
  if (options.deploy === false) args.push('--no-deploy');
  if (options.github === false) args.push('--no-github');

  const child = spawn('node', args, { cwd: ROOT, env: process.env });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', d => {
    const lines = d.toString().split('\n').filter(Boolean);
    lines.forEach(l => { stdout += l + '\n'; pushLog(jobId, l); });
  });

  child.stderr.on('data', d => {
    const lines = d.toString().split('\n').filter(Boolean);
    lines.forEach(l => { stderr += l + '\n'; pushLog(jobId, `⚠ ${l}`); });
  });

  child.on('close', code => {
    // Try to find a pages.dev URL in logs
    const allOutput = stdout + stderr;
    const urlMatch = allOutput.match(/https?:\/\/[\w-]+\.pages\.dev[^\s]*/);
    const liveUrl = urlMatch ? urlMatch[0] : null;

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const ghUrl = `https://github.com/mphaxise/${slug}-archive`;

    finishJob(jobId, {
      success: code === 0,
      liveUrl,
      githubUrl: ghUrl,
      exitCode: code,
    });
  });
});

// ── API: SSE progress stream ─────────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).send('Not found');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay existing logs
  job.logs.forEach(line => {
    res.write(`data: ${JSON.stringify({ type: 'log', text: line })}\n\n`);
  });

  if (job.status !== 'running') {
    res.write(`data: ${JSON.stringify({ type: 'done', ...job.result })}\n\n`);
    res.end();
    return;
  }

  job.sseClients.push(res);
  req.on('close', () => {
    job.sseClients = job.sseClients.filter(c => c !== res);
  });
});

// ── Serve frontend ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(HTML);
});

// ── HTML frontend ────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PersonArchive — Generate</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d0d0f;
    --surface: #16181c;
    --border: #2a2d35;
    --accent: #6c63ff;
    --accent2: #00d4aa;
    --text: #e8e9ec;
    --muted: #7a7f8e;
    --danger: #ff5f57;
    --success: #2dd4bf;
    --warn: #f59e0b;
    --radius: 12px;
    --font: 'Inter', system-ui, -apple-system, sans-serif;
    --mono: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 20px 80px;
  }

  .hero {
    text-align: center;
    margin-bottom: 48px;
  }

  .hero h1 {
    font-size: clamp(2rem, 5vw, 3.2rem);
    font-weight: 700;
    letter-spacing: -0.03em;
    background: linear-gradient(135deg, #fff 0%, #a8a0ff 60%, var(--accent2) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero p {
    margin-top: 12px;
    color: var(--muted);
    font-size: 1rem;
    max-width: 480px;
    line-height: 1.6;
  }

  .card {
    width: 100%;
    max-width: 680px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px;
  }

  .field-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 10px;
  }

  .name-input {
    width: 100%;
    background: var(--bg);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 1.15rem;
    font-family: var(--font);
    padding: 14px 18px;
    outline: none;
    transition: border-color 0.2s;
  }
  .name-input::placeholder { color: var(--muted); }
  .name-input:focus { border-color: var(--accent); }

  .section-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 28px 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .strategies-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 10px;
  }

  .strategy-chip {
    position: relative;
    cursor: pointer;
  }

  .strategy-chip input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .strategy-chip label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    background: var(--bg);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .strategy-chip label .chip-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }

  .strategy-chip label .chip-desc {
    font-size: 0.72rem;
    color: var(--muted);
    line-height: 1.4;
  }

  .strategy-chip input:checked + label {
    border-color: var(--accent);
    background: rgba(108, 99, 255, 0.08);
  }

  .strategy-chip input:checked + label .chip-name {
    color: #a8a0ff;
  }

  .options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }

  .toggle-chip {
    position: relative;
  }

  .toggle-chip input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-chip label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    background: var(--bg);
    border: 1.5px solid var(--border);
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--muted);
    transition: all 0.2s;
  }

  .toggle-chip input:checked + label {
    border-color: var(--accent2);
    color: var(--accent2);
    background: rgba(0, 212, 170, 0.07);
  }

  .submit-btn {
    width: 100%;
    margin-top: 28px;
    padding: 15px;
    background: linear-gradient(135deg, var(--accent), #8b7aff);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
  }

  .submit-btn:hover { opacity: 0.9; }
  .submit-btn:active { transform: scale(0.99); }
  .submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Progress panel ── */
  #progress-panel {
    width: 100%;
    max-width: 680px;
    margin-top: 20px;
    display: none;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .status-badge.running { background: rgba(108,99,255,0.15); color: #a8a0ff; }
  .status-badge.done { background: rgba(45,212,191,0.15); color: var(--success); }
  .status-badge.error { background: rgba(255,95,87,0.12); color: var(--danger); }

  .pulse {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  .log-box {
    background: #0a0b0d;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 18px;
    height: 300px;
    overflow-y: auto;
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.6;
    color: #9ba3b2;
    scroll-behavior: smooth;
  }

  .log-box .log-line { display: block; }
  .log-box .log-line.warn { color: var(--warn); }
  .log-box .log-line.success { color: var(--success); }
  .log-box .log-line.error { color: var(--danger); }

  .result-card {
    margin-top: 16px;
    padding: 20px 24px;
    background: rgba(45,212,191,0.06);
    border: 1.5px solid rgba(45,212,191,0.25);
    border-radius: var(--radius);
    display: none;
  }

  .result-card h3 {
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--success);
    margin-bottom: 16px;
  }

  .result-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .result-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: 7px;
    font-size: 0.84rem;
    font-weight: 600;
    text-decoration: none;
    transition: opacity 0.2s;
  }
  .result-link:hover { opacity: 0.8; }

  .result-link.live {
    background: var(--accent);
    color: #fff;
  }

  .result-link.github {
    background: #21262d;
    border: 1px solid #30363d;
    color: var(--text);
  }

  .error-card {
    margin-top: 16px;
    padding: 16px 20px;
    background: rgba(255,95,87,0.07);
    border: 1.5px solid rgba(255,95,87,0.2);
    border-radius: var(--radius);
    color: var(--danger);
    font-size: 0.85rem;
    display: none;
  }

  /* mobile */
  @media (max-width: 480px) {
    .card { padding: 24px 18px; }
    .strategies-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>

<div class="hero">
  <h1>PersonArchive</h1>
  <p>Enter a person's name, choose your discovery strategies, and get a fully compiled article archive — live in minutes.</p>
</div>

<div class="card">
  <p class="field-label">Person's name</p>
  <input
    class="name-input"
    type="text"
    id="nameInput"
    placeholder="e.g. Shiv Visvanathan, Arundhati Roy, David Brooks…"
    autofocus
  />

  <p class="section-title">Discovery strategies</p>
  <div class="strategies-grid">
    <div class="strategy-chip">
      <input type="checkbox" id="s-rss" name="rss" checked>
      <label for="s-rss">
        <span class="chip-name">📡 RSS / Atom</span>
        <span class="chip-desc">Author feeds from known publications</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-ddg" name="ddg" checked>
      <label for="s-ddg">
        <span class="chip-name">🔍 Deep search</span>
        <span class="chip-desc">30+ DuckDuckGo queries by year & topic</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-wayback" name="wayback">
      <label for="s-wayback">
        <span class="chip-name">🕰 Wayback Machine</span>
        <span class="chip-desc">Internet Archive CDX time-travel</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-sitemap" name="sitemap">
      <label for="s-sitemap">
        <span class="chip-name">🗺 Sitemap mining</span>
        <span class="chip-desc">Publication sitemap.xml author filter</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-paginate" name="paginate">
      <label for="s-paginate">
        <span class="chip-name">📄 Paginated scrape</span>
        <span class="chip-desc">Exhaustive author page / 1..N walk</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-muckrack" name="muckrack">
      <label for="s-muckrack">
        <span class="chip-name">📰 Muck Rack</span>
        <span class="chip-desc">Journalist database deep profile</span>
      </label>
    </div>
    <div class="strategy-chip">
      <input type="checkbox" id="s-academic" name="academic">
      <label for="s-academic">
        <span class="chip-name">🎓 Academic</span>
        <span class="chip-desc">Google Scholar + Semantic Scholar</span>
      </label>
    </div>
  </div>

  <p class="section-title">Options</p>
  <div class="options-row">
    <div class="toggle-chip">
      <input type="checkbox" id="o-enrich" checked>
      <label for="o-enrich">✨ Enrich metadata</label>
    </div>
    <div class="toggle-chip">
      <input type="checkbox" id="o-github" checked>
      <label for="o-github">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        Push to GitHub
      </label>
    </div>
    <div class="toggle-chip">
      <input type="checkbox" id="o-deploy" checked>
      <label for="o-deploy">🚀 Deploy to Cloudflare</label>
    </div>
  </div>

  <button class="submit-btn" id="submitBtn" onclick="startGenerate()">
    Generate Archive →
  </button>
</div>

<!-- Progress panel -->
<div id="progress-panel">
  <div class="progress-header">
    <span id="progressTitle" style="font-weight:600; font-size:0.95rem;"></span>
    <span class="status-badge running" id="statusBadge">
      <span class="pulse"></span> Building…
    </span>
  </div>

  <div class="log-box" id="logBox"></div>

  <div class="result-card" id="resultCard">
    <h3>✅ Archive ready</h3>
    <div class="result-links" id="resultLinks"></div>
  </div>

  <div class="error-card" id="errorCard">
    Build failed. Check logs above for details.
  </div>
</div>

<script>
  function startGenerate() {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) {
      document.getElementById('nameInput').focus();
      return;
    }

    // Collect selected strategies
    const strategyIds = ['rss','ddg','wayback','sitemap','paginate','muckrack','academic'];
    const strategies = strategyIds.filter(id => document.getElementById('s-' + id).checked);

    const options = {
      enrich: document.getElementById('o-enrich').checked,
      github: document.getElementById('o-github').checked,
      deploy: document.getElementById('o-deploy').checked,
      noEnrich: !document.getElementById('o-enrich').checked,
    };

    // Disable form
    document.getElementById('submitBtn').disabled = true;

    // Show progress panel
    const panel = document.getElementById('progress-panel');
    panel.style.display = 'block';
    document.getElementById('progressTitle').textContent = 'Building archive for "' + name + '"';
    document.getElementById('logBox').innerHTML = '';
    document.getElementById('resultCard').style.display = 'none';
    document.getElementById('errorCard').style.display = 'none';
    setStatus('running');

    // Start job
    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, strategies, options }),
    })
    .then(r => r.json())
    .then(({ jobId, error }) => {
      if (error) { showError(error); return; }
      streamLogs(jobId);
    })
    .catch(e => showError(e.message));
  }

  function streamLogs(jobId) {
    const es = new EventSource('/api/status/' + jobId);
    const logBox = document.getElementById('logBox');

    es.onmessage = e => {
      const msg = JSON.parse(e.data);

      if (msg.type === 'log') {
        const line = document.createElement('span');
        line.className = 'log-line';
        const t = msg.text;
        if (t.startsWith('⚠') || t.toLowerCase().includes('warn')) line.classList.add('warn');
        if (t.toLowerCase().includes('error') || t.toLowerCase().includes('fail')) line.classList.add('error');
        if (t.includes('✅') || t.includes('deployed') || t.includes('live')) line.classList.add('success');
        line.textContent = t;
        logBox.appendChild(line);
        logBox.appendChild(document.createTextNode('\\n'));
        logBox.scrollTop = logBox.scrollHeight;
      }

      if (msg.type === 'done') {
        es.close();
        if (msg.success) {
          setStatus('done');
          showResult(msg);
        } else {
          setStatus('error');
          document.getElementById('errorCard').style.display = 'block';
        }
        document.getElementById('submitBtn').disabled = false;
      }
    };

    es.onerror = () => {
      es.close();
      setStatus('error');
      document.getElementById('submitBtn').disabled = false;
    };
  }

  function setStatus(state) {
    const badge = document.getElementById('statusBadge');
    badge.className = 'status-badge ' + state;
    const labels = { running: '⏳ Building…', done: '✅ Done', error: '❌ Failed' };
    badge.innerHTML = (state === 'running' ? '<span class="pulse"></span> ' : '') + labels[state];
  }

  function showResult(msg) {
    const card = document.getElementById('resultCard');
    const links = document.getElementById('resultLinks');
    links.innerHTML = '';

    if (msg.liveUrl) {
      const a = document.createElement('a');
      a.href = msg.liveUrl;
      a.target = '_blank';
      a.className = 'result-link live';
      a.textContent = '🌐 View live archive →';
      links.appendChild(a);
    }

    if (msg.githubUrl) {
      const a = document.createElement('a');
      a.href = msg.githubUrl;
      a.target = '_blank';
      a.className = 'result-link github';
      a.textContent = '  View on GitHub';
      links.appendChild(a);
    }

    card.style.display = 'block';
  }

  function showError(msg) {
    setStatus('error');
    const card = document.getElementById('errorCard');
    card.textContent = msg || 'Build failed. Check logs above.';
    card.style.display = 'block';
    document.getElementById('submitBtn').disabled = false;
  }

  // Allow Enter key to submit
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('nameInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') startGenerate();
    });
  });
</script>
</body>
</html>`;

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  PersonArchive UI  →  http://localhost:${PORT}\n`);
});
