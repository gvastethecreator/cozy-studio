import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { studioMcpTools } from '../packages/shared/src/studioMcp';

const base = new URL(process.env.COZY_STUDIO_API_URL ?? 'http://127.0.0.1:17223');
if (
  base.protocol !== 'http:' ||
  !['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
) {
  throw new Error('COZY_STUDIO_API_URL must be a loopback HTTP origin.');
}

// Pack downloads and git fetches can outlast an ordinary call.
const slowTools = new Set(['studio_install_extension', 'studio_updates', 'studio_apply_update']);
const networkTools = new Set([
  'studio_generate',
  'studio_retry_batch',
  'studio_available_extensions',
  'studio_install_extension',
  'studio_updates',
  'studio_apply_update',
]);
const destructiveTools = new Set([
  'studio_cancel',
  'studio_remove_extension',
  'studio_apply_update',
]);
// These tools replay an accepted requestId, so a timed-out call is safe to repeat as is.
const requestIdTools = new Set([
  'studio_generate',
  'studio_import_reference',
  'studio_import_reference_file',
]);

// studio_guide is answered here, so it works while Studio is offline and when Agent access is Off.
const checkout = fileURLToPath(new URL('..', import.meta.url));
const guideRoot = new URL('../skills/cozy-studio-mcp/', import.meta.url);
const guideReferences = new URL('references/', guideRoot);
// Topics resolve at call time, so a reference added by an update works before a reconnect.
// A plain lowercase name keeps the read inside references/.
const guideFile = (topic: string) =>
  topic === 'overview'
    ? new URL('SKILL.md', guideRoot)
    : topic === 'contract'
      ? new URL('../docs/agents/mcp.md', import.meta.url)
      : /^[a-z-]+$/.test(topic)
        ? new URL(`${topic}.md`, guideReferences)
        : null;
const guideTopics = [
  'overview',
  'contract',
  ...(existsSync(guideReferences) ? readdirSync(guideReferences) : [])
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -3)),
];

const failure = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

const server = new Server(
  { name: 'cozy-studio-mcp', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: [
      "Cozy Studio is the user's local image studio. Call studio_status first. Before multi-step work, read studio_guide (topic overview, then the topic for the task). It works while Studio is offline.",
      'Organize while generating. Every studio_generate sets the workspace (workspaceId, or workspaceName to find or create one), tags and collection. Reuse the names from studio_workspaces with workspaceId. Send tags: [] or collection: null only when the user asks for that. Tell the user where the results are. Keeping the Library organized is a standing recommendation: when studio_status returns organizeNotice, offer to organize those images.',
      'To organize existing images, read the whole set with studio_catalog before the first write. Look at each thumbnailPath, or filePath when there is no thumbnail. Propose one scheme of tags and collections. Apply it with studio_organize_images only after the user confirms, at most 100 images per call. Never delete, archive or move images.',
      "studio_generate and studio_retry_batch spend the user's provider usage. A direct request for exactly these images, or for this retry, is consent. Otherwise preview with studio_plan_generation, which spends nothing, and confirm provider, model, image count and workspace; for a retry, confirm the retryable job count from studio_batch. After a studio_generate timeout, repeat it with the same requestId and identical input.",
      'The user sets Agent access in Studio Settings > Advanced & maintenance: Read only, Organize (adds studio_organize_images) or Full control (mcpAccess "write": generation, imports, settings, packs, updates). A 403 names the level a tool needs: tell the user. Use these tools, not raw HTTP. Ask before studio_remove_extension and studio_apply_update. Provider sign-in, provider settings, secrets, Agent access, import folders, emptying the Archive and reset are for the user to do.',
    ].join('\n\n'),
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...Object.entries(studioMcpTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as { type: 'object' },
      annotations: {
        readOnlyHint: tool.access === 'read',
        destructiveHint: destructiveTools.has(name),
        idempotentHint: name !== 'studio_apply_update',
        openWorldHint: networkTools.has(name),
      },
    })),
    {
      name: 'studio_guide',
      description:
        'Read the Cozy Studio agent guide. topic "overview" (the default) is the main guide and names the Studio checkout; "contract" is the full tool contract; the other topics are its references. Works while Studio is offline and when Agent access is Off.',
      inputSchema: z.toJSONSchema(
        z.strictObject({ topic: z.enum(guideTopics).default('overview') }),
        { io: 'input' },
      ) as { type: 'object' },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const { name } = params;
  if (name === 'studio_guide') {
    const topic = params.arguments?.topic ?? 'overview';
    const file = typeof topic === 'string' ? guideFile(topic) : null;
    const text = file && (await readFile(file, 'utf8').catch(() => null));
    if (!text)
      return failure(
        `Unknown guide topic. Topics: ${guideTopics.join(', ')}. After a Studio update, reload the MCP connection.`,
      );
    return {
      content: [
        {
          type: 'text',
          text: topic === 'overview' ? `Studio checkout: ${checkout}\n\n${text}` : text,
        },
      ],
    };
  }
  const seconds = slowTools.has(name) ? 120 : 30;
  try {
    const response = await fetch(new URL('/api/mcp/call', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: params.arguments ?? {} }),
      signal: AbortSignal.timeout(seconds * 1000),
      redirect: 'error',
    });
    const text = await response.text();
    if (response.headers.get('content-type')?.includes('application/json')) {
      return { content: [{ type: 'text', text }], isError: !response.ok };
    }
    return failure(
      response.status === 413
        ? 'The request is larger than Studio accepts. Import local images with studio_import_reference_file instead of base64.'
        : `Something other than this Studio answered at ${base.origin} (HTTP ${response.status}). Restart Studio from the updated checkout, or check COZY_STUDIO_API_URL.`,
    );
  } catch (error) {
    if (!(error instanceof Error && error.name === 'TimeoutError')) {
      return failure(
        `Cozy Studio is not running at ${base.origin}. Ask the user to open Cozy Studio, or run \`bun run dev\` in ${checkout}, then call studio_status. studio_guide works while Studio is offline.`,
      );
    }
    // A replayed retry finds its jobs already queued and retries nothing, so check the batch.
    return failure(
      name === 'studio_retry_batch'
        ? `${name} did not answer within ${seconds}s. Studio may have accepted it: call studio_batch; queued or running jobs mean the retry was accepted.`
        : requestIdTools.has(name)
          ? `${name} did not answer within ${seconds}s. Studio may have accepted it: retry with the same requestId and identical input; Studio returns the accepted result instead of a duplicate.`
          : `Studio did not answer ${name} within ${seconds}s. Call studio_status, then retry.`,
    );
  }
});
await server.connect(new StdioServerTransport());
