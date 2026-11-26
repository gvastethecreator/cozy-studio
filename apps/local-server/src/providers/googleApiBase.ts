export const DEFAULT_GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function resolveGoogleApiBase(value: string | undefined) {
  const raw = trimTrailingSlash(value?.trim() || DEFAULT_GOOGLE_API_BASE);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('GOOGLE_API_BASE is not a valid URL.');
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('GOOGLE_API_BASE must use HTTPS or a credential-free loopback URL.');
  }
  return trimTrailingSlash(url.href);
}
