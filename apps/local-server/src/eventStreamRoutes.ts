import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { StudioEvent, UnknownStudioEvent } from '../../../packages/shared/src';
import { STUDIO_MCP_ACCESS_LABELS } from '../../../packages/shared/src/studioMcp';
import type { StudioMcpAccess } from '../../../packages/shared/src/studioSettings';
import type { subscribeEvents } from './events';

export const EVENT_STREAM_KEEPALIVE_MS = 10_000;
export const EVENT_STREAM_MAX_PENDING_WRITES = 100;

export function createServerConnectedEvent(
  revision = 0,
  clientRevision: number | null = null,
): Extract<StudioEvent, { type: 'server.connected' }> {
  return {
    type: 'server.connected',
    payload: {
      ok: true,
      revision,
      reconciled: clientRevision === null || clientRevision === revision,
    },
    createdAt: new Date().toISOString(),
    revision,
  };
}

interface EventStreamRoutesDependencies {
  subscribeEvents: typeof subscribeEvents;
  readEventRevision?: () => number;
  readMcpAccess: () => StudioMcpAccess;
}

export function createEventStreamRoutes({
  subscribeEvents,
  readEventRevision = () => 0,
  readMcpAccess,
}: EventStreamRoutesDependencies) {
  const routes = new Hono();

  // Studio's own UI reads /events. External clients read /agent/events, which follows Agent access
  // and ends when the user turns it off.
  routes.get('/events', (c) => streamEvents(c, () => true));
  routes.get('/agent/events', (c) => {
    const access = readMcpAccess();
    if (access === 'off')
      return c.json(
        {
          error: `The event stream needs ${STUDIO_MCP_ACCESS_LABELS.read} access. Agent access is ${STUDIO_MCP_ACCESS_LABELS.off}. Ask the user to change Agent access (MCP) in Studio Settings > Advanced & maintenance.`,
          access,
          required: 'read',
        },
        403,
      );
    return streamEvents(c, () => readMcpAccess() !== 'off');
  });

  function streamEvents(c: Context, allowed: () => boolean) {
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      let cleanedUp = false;
      let pendingWrites = 0;
      let writeChain = Promise.resolve();

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        unsubscribe();
      };

      const abort = () => {
        cleanup();
        if (!stream.aborted) stream.abort();
      };

      const send = (event: StudioEvent | UnknownStudioEvent) => {
        if (stream.aborted) return;
        if (!allowed()) {
          abort();
          return;
        }
        if (pendingWrites >= EVENT_STREAM_MAX_PENDING_WRITES) {
          abort();
          return;
        }
        pendingWrites += 1;
        writeChain = writeChain
          .then(() =>
            stream.writeSSE({
              data: JSON.stringify(event),
              id: event.revision === undefined ? undefined : String(event.revision),
            }),
          )
          .catch(() => abort())
          .finally(() => {
            pendingWrites -= 1;
          });
      };

      const unsubscribe = subscribeEvents(send);

      c.req.raw.signal.addEventListener('abort', abort, { once: true });

      try {
        const sinceValue = new URL(c.req.url).searchParams.get('since');
        const since = sinceValue && /^\d+$/.test(sinceValue) ? Number(sinceValue) : null;
        const connectedEvent = createServerConnectedEvent(readEventRevision(), since);
        await stream.writeSSE({
          data: JSON.stringify(connectedEvent),
          id: String(connectedEvent.revision ?? 0),
        });

        while (!stream.aborted) {
          await stream.sleep(EVENT_STREAM_KEEPALIVE_MS);
          if (!allowed()) break;
          await stream.write(`: keep-alive ${Date.now()}\n\n`);
        }
      } finally {
        cleanup();
        c.req.raw.signal.removeEventListener('abort', abort);
      }
    });
  }

  return routes;
}
