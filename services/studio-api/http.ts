import { resolveStudioApiBase } from '../studioRuntime';

export class StudioApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly reason: string | null;
  /** The JSON error body, for callers that need more than the message. */
  readonly payload: Record<string, unknown> | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      reason?: string | null;
      payload?: Record<string, unknown> | null;
    },
  ) {
    super(message);
    this.name = 'StudioApiError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.reason = options.reason ?? null;
    this.payload = options.payload ?? null;
  }
}

/** The code `request()` uses when Studio's local server does not answer at all. */
export const STUDIO_OFFLINE = 'studio_offline';
export const STUDIO_OFFLINE_MESSAGE = "Studio's local server is not responding.";

export function isStudioOfflineError(error: unknown) {
  return error instanceof StudioApiError && error.code === STUDIO_OFFLINE;
}

function decodeLocalStudioError(text: string, status: number) {
  const trimmed = text.trim();
  let message = trimmed || `Local studio request failed: ${status}`;
  let code: string | null = null;
  let reason: string | null = null;
  let body: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === 'object') {
      const payload = value as Record<string, unknown>;
      body = payload;
      if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error.trim();
      else if (typeof payload.message === 'string' && payload.message.trim())
        message = payload.message.trim();
      code = typeof payload.code === 'string' ? payload.code : null;
      reason = typeof payload.reason === 'string' ? payload.reason : null;
    } else if (value === null) {
      message = `Local studio request failed: ${status}`;
    }
  } catch {
    /* Plain-text errors retain the backend message. */
  }
  return { message, code, reason, payload: body };
}

export function readLocalStudioErrorMessage(text: string, status: number) {
  return decodeLocalStudioError(text, status).message;
}

/**
 * Execute a JSON request against the local studio backend.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = resolveStudioApiBase();
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    // A network failure means the local server is down, not that the request was wrong.
    throw new StudioApiError(STUDIO_OFFLINE_MESSAGE, { status: 0, code: STUDIO_OFFLINE });
  }

  if (!response.ok) {
    const { message, code, reason, payload } = decodeLocalStudioError(
      await response.text(),
      response.status,
    );
    throw new StudioApiError(message, { status: response.status, code, reason, payload });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getStudioApiBase() {
  return resolveStudioApiBase();
}

export function readAttachmentFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let filename = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? fallback;
  if (encodedName) {
    try {
      filename = decodeURIComponent(encodedName);
    } catch {
      /* Keep the plain filename when the encoding is invalid. */
    }
  }
  return filename.split(/[\\/]/).pop() || fallback;
}
