/**
 * P7: the GitHub Pages base path must match the repository that hosts Pages
 * (https://<owner>.github.io/<repository>/). It used to be hard-coded to /CarbonRoute/,
 * which breaks every asset and route on the CarbonRoute-AS repository.
 */
import { describe, it, expect } from 'vitest';
import { pagesBase } from '../../src/config/pagesBase';

describe('pagesBase', () => {
  it('serves from / outside a Pages build', () => {
    expect(pagesBase({})).toBe('/');
    expect(pagesBase({ GITHUB_REPOSITORY: 'a/CarbonRoute-AS' })).toBe('/');
  });
  it('defaults to this repository, CarbonRoute-AS', () => {
    expect(pagesBase({ GITHUB_PAGES: 'true' })).toBe('/CarbonRoute-AS/');
  });
  it('follows the repository GitHub Actions builds', () => {
    expect(pagesBase({ GITHUB_PAGES: 'true', GITHUB_REPOSITORY: 'aaneyasabharwal/CarbonRoute-AS' })).toBe('/CarbonRoute-AS/');
    expect(pagesBase({ GITHUB_PAGES: 'true', GITHUB_REPOSITORY: 'someone/CarbonRoute' })).toBe('/CarbonRoute/');
  });
  it('accepts an explicit override, including / for a custom domain', () => {
    expect(pagesBase({ GITHUB_PAGES: 'true', PAGES_BASE_PATH: '/demo/', GITHUB_REPOSITORY: 'a/b' })).toBe('/demo/');
    expect(pagesBase({ GITHUB_PAGES: 'true', PAGES_BASE_PATH: '/' })).toBe('/');
  });
  it('rejects a repository name that is not a safe path segment', () => {
    expect(() => pagesBase({ GITHUB_PAGES: 'true', GITHUB_REPOSITORY: 'a/x y' })).toThrow();
  });
});
