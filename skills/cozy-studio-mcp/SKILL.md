---
name: cozy-studio-mcp
description: "Operate a running Cozy Studio through the cozy-studio-mcp server. Use for queries, generation, or cancellation."
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
   - Call `studio_status` first. If `mcpAccess` is not `write`, stop before generation or cancellation and ask the user to set Settings → Advanced & maintenance → Agent access (MCP) to Generate and cancel.
   - Use a fresh `batch-` request ID. After a timeout, retry that same ID and the same input. Pass catalog image IDs as references.
   - Done when the call used a tool from `docs/agents/mcp.md` and a retry kept the same request ID.
