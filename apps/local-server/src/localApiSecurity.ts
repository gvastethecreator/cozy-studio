import type { MiddlewareHandler } from 'hono';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:17222',
  'http://127.0.0.1:17222',
  'http://[::1]:17222',
  'http://localhost:17223',
  'http://127.0.0.1:17223',
  'http://[::1]:17223',
];

const CORS_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization, X-Requested-With';

export interface LocalApiSecurityOptions {
  allowedOrigins?: Iterable<string>;
}

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readEnvAllowedOrigins() {
  const raw = process.env.STUDIO_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw.split(/[;,]/).flatMap((origin) => {
    const trimmed = origin.trim();
    return trimmed ? [trimmed] : [];
  });
}

function createAllowedOriginSet(extraOrigins: Iterable<string> = []) {
  const origins = new Set<string>();
  for (const origin of [...DEFAULT_ALLOWED_ORIGINS, ...readEnvAllowedOrigins(), ...extraOrigins]) {
    const normalized = normalizeOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function applyCorsHeaders(headers: Headers, origin: string | null) {
  const vary = headers.get('Vary')?.split(',') ?? [];
  if (!vary.some((value) => ['origin', '*'].includes(value.trim().toLowerCase()))) {
    headers.append('Vary', 'Origin');
  }
  if (!origin) return;
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', CORS_METHODS);
  headers.set('Access-Control-Allow-Headers', CORS_HEADERS);
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

export function isAllowedLocalApiOrigin(
  origin: string | undefined,
  allowedOrigins: Iterable<string> = DEFAULT_ALLOWED_ORIGINS,
) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const originSet = createAllowedOriginSet(allowedOrigins);
  if (originSet.has(normalized)) return true;
  try {
    const url = new URL(normalized);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackHostname(url.hostname)
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function createLocalApiSecurityMiddleware(
  options: LocalApiSecurityOptions = {},
): MiddlewareHandler {
  const allowedOrigins = createAllowedOriginSet(options.allowedOrigins);

  return async (c, next) => {
    if (!isLoopbackHostname(new URL(c.req.url).hostname)) {
      return c.json({ error: 'Forbidden host', code: 'forbidden_host' }, 403);
    }
    const origin = c.req.header('Origin');
    const normalizedOrigin = origin ? normalizeOrigin(origin) : null;

    if (
      origin &&
      (!normalizedOrigin || !isAllowedLocalApiOrigin(normalizedOrigin, allowedOrigins))
    ) {
      applyCorsHeaders(c.res.headers, null);
      return c.json(
        {
          error: 'Forbidden origin',
          code: 'forbidden_origin',
        },
        403,
      );
    }

    if (c.req.method === 'OPTIONS') {
      const headers = c.res.headers;
      applyCorsHeaders(headers, normalizedOrigin);
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, { status: 204, headers });
    }

    await next();

    applyCorsHeaders(c.res.headers, normalizedOrigin);
  };
}
