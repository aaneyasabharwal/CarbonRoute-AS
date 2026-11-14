/**
 * Account (P8). Signed-in users change their password here; administrators also list and create
 * accounts (there is no public self-registration: every account can spend the shared provider
 * quota). All rules are enforced by the backend; this page shows its answers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, Users } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';
import { EmptyState, ErrorState, LoadingState, SignInRequired } from '../components/StateViews';

const input = 'w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100';
const MIN_PASSWORD = 12;

export const AccountPage: React.FC = () => {
  const { user, isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated || !user) {
    return (
      <Shell>
        <SignInRequired what="your account" />
      </Shell>
    );
  }
  return (
    <Shell>
      <section aria-label="Your account" className="p-5 rounded-2xl border border-slate-800 text-sm text-slate-300">
        Signed in as <strong className="text-white">{user.username}</strong> ({user.email}), role <strong className="text-white">{user.role}</strong>.
      </section>
      <ChangePassword />
      {isAdmin && <Accounts />}
    </Shell>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
    <h1 className="text-3xl font-extrabold text-white font-mono">Account</h1>
    {children}
  </div>
);

const ChangePassword: React.FC = () => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const problem =
    next && next.length < MIN_PASSWORD ? `The new password must be at least ${MIN_PASSWORD} characters.` : confirm && next !== confirm ? 'The two new passwords do not match.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !current || !next) return;
    setBusy(true);
    setResult(null);
    const r = await api.changePassword(current, next);
    setBusy(false);
    setResult({ ok: r.success, message: r.message || (r.success ? 'Password changed.' : 'Password change failed.') });
    if (r.success) {
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  };

  return (
    <section aria-label="Change password" className="p-5 rounded-2xl border border-slate-800 space-y-3">
      <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-emerald-300" aria-hidden="true" /> Change password
      </h2>
      <p className="text-xs text-slate-400">Changing your password signs out every other session (all older tokens stop working). This device stays signed in.</p>
      <form onSubmit={submit} className="space-y-2">
        <label className="block text-xs text-slate-400">
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
        </label>
        <label className="block text-xs text-slate-400">
          New password (at least {MIN_PASSWORD} characters)
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
        </label>
        <label className="block text-xs text-slate-400">
          Repeat the new password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        </label>
        {problem && <p className="text-xs text-amber-300">{problem}</p>}
        <button type="submit" disabled={busy || !!problem || !current || !next || next !== confirm} className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-sm disabled:opacity-50">
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
      {result && (result.ok ? <p role="status" className="text-xs text-emerald-300">{result.message}</p> : <ErrorState message={result.message} />)}
    </section>
  );
};

const Accounts: React.FC = () => {
  const [load, setLoad] = useState<{ state: 'loading' } | { state: 'ok'; users: User[] } | { state: 'error'; message: string }>({ state: 'loading' });
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'student' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await api.listUsers();
    setLoad(r.success && r.data ? { state: 'ok', users: r.data } : { state: 'error', message: r.message || 'Could not load accounts.' });
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const r = await api.createUser(form);
    setBusy(false);
    if (r.success && r.data) {
      setResult({ ok: true, message: `Account ${r.data.username} created (${r.data.role}). Give the password to its owner through a private channel.` });
      setForm({ username: '', email: '', password: '', role: 'student' });
      refresh();
    } else {
      setResult({ ok: false, message: r.message || 'Could not create the account.' });
    }
  };

  return (
    <section aria-label="Accounts" className="p-5 rounded-2xl border border-slate-800 space-y-4">
      <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-300" aria-hidden="true" /> Accounts (administrator)
      </h2>
      {load.state === 'loading' ? (
        <LoadingState label="Loading accounts…" />
      ) : load.state === 'error' ? (
        <ErrorState message={load.message} />
      ) : load.users.length === 0 ? (
        <EmptyState title="No accounts" />
      ) : (
        <table className="w-full text-left text-xs" aria-label="Account list">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-2">Username</th>
              <th className="py-1 pr-2">Email</th>
              <th className="py-1">Role</th>
            </tr>
          </thead>
          <tbody>
            {load.users.map((u) => (
              <tr key={u.id} className="border-t border-slate-800 text-slate-300">
                <td className="py-1 pr-2">{u.username}</td>
                <td className="py-1 pr-2">{u.email}</td>
                <td className="py-1">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={create} className="space-y-2" aria-label="Create account">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1">
          <UserPlus className="w-3.5 h-3.5" aria-hidden="true" /> Create an account
        </h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block text-xs text-slate-400">
            Username
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={input} />
          </label>
          <label className="block text-xs text-slate-400">
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          </label>
          <label className="block text-xs text-slate-400">
            Password (at least {MIN_PASSWORD} characters)
            <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input} />
          </label>
          <label className="block text-xs text-slate-400">
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
              <option value="student">student</option>
              <option value="evaluator">evaluator</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={busy || !form.username || !form.email || !form.password} className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-sm disabled:opacity-50">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      {result && (result.ok ? <p role="status" className="text-xs text-emerald-300">{result.message}</p> : <ErrorState message={result.message} />)}
    </section>
  );
};
