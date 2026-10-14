import { describe, expect, it } from 'vitest';
import { createLocalApiSecurityMiddleware, isAllowedLocalApiOrigin } from './localApiSecurity';
import { Hono } from 'hono';

describe('localApiSecurity', () => {
  it('allows standard default loopback origins on port 17222 and 17223', () => {
    expect(isAllowedLocalApiOrigin('http://localhost:17222')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://127.0.0.1:17222')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://[::1]:17222')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://localhost:17223')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://127.0.0.1:17223')).toBe(true);
  });

  it('allows dynamic loopback origins on any port for localhost, 127.0.0.1, and [::1]', () => {
    expect(isAllowedLocalApiOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://localhost:17225')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://127.0.0.1:18000')).toBe(true);
    expect(isAllowedLocalApiOrigin('http://[::1]:5174')).toBe(true);
  });

  it('rejects file:// origins', () => {
    expect(isAllowedLocalApiOrigin('file://')).toBe(false);
    expect(isAllowedLocalApiOrigin('file:///C:/CozyStudio/index.html')).toBe(false);
  });

  it('rejects external or non-loopback origins', () => {
    expect(isAllowedLocalApiOrigin('https://example.com')).toBe(false);
    expect(isAllowedLocalApiOrigin('http://evil.attacker.org:17222')).toBe(false);
    expect(isAllowedLocalApiOrigin('http://192.168.1.100:17222')).toBe(false);
    expect(isAllowedLocalApiOrigin('invalid-url')).toBe(false);
  });

  it('varies cached responses by Origin while preserving Vary and origin restrictions', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.header('Vary', 'Accept-Encoding');
      await next();
    });
    app.use('*', createLocalApiSecurityMiddleware());
    app.get('/test', (c) => c.json({ ok: true }));
    app.get('/existing-origin', (c) => {
      c.header('Vary', 'origin, Accept-Encoding');
      return c.json({ ok: true });
    });

    const noOriginResponse = await app.request('/test');
    expect(noOriginResponse.status).toBe(200);
    expect(noOriginResponse.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(noOriginResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const allowedResponse = await app.request('/test', {
      headers: { Origin: 'http://localhost:17225' },
    });
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(allowedResponse.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:17225',
    );

    const forbiddenResponse = await app.request('/test', {
      headers: { Origin: 'https://malicious.org' },
    });
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(forbiddenResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const fileOriginResponse = await app.request('/test', {
      headers: { Origin: 'file://' },
    });
    expect(fileOriginResponse.status).toBe(403);
    expect(fileOriginResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const existingOriginResponse = await app.request('/existing-origin');
    expect(existingOriginResponse.headers.get('Vary')).toBe('origin, Accept-Encoding');

    const preflightResponse = await app.request('/test', { method: 'OPTIONS' });
    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(preflightResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
