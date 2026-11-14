/**
 * Internal-error responses (P8 security review). Unexpected exceptions are logged on the server with a
 * reference id, and the client receives only a generic message and that id: never the exception text,
 * which can contain file paths, stack details or provider internals.
 */
import type { Response } from 'express';
import { randomBytes } from 'crypto';

export function internalError(res: Response, err: unknown, context: string, publicMessage = 'Internal server error.') {
  const ref = randomBytes(4).toString('hex');
  console.error(`[${ref}] ${context}:`, err);
  return res.status(500).json({ success: false, message: `${publicMessage} (reference ${ref})`, reference: ref });
}
