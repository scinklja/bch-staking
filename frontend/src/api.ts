/** Public build-time URL. Never put credentials in VITE_* variables. */
export function apiBaseUrl(value = import.meta.env.VITE_API_BASE_URL, development = import.meta.env.DEV): string | null {
  const base = (value ?? (development ? '/api' : '')).trim().replace(/\/+$/, '');
  if (!base) return null;
  if (base.startsWith('/') && !base.startsWith('//') && !/[?#\\]/.test(base)) return base;
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('VITE_API_BASE_URL must be an HTTP(S) URL or an origin-relative path without credentials, query or fragment.');
  }
  return base;
}
