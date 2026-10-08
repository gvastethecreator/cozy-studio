# Cozy Studio landing page

This folder builds the public page at <https://gvastethecreator.github.io/cozy-studio/>. It does not ship with the app.

- `site.yaml` holds the words, links, and pictures.
- `template.yaml` holds colours, type, and layout.
- `assets/` holds the images, the mascot drawing, and the provider logos.
- `kit/`, `src/`, `templates/`, and `scripts/` are the page engine, copied from gh-pages-template.

The walkthrough screenshots show the running Studio interface, captured on 2026-10-08 at 1280 × 720 in dark and light themes. Keep the images, alt text and step markers in `site.yaml` together when refreshing them. The first step reuses the main Create image.

## Build

You need Bun and Node 22.18 or newer.

```bash
cd landing
bun install
bun run build:local   # dist-local/, for http://localhost:<port>/
bun run build         # dist/, for GitHub Pages under /cozy-studio/
```

`.github/workflows/pages.yml` runs `bun run build` and deploys `dist/` when a push to `main` changes this folder.

In the repository's Pages settings, use GitHub Actions as the source and leave Custom domain empty. The production build uses `/cozy-studio/` for assets and links; `build:local` uses `/` for local preview.

The build prints two notices that are not errors:

- `Could not resolve "vgpu"`: the shader for hero icons is not rebuilt. The build keeps the copy in `kit/vendor/`. This page does not use it.
- `Pretext is not installed`: the build keeps the copy in `kit/vendor/pretext/`.

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
