/**
 * Backend wake-up notice (P9): a free backend sleeps when idle and needs up to a minute to start.
 * Before P9 pages simply failed during that minute with no explanation.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BackendStatusBanner } from '../../src/components/BackendStatusBanner';
import { API_BASE } from '../../src/services/api';
import { stubFetch } from '../support/fetch';

describe('BackendStatusBanner', () => {
  it('shows nothing when the backend answers promptly', async () => {
    const fetchMock = stubFetch((url) => (url === `${API_BASE}/health` ? { body: { status: 'healthy' } } : undefined));
    render(<BackendStatusBanner showAfterMs={200} retryMs={20} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(screen.queryByTestId('backend-status')).toBeNull();
  });

  it('while the backend is waking it says so and retries, then reports it is ready', async () => {
    let calls = 0;
    stubFetch((url) => {
      if (url !== `${API_BASE}/health`) return undefined;
      calls++;
      return calls < 3 ? { status: 503, body: { message: 'starting' } } : { body: { status: 'healthy' } };
    });
    render(<BackendStatusBanner showAfterMs={10} retryMs={20} />);
    expect(await screen.findByText(/sleeps when idle/)).toBeInTheDocument();
    expect(await screen.findByText(/The backend is ready/)).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it('gives up with a clear error and offers to try again', async () => {
    stubFetch(() => undefined); // unreachable
    render(<BackendStatusBanner showAfterMs={5} retryMs={10} giveUpMs={40} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
