/**
 * P22: email verification step shown after a correct password on an unverified account.
 * The code is checked by the backend only; this component never sees or stores a code it did not
 * receive from the user.
 */
import React, { useEffect, useState } from 'react';
import { MailCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import type { EmailVerificationChallenge, User } from '../types';

interface Props {
  challenge: EmailVerificationChallenge;
  /** Called with the session once the code is accepted. */
  onVerified: (token: string, user: User) => void;
  onCancel: () => void;
}

const deliveryTone = (d: EmailVerificationChallenge['delivery']) =>
  d === 'sent' ? 'text-emerald-300' : d === 'simulated' ? 'text-amber-300' : d === 'rate-limited' ? 'text-slate-300' : 'text-rose-300';

export const EmailVerification: React.FC<Props> = ({ challenge, onVerified, onCancel }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; delivery: EmailVerificationChallenge['delivery'] }>({
    text: challenge.detail || '',
    delivery: challenge.delivery,
  });
  const [wait, setWait] = useState<number>(challenge.retryAfterSeconds ?? 0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api.confirmVerificationCode(challenge.verificationTicket, code.trim());
    setBusy(false);
    if (r.success && r.token && r.user) {
      onVerified(r.token, r.user);
      return;
    }
    if (r.code === 'ALREADY_VERIFIED') {
      setError('This address is already verified. Go back and sign in.');
      return;
    }
    setError(r.message || 'The code could not be verified.');
    if (r.code === 'OTP_EXPIRED' || r.code === 'OTP_TOO_MANY_ATTEMPTS' || r.code === 'OTP_NO_CODE') setCode('');
    if (r.code === 'INVALID_TICKET') setStatus({ text: 'This verification session has expired. Go back and sign in again.', delivery: 'failed' });
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    const r = await api.resendVerificationCode(challenge.verificationTicket);
    setBusy(false);
    setStatus({ text: r.detail || r.message || '', delivery: r.delivery || (r.success ? 'sent' : 'failed') });
    if (r.retryAfterSeconds) setWait(r.retryAfterSeconds);
    if (!r.success && r.code !== 'RATE_LIMITED') setError(r.message || 'Could not send a new code.');
  };

  return (
    <div className="space-y-4 font-mono text-xs" data-testid="email-verification">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
          <MailCheck className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-white">Verify your email</h1>
        <p className="text-slate-400">
          Your account ({challenge.maskedEmail}) is not verified yet. Enter the 6-digit code sent to that address. Codes expire after 5 minutes
          and work once.
        </p>
      </div>

      {status.text && (
        <p role="status" data-testid="verification-delivery" className={`p-3 rounded-lg border border-slate-800 bg-slate-900/60 ${deliveryTone(status.delivery)}`}>
          {status.text}
        </p>
      )}

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <label className="block text-slate-300 font-semibold">
          Verification code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            aria-label="6-digit verification code"
            className="mt-1 w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white text-lg tracking-[0.4em] text-center focus:outline-none focus:border-emerald-500"
          />
        </label>
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="w-full py-2.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Verify and sign in'}
        </button>
      </form>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={resend}
          disabled={busy || wait > 0}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-900 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white">
          Back to sign in
        </button>
      </div>
    </div>
  );
};
