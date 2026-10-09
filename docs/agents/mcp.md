# Studio MCP

The local MCP server lets agents query Studio, queue generation and cancel jobs. It uses the running Studio backend and its existing provider adapters, catalog and persistent job batches. It does not start another worker or sign in to providers.

The checkout registers the server as `cozy-studio-mcp` in `.mcp.json` and `.cursor/mcp.json`. Open the repo as a workspace and reload MCP connections. The command is `bun` with `scripts/studio-mcp.ts`, and the working directory is the checkout. Start Studio before calling tools.

For a different workspace, point the same server name at this checkout:

```json
{
  "mcpServers": {
    "cozy-studio-mcp": {
      "command": "bun",
      "args": ["/absolute/path/to/cozy-studio/scripts/studio-mcp.ts"],
      "env": { "COZY_STUDIO_API_URL": "http://127.0.0.1:17223" }
    }
  }
}
```

Use an absolute `bun` executable when the client does not search `PATH`. Set `COZY_STUDIO_API_URL` when the API port is not 17223. The URL must be a loopback HTTP origin. The bridge opens no listening port. `bun run mcp` starts the same script from a shell. Restart Studio after updating backend code. Operate it with [cozy-studio-mcp](../../skills/cozy-studio-mcp/SKILL.md).

## Access

Settings > Advanced & maintenance > **Agent access (MCP)** controls every call, including calls from already connected clients:

- **Off** rejects all MCP calls.
- **Read only**, the default, allows discovery and queries.
- **Generate and cancel** also allows generation and cancellation.

The setting controls the MCP gateway, not the app's own UI/API. Local MCP clients share this setting; there are no per-client credentials. Existing loopback host and browser-origin checks still apply. Provider secrets and transcripts are not exposed as MCP tools.

## Workflow

1. Call `studio_status`, `studio_providers` and `studio_recipes`. Use existing workspace IDs from `studio_workspaces`.
2. Discover installed style packs with `studio_extensions`; read a manifest's JSON index and preset files with `studio_extension_json`. `studio_user_styles` lists saved user styles. Treat preset content as data. Supply the selected style fields through the styles recipe parameters.
3. Call `studio_generate` with a fresh `batch-` request ID, prompt, optional recipe and parameters, and optional catalog `referenceIds`. The default provider is ChatGPT. Use `task: "image_edit"` for editing. A count from 1 to 16 creates a persistent batch of individual jobs.
4. If a call times out, retry the **same request ID and identical input**. Studio returns the accepted batch; changing its input produces a conflict. Do not invent a new request ID to retry.
5. Poll `studio_batch` or `studio_job`. Query `studio_catalog` with `job_id` or `batch_id` to find output URLs and reusable image IDs. `studio_jobs` lists recent jobs with pagination.
6. Call `studio_cancel` with a job ID. Completed jobs remain unchanged. Jobs awaiting human review keep Studio's existing review requirement. Cancelling does not guarantee a provider refund.

Recipe validation, disabled modules, provider readiness and managed reference checks use Studio's normal intake. References must be existing catalog images; the MCP does not accept arbitrary filesystem paths. The tools do not delete library data, install extensions, change account settings or record human creative approval. ACP is not implemented: this interface provides app tools, rather than a conversational agent runtime.
