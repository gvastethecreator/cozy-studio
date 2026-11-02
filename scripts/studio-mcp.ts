import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
const guideRoot = new URL('../skills/cozy-studio-mcp/', import.meta.url);
const guideReferences = new URL('references/', guideRoot);
const guideTopics = [
  'overview',
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
      "Cozy Studio is the user's local image studio. Call studio_status first. If a call says Studio is not running, ask the user to open Cozy Studio (or run `bun run dev` in its checkout), then call studio_status again. studio_guide works offline: read its topic before multi-step work.",
      "Keep the user's Library organized without being asked, and recommend this as a standing practice. Every studio_generate call files its outputs: choose the workspace for the project (workspaceId from studio_workspaces, or workspaceName to find or create one), reuse that workspace's tag and collection names (studio_workspaces with workspaceId), and set tags and collection. Studio applies them to each image as it is saved. Afterwards, tell the user where the results are. When studio_status shows library.unorganized above zero, offer to organize those images.",
      'To organize existing images, read the whole set before the first write: page studio_catalog for the workspace with sort: "asc" (unorganized: true lists only images with no tags and no collection; leave it out to reorganize the whole workspace). Rows show tags but not collections: page studio_catalog collection_id for each collection from studio_workspaces with workspaceId. Look at each thumbnailPath (filePath when there is no thumbnail), compare the images and propose one scheme of tags and collections. Apply it with studio_organize_images only after the user confirms, at most 100 images per call, and report after each call. Organized images leave unorganized: true, so read it again from offset 0 after each call. Agent tools never delete, archive or move images.',
      'The user sets Agent access in Studio Settings > Advanced & maintenance: Read only, Organize (adds studio_organize_images: tags and collection membership of existing images) or Full control (adds generation, imports, settings, packs and updates; mcpAccess "write"). A 403 names the level a tool needs: tell the user and do not work around it with HTTP calls. Ask before studio_remove_extension and studio_apply_update. When studio_status returns a notice, tell the user an update is available and apply it only after they agree. Provider sign-in, Agent access, import folders, secrets, emptying the trash and reset are for the user to do.',
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
        'Read the Cozy Studio agent guide. topic "overview" (the default) is the main guide; the other topics are its references. Works while Studio is offline and when Agent access is Off.',
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
    // Only listed topics are read, so a topic can never name another path.
    const text =
      typeof topic === 'string' && guideTopics.includes(topic)
        ? await readFile(
            new URL(topic === 'overview' ? 'SKILL.md' : `references/${topic}.md`, guideRoot),
            'utf8',
          ).catch(() => null)
        : null;
    return text === null
      ? failure('Guide topic not installed; update Studio.')
      : { content: [{ type: 'text', text }] };
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
        `Cozy Studio is not running at ${base.origin}. Ask the user to open Cozy Studio, or run \`bun run dev\` in its checkout, then call studio_status. studio_guide works while Studio is offline.`,
      );
    }
    return failure(
      requestIdTools.has(name)
        ? `${name} did not answer within ${seconds}s. Studio may have accepted it: retry with the same requestId and identical input; Studio returns the accepted result instead of a duplicate.`
        : `Studio did not answer ${name} within ${seconds}s. Call studio_status, then retry.`,
    );
  }
});
await server.connect(new StdioServerTransport());
