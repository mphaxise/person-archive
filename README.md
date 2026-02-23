# PersonArchive

> Generate a beautiful, searchable article-archive static site from any person's public byline corpus.

Built as a generalized tool from the [Shiv Visvanathan Archive](https://shiv-archive.praneet-koppula.workers.dev/) project.


---

## Web UI

```bash
# Start the web server
npm run server
# → PersonArchive UI  →  http://localhost:3000
```

Open http://localhost:3000 in your browser:
- Enter any person's name
- Toggle discovery strategies (RSS, Deep Search, Wayback Machine, Sitemap, Pagination, Muck Rack, Academic)
- Choose whether to enrich metadata, push to GitHub, or deploy to Cloudflare Pages
- Hit **Generate Archive →** and watch the real-time build log
- Get a live pages.dev URL when it's done

---
---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Initialize a persona config
node src/index.js init "Shiv Visvanathan"

# 3. Edit the generated config
#    → personas/shiv-visvanathan/persona.json
#    Add authorSlug values for each publication, bio, links

# 4. Collect articles + build site in one step
node src/index.js generate personas/shiv-visvanathan

# 5. Preview locally
node src/index.js serve dist/shiv-visvanathan
# → Open http://localhost:3000
```

---

## Commands

| Command | Description |
|---------|-------------|
| `init <name>` | Scaffold a new persona config directory |
| `collect <dir>` | Scrape articles from all configured publications |
| `build <dir>` | Build the static site from `articles.json` |
| `generate <dir>` | Collect + build in one step |
| `serve <distDir>` | Preview locally (default port 3000) |
| `update <dir>` | Incrementally collect new articles and rebuild |
| `load <dir> <file>` | Build from an externally provided articles JSON |
| `deploy <dir>` | Deploy to Cloudflare Pages (requires `wrangler`) |

---

## Persona Config (`persona.json`)

```json
{
  "name": "Shiv Visvanathan",
  "slug": "shiv-visvanathan",
  "bio": "Political sociologist and public intellectual. Columnist, The New Indian Express.",
  "publications": [
    { "id": "new_indian_express", "authorSlug": "shiv-visvanathan" },
    { "id": "the_wire",           "authorSlug": "shiv-visvanathan" },
    { "id": "scroll_in",          "authorSlug": "shiv-visvanathan" },
    { "id": "epw",                "authorSlug": "shiv-visvanathan" },
    { "id": "outlook_india",      "authorSlug": "shiv-visvanathan" },
    { "id": "muck_rack",          "authorSlug": "shiv-visvanathan" }
  ],
  "searchQueries": ["Shiv Visvanathan opinion column"],
  "links": {
    "twitter":  "https://twitter.com/...",
    "linkedin": "https://linkedin.com/in/...",
    "website":  "https://..."
  },
  "outputDir": "dist/shiv-visvanathan"
}
```

## Supported Publications

| ID | Publication | Collection Method |
|----|-------------|-------------------|
| `new_indian_express` | The New Indian Express | Author page pagination |
| `the_wire` | The Wire | Paginated author archive |
| `scroll_in` | Scroll.in | Author page |
| `epw` | Economic and Political Weekly | Author listing |
| `outlook_india` | Outlook India | Author archive |
| `muck_rack` | Muck Rack | Cross-publication aggregator |
| *(fallback)* | DuckDuckGo | Site-search discovery |

---

## Loading Manually Curated Data

If you already have articles from another source (e.g., scraped data, exported bibliography), use `load`:

```bash
# Build directly from a pre-existing articles JSON
node src/index.js load personas/shiv-visvanathan /path/to/my-articles.json
```

The articles JSON should match this schema:
```json
[
  {
    "title": "Article Title",
    "url": "https://...",
    "date": "2024-01-15",
    "publication": "Source Name",
    "author": "Author Name",
    "summary": "Optional excerpt or description.",
    "tags": []
  }
]
```

---

## Deployment

### Cloudflare Pages (recommended)

**Dashboard build settings:**

| Setting | Value |
|---------|-------|
| Build command | `npm run pages:build` |
| Build output directory | `public` |
| Deploy command | *(leave empty)* |

**Required secrets** (Settings → Environment Variables → add as encrypted):
- `GITHUB_TOKEN` — Personal access token with `repo` scope
- `CF_TOKEN` — Cloudflare API token with "Edit Cloudflare Workers" permissions
- `CF_ACCOUNT_ID` — Your Cloudflare account ID (right sidebar on dash.cloudflare.com)


```bash
# Install and login to wrangler
npm install -g wrangler
wrangler login

# Deploy (builds first if needed)
node src/index.js deploy personas/shiv-visvanathan --build --project my-archive
```

The site deploys to: `https://my-archive.pages.dev`

### Static hosting (Netlify, Vercel, GitHub Pages)

The output is a single self-contained `index.html` — drop it anywhere that serves static files. No build step needed on the host.

---

## Output Structure

```
dist/<slug>/
├── index.html       ← Self-contained static site (Fuse.js search bundled inline)
└── data/
    └── articles.json ← Raw article data (for external use)
```

---

## Site Features

- **Full-text search** via Fuse.js (title, summary, publication)
- **Filter by publication** and **year**
- **Article stats**: total count, source count, active year range
- **Dark-mode design**, mobile-responsive
- **No external runtime dependencies** — works offline after load
- Opens articles directly in a new tab

---

## Project Structure

```
person-archive/
├── src/
│   ├── index.js               ← CLI entry point
│   ├── utils.js               ← Shared utilities (fetch, dedupe, normalize)
│   ├── collectors/
│   │   ├── index.js           ← Dispatcher
│   │   ├── new_indian_express.js
│   │   ├── the_wire.js
│   │   ├── scroll_in.js
│   │   ├── epw.js
│   │   ├── outlook_india.js
│   │   ├── muck_rack.js
│   │   └── search.js          ← DuckDuckGo fallback
│   └── generator/
│       └── index.js           ← HTML template injection
├── templates/
│   └── index.html             ← Site template with placeholders
├── personas/
│   └── <slug>/
│       ├── persona.json       ← Config
│       └── articles.json      ← Collected data (generated)
└── dist/
    └── <slug>/
        └── index.html         ← Built site (generated)
```
