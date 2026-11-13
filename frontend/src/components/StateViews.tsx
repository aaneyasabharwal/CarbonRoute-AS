/**
 * Loading, empty, error and sign-in states (P4). Every data view shows one of these instead of
 * placeholder numbers when data is not (yet) available.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Inbox, Loader2, LogIn } from 'lucide-react';

export const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" aria-live="polite" className="flex items-center gap-2 p-6 text-sm text-slate-400">
    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div data-testid="empty-state" className="p-6 rounded-xl border border-dashed border-slate-700 text-sm text-slate-400 space-y-2">
    <div className="flex items-center gap-2 font-bold text-slate-200">
      <Inbox className="w-4 h-4" aria-hidden="true" /> {title}
    </div>
    {children}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="p-4 rounded-xl border border-rose-800 bg-rose-950/40 text-sm text-rose-200 flex items-start gap-3">
    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
    <div className="space-y-2">
      <div>{message}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="px-3 py-1 rounded border border-rose-700 hover:bg-rose-900/50 text-xs font-bold">
          Try again
        </button>
      )}
    </div>
  </div>
);

export const SignInRequired: React.FC<{ what: string; message?: string }> = ({ what, message }) => (
  <div data-testid="sign-in-required" className="p-6 rounded-xl border border-amber-800 bg-amber-950/30 text-sm text-amber-100 space-y-2">
    <div className="flex items-center gap-2 font-bold">
      <LogIn className="w-4 h-4" aria-hidden="true" /> Sign in to see {what}
    </div>
    <p className="text-amber-200/80">{message || `${what[0].toUpperCase()}${what.slice(1)} belong to the account that created them.`}</p>
    <Link to="/admin" className="inline-block px-3 py-1 rounded bg-amber-500 text-slate-950 font-bold text-xs">
      Sign in
    </Link>
  </div>
);
