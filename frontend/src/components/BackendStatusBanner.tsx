/**
 * Backend wake-up notice (P9, free hosting). A free Render backend sleeps after 15 minutes without
 * traffic and needs up to about a minute to start again. Instead of pages failing silently, this
 * banner appears when the health check is slow or failing, keeps retrying, and says when the
 * backend is ready. It shows nothing when the backend answers promptly.
 */
import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../services/api';

type Phase = 'checking' | 'ok' | 'waking' | 'ready-after-wait' | 'unreachable';

interface Props {
  /** Show the banner if the backend has not answered after this long (ms). */
  showAfterMs?: number;
  /** Delay between retries while waiting (ms). */
  retryMs?: number;
  /** Give up and show an error after this long (ms). */
  giveUpMs?: number;
}

async function healthy(timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const BackendStatusBanner: React.FC<Props> = ({ showAfterMs = 2500, retryMs = 5000, giveUpMs = 120_000 }) => {
  const [phase, setPhase] = useState<Phase>('checking');
  const [attempt, setAttempt] = useState(0);
  const shown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const showTimer = setTimeout(() => {
      if (!cancelled) {
        shown.current = true;
        setPhase((p) => (p === 'checking' ? 'waking' : p));
      }
    }, showAfterMs);

    (async () => {
      while (!cancelled) {
        if (await healthy(Math.max(retryMs, 8000))) {
          if (cancelled) return;
          clearTimeout(showTimer);
          setPhase(shown.current ? 'ready-after-wait' : 'ok');
          return;
        }
        if (cancelled) return;
        shown.current = true;
        if (Date.now() - started >= giveUpMs) {
          setPhase('unreachable');
          return;
        }
        setPhase('waking');
        await new Promise((r) => setTimeout(r, retryMs));
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(showTimer);
    };
  }, [attempt, showAfterMs, retryMs, giveUpMs]);

  if (phase === 'checking' || phase === 'ok') return null;

  const base = 'px-4 py-2 text-xs font-mono flex flex-wrap items-center justify-center gap-3 border-b';
  if (phase === 'waking') {
    return (
      <div role="status" data-testid="backend-status" className={`${base} bg-amber-950/60 border-amber-800/60 text-amber-100`}>
        <span>
          Connecting to the backend… It runs on free hosting and sleeps when idle, so the first request can take up to a
          minute. This page keeps trying.
        </span>
      </div>
    );
  }
  if (phase === 'ready-after-wait') {
    return (
      <div role="status" data-testid="backend-status" className={`${base} bg-emerald-950/60 border-emerald-800/60 text-emerald-100`}>
        <span>The backend is ready. If something on this page failed to load while it was starting, reload the page.</span>
        <button type="button" onClick={() => window.location.reload()} className="px-2 py-1 rounded border border-emerald-600 hover:bg-emerald-900">
          Reload
        </button>
        <button type="button" onClick={() => setPhase('ok')} className="px-2 py-1 rounded border border-emerald-800 hover:bg-emerald-900">
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <div role="alert" data-testid="backend-status" className={`${base} bg-rose-950/60 border-rose-800/60 text-rose-100`}>
      <span>The backend is not reachable right now. Pages that need it will show errors; public project pages still work.</span>
      <button
        type="button"
        onClick={() => {
          shown.current = true;
          setPhase('waking');
          setAttempt((a) => a + 1);
        }}
        className="px-2 py-1 rounded border border-rose-600 hover:bg-rose-900"
      >
        Try again
      </button>
    </div>
  );
};
