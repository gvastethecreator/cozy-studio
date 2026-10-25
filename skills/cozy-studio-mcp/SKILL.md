---
name: cozy-studio-mcp
description: 'Operate a running Cozy Studio through the cozy-studio-mcp server. Use for queries, reference import, generation, or cancellation.'
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
   - Call `studio_status` first. If `mcpAccess` is not `write`, stop before reference import, generation or cancellation and ask the user to set Settings → Advanced & maintenance → Agent access (MCP) to Generate and cancel.
   - For a local image, use `studio_import_reference_file` with `{requestId, path, name?}`. The path must be absolute and inside **Allowed import folders** saved by the user in the same Settings section. An empty list disables this tool. Do not broaden folder permissions yourself. Studio rejects parent traversal, symlink or junction escapes, non-images and files over 8 MiB or 40 million pixels.
   - Use `studio_import_reference` with `{requestId, name, mimeType, base64, sha256}` only when you already have bounded image bytes. That tool accepts no filesystem path. Prefer the file tool for local images so image bytes do not pass through the model.
   - Both imports store WebP at up to 2048 pixels per side and preserve alpha. Small or transparent images use lossless encoding; larger opaque images use quality 90. The source stays unchanged. Use a stable `reference-` request ID. Keep the same content and name after an uncertain import. The result includes the source `sha256`, `storedSha256` and a catalog ID. Use `catalogImageId` in `studio_generate.referenceIds`; paths are not generation inputs.
   - Use a fresh `batch-` request ID. After a timeout, retry that same ID and the same input. Pass catalog image IDs as references.
   - Done when the call used a tool from `docs/agents/mcp.md` and a retry kept the same request ID.
