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
    instructions:
      'Call studio_status first. If it returns a notice, a Studio update is available: tell the user and suggest updating; apply it with studio_apply_update only after they agree.',
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
