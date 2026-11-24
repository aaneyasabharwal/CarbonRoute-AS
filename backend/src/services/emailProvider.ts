/**
 * Email delivery (P22), behind one small interface so the provider can change without touching the
 * verification logic.
 *
 * - brevo: Brevo transactional email over HTTPS (free plan, 300 emails/day, no card). Render Free
 *   blocks outbound SMTP ports 25/465/587, so an HTTPS API is required there.
 * - gmail-script: Gmail through the owner's Google Apps Script web app over HTTPS (free, no card).
 * - console: development only. Nothing is sent; the message is printed to the server console with a
 *   clear label. Refused when NODE_ENV=production, so it can never be a production bypass.
 * - none: no provider; every send reports `not-configured` (never "sent").
 *
 * Configuration (backend environment only): EMAIL_PROVIDER, BREVO_API_KEY, EMAIL_FROM,
 * EMAIL_FROM_NAME. Keys and codes are never logged; provider errors are logged without the body.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult =
  | { status: 'sent'; provider: string; messageId?: string }
  /** Development only: nothing left the server. */
  | { status: 'simulated'; provider: 'console' }
  | { status: 'failed'; provider: string; error: string }
  | { status: 'not-configured'; provider: 'none'; error: string };

export interface EmailProvider {
  readonly name: string;
  /** True only when real email can leave the server. */
  readonly delivers: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}

export class NoEmailProvider implements EmailProvider {
  readonly name = 'none';
  readonly delivers = false;
  constructor(private readonly reason = 'Email delivery is not configured on this server.') {}
  async send(): Promise<SendResult> {
    return { status: 'not-configured', provider: 'none', error: this.reason };
  }
}

/** Development/test only: keeps messages in memory and prints a labelled notice. Sends nothing. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  readonly delivers = false;
  readonly outbox: EmailMessage[] = [];
  constructor(private readonly print = true) {}
  async send(message: EmailMessage): Promise<SendResult> {
    this.outbox.push(message);
    if (this.outbox.length > 50) this.outbox.shift();
    if (this.print) {
      console.log(`[DEV EMAIL - NOT SENT] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
    return { status: 'simulated', provider: 'console' };
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo';
  readonly delivers = true;
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 10_000
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const res = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: this.fromEmail, name: this.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return { status: 'sent', provider: this.name, messageId: body?.messageId };
      // Brevo's error code only (e.g. "unauthorized", "invalid_parameter"); never the request.
      const code = typeof body?.code === 'string' ? body.code : 'error';
      return { status: 'failed', provider: this.name, error: `Provider rejected the message (HTTP ${res.status}, ${code}).` };
    } catch (err: any) {
      return { status: 'failed', provider: this.name, error: err?.name === 'TimeoutError' ? 'Provider timed out.' : 'Provider not reachable.' };
    }
  }
}

/**
 * Gmail through a Google Apps Script web app that the account owner deploys under their own Google
 * account (see docs/gmail-apps-script.gs). Free (about 100 recipients a day on a personal Gmail),
 * HTTPS only, and mail comes from a real Gmail address, so it reaches inboxes well. The script refuses
 * any request without the shared secret. Apps Script answers a POST with a redirect to the result,
 * which fetch follows.
 */
export class GmailScriptEmailProvider implements EmailProvider {
  readonly name = 'gmail-script';
  readonly delivers = true;
  constructor(
    private readonly scriptUrl: string,
    private readonly secret: string,
    private readonly fromName: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 20_000
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const res = await this.fetchImpl(this.scriptUrl, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          secret: this.secret,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          fromName: this.fromName,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok === true) return { status: 'sent', provider: this.name };
      // The script's own error code only (e.g. "unauthorized", "quota"); never the request.
      const code = typeof body?.code === 'string' ? body.code.slice(0, 40) : body ? 'error' : 'not_json (is the web app deployed with access "Anyone"?)';
      return { status: 'failed', provider: this.name, error: `Gmail script refused the message (HTTP ${res.status}, ${code}).` };
    } catch (err: any) {
      return { status: 'failed', provider: this.name, error: err?.name === 'TimeoutError' ? 'Gmail script timed out.' : 'Gmail script not reachable.' };
    }
  }
}

/** Builds the provider from the environment. Never throws; misconfiguration means "none". */
export function emailProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const kind = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const production = env.NODE_ENV === 'production';
  if (kind === 'brevo') {
    const key = env.BREVO_API_KEY?.trim();
    const from = env.EMAIL_FROM?.trim();
    if (!key || !from) {
      console.warn('[email] EMAIL_PROVIDER=brevo but BREVO_API_KEY or EMAIL_FROM is missing. Email delivery is OFF.');
      return new NoEmailProvider('Email delivery is not configured on this server (provider credentials missing).');
    }
    return new BrevoEmailProvider(key, from, env.EMAIL_FROM_NAME?.trim() || 'CarbonRoute');
  }
  if (kind === 'gmail-script' || kind === 'gmail') {
    const url = env.GMAIL_SCRIPT_URL?.trim();
    const secret = env.GMAIL_SCRIPT_SECRET?.trim();
    if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) || !secret || secret.length < 16) {
      console.warn(
        '[email] EMAIL_PROVIDER=gmail-script but GMAIL_SCRIPT_URL (https://script.google.com/macros/s/.../exec) or GMAIL_SCRIPT_SECRET (16+ characters) is missing or malformed. Email delivery is OFF.'
      );
      return new NoEmailProvider('Email delivery is not configured on this server (Gmail script settings missing).');
    }
    return new GmailScriptEmailProvider(url, secret, env.EMAIL_FROM_NAME?.trim() || 'CarbonRoute');
  }
  if (kind === 'console') {
    if (production) {
      console.warn('[email] EMAIL_PROVIDER=console is not allowed in production. Email delivery is OFF.');
      return new NoEmailProvider();
    }
    return new ConsoleEmailProvider(env.NODE_ENV !== 'test');
  }
  if (kind) console.warn(`[email] Unknown EMAIL_PROVIDER "${kind.slice(0, 30)}". Use gmail-script or brevo. Email delivery is OFF.`);
  return new NoEmailProvider();
}

let current: EmailProvider | null = null;
export function emailProvider(): EmailProvider {
  if (!current) current = emailProviderFromEnv();
  return current;
}
/** Replaces the provider (tests). */
export function setEmailProvider(p: EmailProvider | null): void {
  current = p;
}
