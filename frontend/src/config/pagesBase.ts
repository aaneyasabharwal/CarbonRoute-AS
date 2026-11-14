/**
 * Base path for the GitHub Pages build (P7). Pages serves a project site at
 * https://<owner>.github.io/<repository>/, so the base must be the repository name.
 *  - PAGES_BASE_PATH overrides it explicitly ("/" for a custom domain or user site);
 *  - otherwise the repository name from GITHUB_REPOSITORY ("owner/name", set by GitHub Actions);
 *  - otherwise this repository's name, CarbonRoute-AS.
 * Without GITHUB_PAGES=true the app is served from "/".
 */
export const DEFAULT_PAGES_REPOSITORY = 'CarbonRoute-AS';

export function pagesBase(env: Record<string, string | undefined>): string {
  if (env.GITHUB_PAGES !== 'true') return '/';
  const explicit = env.PAGES_BASE_PATH?.trim();
  if (explicit) {
    const trimmed = explicit.replace(/^\/+|\/+$/g, '');
    return trimmed ? `/${trimmed}/` : '/';
  }
  const repo = env.GITHUB_REPOSITORY?.split('/')[1]?.trim() || DEFAULT_PAGES_REPOSITORY;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`Invalid repository name for the Pages base path: ${repo}`);
  return `/${repo}/`;
}
