# Cozy Studio landing page

This folder builds the public page at <https://gvastethecreator.github.io/cozy-studio/>. It does not ship with the app.

- `site.yaml` holds the words, links, and pictures.
- `template.yaml` holds colours, type, and layout.
- `assets/` holds the images, the mascot drawing, and the provider logos.
- `kit/`, `src/`, `templates/`, and `scripts/` are the page engine, copied from gh-pages-template.

The walkthrough screenshots show the running Studio interface, captured on 2026-10-08 at 1280 × 720 in dark and light themes. Keep the images, alt text and step markers in `site.yaml` together when refreshing them. The first step reuses the main Create image.

## Build

You need Bun and Node 22.22 or newer.

```bash
cd landing
bun install
bun run build:local   # dist-local/, for http://localhost:<port>/
bun run build         # dist/, for GitHub Pages under /cozy-studio/
```

`.github/workflows/pages.yml` runs `bun run build` and deploys `dist/` when a push to `main` changes this folder.

In the repository's Pages settings, use GitHub Actions as the source and leave Custom domain empty. The production build uses `/cozy-studio/` for assets and links; `build:local` uses `/` for local preview.

Install the locked dependencies before building. The build prepares the VGPU shaders and bundles Pretext from those installed versions. A failed bundle stops the build instead of shipping an older vendor copy.

## Structured data

The root page builds one JSON-LD graph in `src/core/structured-data.ts`. It links WebSite, WebPage, SoftwareApplication and the FAQ rendered from `site.yaml`. The root suppresses the engine's separate FAQ script to avoid duplicate entities. Keep the local root-page and layout integration when updating the copied engine.

The application is free; provider accounts can have their own costs and limits. Do not add ratings or reviews unless they exist on the page. Schema.org validation and [Google's software-app rich-result checks](https://developers.google.com/search/docs/appearance/structured-data/software-app) are separate. Keep any missing-review recommendation visible instead of inventing reviews. [FAQ rich results are restricted to eligible government and health sites](https://developers.google.com/search/docs/appearance/structured-data/faqpage).

## Deploy to Cloudflare

The landing also runs at <https://cozy.gvaste.dev/> on the `cozy-studio-site` Worker. GitHub Pages remains the primary site and canonical URL.

With Wrangler signed in to the account in `wrangler.jsonc`, run from this folder:

```bash
bun run deploy:cloudflare
```

This builds `dist-astro/` with `/` as the base path and deploys it to the existing custom domain. It does not change the GitHub Pages build or its domain settings. Wrangler is pinned in this folder's dependencies.

## Update the engine

Change the engine in a gh-pages-template clone, where its tests live. Then copy it here:

```bash
node scripts/sync-engine.mjs ../../gh-pages-template
```

The copy leaves out the template's Studio editor, playground, and examples. `astro.config.mjs` is local to this folder and has no React integration.
