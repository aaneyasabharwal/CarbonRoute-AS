/**
 * Helpers for stubbing `fetch` in frontend tests.
 * Responses are hand-written test data in the shape the backend returns;
 * they are not recorded production responses.
 */
import { vi } from 'vitest';

export interface StubResponse {
  status?: number;
  body?: unknown;
}

type Route = (url: string, init?: RequestInit) => StubResponse | undefined;

/**
 * Replaces fetch with a function that answers from `route`. A route returning
 * undefined (or throwing) behaves like an unreachable backend.
 */
export function stubFetch(route: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const res = route(url, init);
    if (!res) throw new TypeError(`No stubbed response for ${init?.method ?? 'GET'} ${url}`);
    const status = res.status ?? 200;
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Parsed JSON body of a recorded fetch call. */
export function bodyOf(call: unknown[]): any {
  const init = call[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}
