/**
 * Rotates a user's password in the JSON database (M1.1).
 *
 * The former default admin password was published in this repository, so any database that
 * was seeded with it must be rotated:
 *
 *   NEW_ADMIN_PASSWORD='<new password>' npm run admin:set-password            # user "admin"
 *   ADMIN_USERNAME=alice NEW_ADMIN_PASSWORD='<new password>' npm run admin:set-password
 *
 * The password is read from an environment variable (not a command-line argument, which can
 * end up in shell history or process listings) and is never printed. Run it while the server
 * is stopped, then restart the server.
 */
import type { User } from '../models/db';

export interface PasswordStore {
  setUserPassword(username: string, newPassword: string, performedBy?: string): User;
}

export function runSetAdminPassword(env: NodeJS.ProcessEnv, store: PasswordStore, log: (msg: string) => void = console.log): number {
  const username = (env.ADMIN_USERNAME || 'admin').trim();
  const password = env.NEW_ADMIN_PASSWORD;
  if (!password) {
    log('NEW_ADMIN_PASSWORD is not set. Nothing was changed.');
    return 2;
  }
  try {
    const user = store.setUserPassword(username, password, 'admin:set-password');
    log(`Password updated for user "${user.username}". Restart the server if it is running.`);
    return 0;
  } catch (err: any) {
    log(`Password not changed: ${err?.message || 'unknown error'}`);
    return 1;
  }
}

if (require.main === module) {
  // Loaded lazily so tests can import runSetAdminPassword without opening the database.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../models/db');
  process.exit(runSetAdminPassword(process.env, db));
}
