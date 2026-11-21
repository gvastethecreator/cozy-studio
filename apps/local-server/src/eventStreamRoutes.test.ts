import { describe, expect, it, vi } from 'vitest';
import type { StudioEvent } from '../../../packages/shared/src';
import type { StudioMcpAccess } from '../../../packages/shared/src/studioSettings';
import {
  EVENT_STREAM_KEEPALIVE_MS,
  createEventStreamRoutes,
  createServerConnectedEvent,
} from './eventStreamRoutes';

describe('eventStreamRoutes', () => {
  it('exports connected event helper and keepalive interval', () => {
    const event = createServerConnectedEvent();
    expect(event.type).toBe('server.connected');
    expect(event.payload).toEqual({ ok: true, revision: 0, reconciled: true });
    expect(event.revision).toBe(0);
    expect(typeof event.createdAt).toBe('string');
    expect(EVENT_STREAM_KEEPALIVE_MS).toBe(10_000);
  });

  it('marks a reconnect revision mismatch for snapshot reconciliation', () => {
    const event = createServerConnectedEvent(8, 5);
    expect(event.payload).toMatchObject({ revision: 8, reconciled: false });
  });

  it('returns SSE handshake payload and no-buffering header', async () => {
    const subscribeEvents = vi.fn(() => () => true);
    const routes = createEventStreamRoutes({
      subscribeEvents,
      readMcpAccess: () => 'off',
    });

    const response = await routes.request('/events');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(response.headers.get('content-type')?.toLowerCase()).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);

    expect(text).toContain('server.connected');
    expect(subscribeEvents).toHaveBeenCalledTimes(1);

    await reader!.cancel();
  });

  it('follows Agent access on the agent stream and leaves the UI stream open', async () => {
    let access: StudioMcpAccess = 'off';
    let deliver: ((event: StudioEvent) => void) | undefined;
    const routes = createEventStreamRoutes({
      subscribeEvents: (listener) => {
        deliver = listener;
        return () => true;
      },
      readMcpAccess: () => access,
    });

    const refused = await routes.request('/agent/events');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ access: 'off', required: 'read' });

    const ui = await routes.request('/events');
    expect(ui.status).toBe(200);
    await ui.body!.cancel();

    access = 'read';
    const agent = await routes.request('/agent/events');
    expect(agent.status).toBe(200);
    const reader = agent.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('server.connected');

    access = 'off';
    deliver!({
      type: 'job.created',
      payload: {} as never,
      createdAt: new Date().toISOString(),
    } as StudioEvent);
    expect((await reader.read()).done).toBe(true);
  });
});
