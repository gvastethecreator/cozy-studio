# ADR 0011: Declarative extensions and style pack sources

## Status

Accepted

## Decision

Cozy Extensions are installed content packages, separate from the application bundle.

- A **Cozy Extension** is a versioned content package. It contains data files and images only. It never contains code that Studio runs. This keeps the Provider Capability Catalog rule: providers are not runtime plugins.
- The first and only extension kind is `style-pack`. Other declarative kinds, such as recipes, can come later under the same rules.
- Each extension has an `extension.json` manifest. The validated schema and compatibility contract live in [extensions.ts](../../packages/shared/src/extensions.ts); use them when authoring a package.
- Extension ids use a `publisher.name` namespace. A preset's global id is `<extensionId>/<presetId>`, so two extensions can never collide.
- Studio reads extensions from **Extension Sources**. A source is either a local folder or a GitHub repository that publishes extensions as release assets. Studio supports many sources at once. Supported sources are:
  - the public `cozy-styles` repository,
  - a private repository for work in progress,
  - local folders for authoring, read in place without install.
- A private source needs a GitHub token. The token follows the Provider Secret rules. It never goes into Studio Settings, SQLite, logs or catalog metadata.
- Installing an extension verifies every sha256, then writes the whole extension in one atomic step to the extension store of the Studio install. A failed or partial download leaves the previous version in place.
- The local style admin can build one saved pack and send its data-only archive to `POST /api/extensions/install-local`. Studio validates paths, sizes, manifests, compatibility and references, reuses the installer and refreshes the backend catalog. It retains the previous folder until catalog and runtime readback checks pass, restoring it if those checks fail. The admin also reads the installed runtime back to verify its content. This authoring action needs no release and does not write to the distribution repository; the Studio frontend loads the updated catalog after reload.
- The backend lists installed extensions and serves their data. The frontend loads styles at runtime through `services/studio-api/`, not from generated modules in the bundle.
- Studio ships no style packs. The user installs packs from the sources. For local authoring, `STUDIO_EXTENSION_SOURCES` points Studio at a folder of built extensions.
- A new Studio with no style pack installs one default pack by itself: Essentials (`cozy.pack-00`, override with `STUDIO_DEFAULT_STYLE_PACK`), a starter set of about a hundred styles copied from the other packs. A marker in the install folder records the offer, so a removed default pack stays removed.
- A style pack may copy presets from other packs. `stylePack.copiedFrom` maps each copy to its source pack and preset, and Studio hides a copy while its source pack is installed, so a style never shows twice.
- The card generator lives with the style content. It creates cards through Studio's job API, so the Generation Providers stay in Studio.
- Third-party extensions are out of scope for now. Before they are allowed, extensions need signing and a trust decision in the UI.

### Workflow modules

Every workflow except `default` is an optional built-in module. Default includes optional style tools; styled generations keep the core `styles` recipe contract. Examples of optional modules are Character Lab, Sprite Atlas, Animation Sequence and Camera Angles.

- A module is Studio code. It ships and is versioned with the app. It is not a Cozy Extension and is never downloaded.
- Settings → Styles & workflows lists modules next to installed extensions, and the user can turn each module on or off.
- A disabled module is unavailable in navigation and new job intake. Backend guards enforce module availability. Existing jobs and assets stay in the Studio Library.
- `workflow-content` is not a supported extension kind. Adding one requires a separate content contract and validation; it must not introduce executable code.
- Workflows written by third parties would need extensions that run code. That needs its own ADR with signing, sandboxing and a stable API.

## Consequences

- Style authoring (manifests, specs, briefs, curation reviews and tools) lives in the private `cozy-styles-dev` repository. The public `cozy-styles` repository holds only released packs.
- Card images never go into git. Lossless originals stay in a local backup. The working copies are WebP q85. Approved cards ship as release assets: first as internal releases of `cozy-styles-dev`, later as public releases. A release is cut when a pack is ready, not after every card wave.
- Tests must use installed-extension fixtures instead of assuming a fixed global pack or preset count.
- Removing style content from the app does not authorize a Git history rewrite; that remains a separate operation requiring explicit approval.
