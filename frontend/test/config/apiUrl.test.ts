/**
 * P8 (deployment blocker B7): the frontend must never silently call a missing or retired backend.
 * Before P8, a production build without VITE_API_URL called the hard-coded, now suspended,
 * https://carbonroute.onrender.com. CI also checks that no source file or built bundle contains it.
 */
import { describe, it, expect } from 'vitest';
import { validateBuildApiUrl, resolveBackendUrl } from '../../src/config/apiUrl';

describe('validateBuildApiUrl (build time)', () => {
  it('fails a GitHub Pages build without VITE_API_URL', () => {
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true' })).toThrow(/VITE_API_URL is required/);
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: '  ' })).toThrow(/required/);
  });

  it('refuses the retired backend in any build', () => {
    expect(() => validateBuildApiUrl({ VITE_API_URL: 'https://carbonroute.onrender.com' })).toThrow(/retired/);
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: 'https://CarbonRoute.onrender.com/api/' })).toThrow(/retired/);
  });

  it('requires an absolute https URL for Pages', () => {
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: 'http://staging.example.org' })).toThrow(/https/);
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: '/api' })).toThrow(/absolute/);
    expect(() => validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: 'not a url' })).toThrow(/not a valid URL/);
  });

  it('accepts a proper URL and normalises a trailing /api', () => {
    expect(validateBuildApiUrl({ GITHUB_PAGES: 'true', VITE_API_URL: 'https://carbonroute-staging.onrender.com/api/' })).toBe('https://carbonroute-staging.onrender.com');
    expect(validateBuildApiUrl({ VITE_API_URL: '/api' })).toBe(''); // Docker: same origin through nginx
    expect(validateBuildApiUrl({})).toBeUndefined(); // local development
  });
});

describe('resolveBackendUrl (runtime)', () => {
  it('uses VITE_API_URL, then the local backend on localhost, otherwise the same origin, never a remote default', () => {
    expect(resolveBackendUrl('https://api.example.org/api', 'example.github.io')).toBe('https://api.example.org');
    expect(resolveBackendUrl(undefined, 'localhost')).toBe('http://localhost:5000');
    expect(resolveBackendUrl(undefined, '127.0.0.1')).toBe('http://localhost:5000');
    expect(resolveBackendUrl(undefined, 'aaneyasabharwal.github.io')).toBe('');
    expect(resolveBackendUrl('', 'example.org')).toBe('');
  });

});
