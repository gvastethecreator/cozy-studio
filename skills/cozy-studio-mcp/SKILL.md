---
name: cozy-studio-mcp
description: 'Operate a running Cozy Studio through the cozy-studio-mcp server. Use for onboarding checks, queries, settings, style pack installs and updates, reference import, generation, cancellation, or app updates.'
---

# Cozy Studio MCP

This checkout ships the server. `.mcp.json` and `.cursor/mcp.json` register `cozy-studio-mcp` for the workspace. Start Studio first. The server does not start the app or sign in to providers.

## Process

1. Use the shipped server.
   - In this checkout, the client should list `cozy-studio-mcp`. The command is `bun` and the argument is `scripts/studio-mcp.ts`, with the checkout as the working directory.
   - In another workspace, register that same server with an absolute path to this checkout's `scripts/studio-mcp.ts`. Set `COZY_STUDIO_API_URL` when the API port is not 17223. The default origin is `http://127.0.0.1:17223`.
   - Read `docs/agents/mcp.md` before the first call. That document owns the tool list and access rules.
   - Done when the client shows the `cozy-studio-mcp` tools and no second Studio server is registered.

2. Read access, then act.
   - Call `studio_status` first. When it returns a `notice`, tell the user a Studio update is available and suggest updating; apply it only after they agree. If `mcpAccess` is not `write`, stop before reference import, generation or cancellation and ask the user to set Settings → Advanced & maintenance → Agent access (MCP) to Full control.
   - For a local image, use `studio_import_reference_file` with `{requestId, path, name?}`. The path must be absolute and inside **Allowed import folders** saved by the user in the same Settings section. An empty list disables this tool. Do not broaden folder permissions yourself. Studio rejects parent traversal, symlink or junction escapes, non-images and files over 8 MiB or 40 million pixels.
   - Use `studio_import_reference` with `{requestId, name, mimeType, base64, sha256}` only when you already have bounded image bytes. That tool accepts no filesystem path. Prefer the file tool for local images so image bytes do not pass through the model.
   - Both imports store WebP at up to 2048 pixels per side and preserve alpha. Small or transparent images use lossless encoding; larger opaque images use quality 90. The source stays unchanged. Use a stable `reference-` request ID. Keep the same content and name after an uncertain import. The result includes the source `sha256`, `storedSha256` and a catalog ID. Use `catalogImageId` in `studio_generate.referenceIds`; paths are not generation inputs.
   - Use a fresh `batch-` request ID. After a timeout, retry that same ID and the same input. Pass catalog image IDs as references.
   - Done when the call used a tool from `docs/agents/mcp.md` and a retry kept the same request ID.

3. Set up and maintain Studio.
   - For a new user, call `studio_onboarding`. If ChatGPT is not signed in, ask the user to sign in from Studio Settings. Never start sign-in.
   - `studio_update_settings` changes only `defaultProviderId`, `providerDefaults`, `outputDirectory`, `outputOrganization`, `notifyOnUpdates` and `preferredWorkflow`. Agent access and import folders stay user-only.
   - Install or update packs with `studio_install_extension` using `sourceId` and `extensionId` from `studio_available_extensions`. Pass `layers: ["cards"]` to install preview cards. Omitting `layers` keeps the layers already installed for that pack; `layers: []` installs without cards.
   - `studio_remove_extension` deletes pack files. `studio_apply_update` changes the checkout and restarts Studio. Ask the user before either one. Get the commit from `studio_updates` with `check: true`.
   - Done when each write was a change the user asked for and `studio_status` answers after an update.
