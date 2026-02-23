/**
 * functions/api/generate.js
 *
 * Cloudflare Pages Function — POST /api/generate
 *
 * Accepts { name, strategies[], options{} } — runs the full PersonArchive
 * pipeline in-memory (no child processes, no disk I/O) and streams progress
 * back via Server-Sent Events.
 *
 * Compatible with Cloudflare Pages Functions (Edge Runtime).
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { name, strategies = [], options = {} } = body;
  if (!name?.trim()) {
    return new Response(JSON.stringify({ error: 'name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── SSE stream setup ───────────────────────────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (type, message, data = null) => {
    const payload = JSON.stringify({ type, message, ...(data ? { data } : {}) });
    await writer.write(encoder.encode(`data: ${payload}\n\n`));
  };

  // Run the pipeline asynchronously so we can return the streaming response immediately
  (async () => {
    try {
      await send('log', `🚀 Starting archive for "${name}"...`);

      // ── Resolve env vars (CF env bindings or process.env fallback) ──────────
      const cfEnv = {
        GITHUB_TOKEN:  env.GITHUB_TOKEN  || '',
        CF_TOKEN:      env.CF_TOKEN      || '',
        CF_ACCOUNT_ID: env.CF_ACCOUNT_ID || '',
      };

      // ── Dynamic import of pipeline (keeps tree-shaking clean) ───────────────
      const { runPipeline } = await import('../../src/pipeline.js');

      await send('log', `📡 Running collection pipeline (strategies: ${strategies.length ? strategies.join(', ') : 'default'})...`);

      const result = await runPipeline(
        { name: name.trim(), strategies, options },
        cfEnv
      );

      await send('log', `✅ Done! ${result.articleCount} articles collected.`);

      if (result.githubUrl) {
        await send('log', `🐙 GitHub: ${result.githubUrl}`);
      }
      if (result.liveUrl) {
        await send('log', `🌐 Live: ${result.liveUrl}`);
      }
      if (!result.liveUrl && !result.githubUrl) {
        await send('log', `📄 Archive built in-memory — opening preview in new tab...`);
      }

      await send('done', 'Archive complete!', {
        articleCount: result.articleCount,
        githubUrl:    result.githubUrl || null,
        liveUrl:      result.liveUrl   || null,
        html:         result.indexHtml || null,
      });

    } catch (err) {
      await send('error', err.message || 'Pipeline failed');
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * GET /api/generate — health check
 */
export async function onRequestGet() {
  return new Response(JSON.stringify({ status: 'ok', service: 'PersonArchive API' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
