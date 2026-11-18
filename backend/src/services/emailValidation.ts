/**
 * Email address checks (P22).
 *
 * Neither check proves that a mailbox exists or belongs to the user: only entering the code sent to
 * the address does (otpService). The syntax check rejects malformed input; the DNS check rejects
 * only domains that definitely cannot receive mail (the domain does not exist, or publishes a
 * "null MX"). Inconclusive DNS answers (timeouts, server failures) never reject an address.
 *
 * Disposable-address detection is deliberately not implemented: lists go stale quickly and block
 * legitimate users, and ownership is confirmed by the code anyway.
 */
import dns from 'dns';

const MAX_EMAIL = 254;
const MAX_LOCAL = 64;
// Dot-atom local part (letters, digits and the common specials), no leading/trailing/double dots.
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
// Hostname labels of letters, digits and hyphens; a top-level label of at least two letters.
const LABEL_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;

/** Returns a message when the address is not acceptable, otherwise null. */
export function emailSyntaxProblem(raw: string): string | null {
  const email = String(raw ?? '').trim();
  const bad = 'Enter a valid email address, for example name@example.org.';
  if (!email || email.length > MAX_EMAIL) return bad;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return bad;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > MAX_LOCAL || !LOCAL_RE.test(local)) return bad;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return bad;
  if (!/^[A-Za-z]{2,63}$/.test(labels[labels.length - 1])) return bad;
  return null;
}

export type DomainCheck =
  | { verdict: 'accepts-mail' }
  | { verdict: 'no-mail'; reason: string }
  | { verdict: 'inconclusive'; reason: string };

/** The DNS lookups used, injectable for tests. */
export interface MailResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), ms)),
  ]);
}

/**
 * Checks whether the domain can receive mail. MX records (RFC 5321); without MX, an address record
 * means the host itself receives mail (implicit MX); a single "." MX is a null MX (RFC 7505).
 */
export async function checkMailDomain(
  email: string,
  resolver: MailResolver = dns.promises,
  timeoutMs = 3000
): Promise<DomainCheck> {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  try {
    const mx = await withTimeout(resolver.resolveMx(domain), timeoutMs);
    if (mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.')) {
      return { verdict: 'no-mail', reason: 'The email domain does not accept mail.' };
    }
    if (mx.length > 0) return { verdict: 'accepts-mail' };
  } catch (err: any) {
    if (!NOT_FOUND.has(err?.code)) return { verdict: 'inconclusive', reason: `MX lookup failed (${err?.code || 'error'})` };
  }
  // No MX: an A/AAAA record still makes the domain a valid mail destination.
  const codes: string[] = [];
  for (const lookup of [resolver.resolve4.bind(resolver), resolver.resolve6.bind(resolver)]) {
    try {
      const addrs = await withTimeout(lookup(domain), timeoutMs);
      if (addrs.length > 0) return { verdict: 'accepts-mail' };
    } catch (err: any) {
      codes.push(err?.code || 'error');
      if (!NOT_FOUND.has(err?.code)) return { verdict: 'inconclusive', reason: `Address lookup failed (${err?.code || 'error'})` };
    }
  }
  return { verdict: 'no-mail', reason: 'The email domain does not exist or cannot receive mail.' };
}

/** Whether the DNS check runs (EMAIL_DNS_CHECK=false turns it off; off in tests). */
export function dnsCheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.EMAIL_DNS_CHECK === 'false') return false;
  if (env.EMAIL_DNS_CHECK === 'true') return true;
  return env.NODE_ENV !== 'test';
}
