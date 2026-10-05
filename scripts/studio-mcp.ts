import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { studioMcpTools, isStudioMcpMutation } from '../packages/shared/src/studioMcp';

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

const server = new Server(
  { name: 'cozy-studio', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(studioMcpTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as { type: 'object' },
    annotations: {
      readOnlyHint: !isStudioMcpMutation(name),
      destructiveHint: name === 'studio_cancel',
      idempotentHint: true,
      openWorldHint: name === 'studio_generate',
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const response = await fetch(new URL('/api/mcp/call', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: params.name, arguments: params.arguments ?? {} }),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    const content = await response.text();
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Studio MCP endpoint unavailable. Start the updated Studio app.');
    }
    return { content: [{ type: 'text', text: content }], isError: !response.ok };
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: 'Cannot reach Studio MCP. Start the updated app and check COZY_STUDIO_API_URL. If generation timed out, retry the identical requestId and input.',
        },
      ],
      isError: true,
    };
  }
});
await server.connect(new StdioServerTransport());
