/**
 * Backend URL resolution (P8, deployment blocker B7).
 *
 * Before P8 a production build without VITE_API_URL silently called the hard-coded
 * https://carbonroute.onrender.com, an old backend that ran pre-remediation code and is now suspended.
 * Now:
 *  - a GitHub Pages build (GITHUB_PAGES=true) FAILS unless VITE_API_URL is an https URL that is not a
 *    retired backend (checked in vite.config.ts with validateBuildApiUrl);
 *  - at runtime there is no remote fallback: VITE_API_URL if set, the local backend on localhost,
 *    otherwise the SAME ORIGIN (/api), which is correct behind the Docker nginx proxy and fails
 *    visibly anywhere else instead of reaching an unexpected server.
 */

/** Hosts that must never be used again (old, suspended or decommissioned backends). */
export const RETIRED_BACKEND_HOSTS = ['carbonroute.onrender.com'];

const stripApi = (url: string) => url.trim().replace(/\/+$/, '').replace(/\/api$/, '');

/** Build-time check. Returns the normalised URL (or undefined) or throws with an explanation. */
export function validateBuildApiUrl(env: Record<string, string | undefined>): string | undefined {
  const raw = env.VITE_API_URL?.trim();
  const pages = env.GITHUB_PAGES === 'true';
  if (!raw) {
    if (pages) {
      throw new Error(
        'VITE_API_URL is required for the GitHub Pages build. Set the repository variable VITE_API_URL to the backend URL (https://...). There is no default backend.'
      );
    }
    return undefined;
  }
  if (raw.startsWith('/')) {
    if (pages) throw new Error('VITE_API_URL must be an absolute https URL for GitHub Pages (Pages has no /api proxy).');
    return stripApi(raw);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_API_URL is not a valid URL: ${raw}`);
  }
  if (RETIRED_BACKEND_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(`VITE_API_URL points to ${url.hostname}, a retired backend that must not be used. Set the new backend URL.`);
  }
  if (pages && url.protocol !== 'https:') throw new Error('VITE_API_URL must use https for GitHub Pages.');
  return stripApi(url.toString());
}

/** Runtime resolution of the backend origin ('' means same origin). */
export function resolveBackendUrl(envUrl: string | undefined, hostname: string | undefined): string {
  if (envUrl && envUrl.trim()) return stripApi(envUrl);
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:5000';
  return '';
}
