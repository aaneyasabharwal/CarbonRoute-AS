/**
 * Creates a user account in the JSON database (M1.2). Jobs are owned by the user who
 * creates them, so team members and evaluators each need their own account.
 *
 *   NEW_USER_USERNAME=alice NEW_USER_EMAIL=alice@example.org NEW_USER_ROLE=student \
 *   NEW_USER_PASSWORD='<password>' npm run user:create
 *
 * Roles: student, evaluator, admin. The password is read from an environment variable
 * (never a command-line argument) and is never printed. Run it while the server is stopped.
 */
import type { User, UserRole } from '../models/db';

export interface UserStore {
  createUser(input: { username: string; email: string; password: string; role: UserRole }, performedBy?: string): User;
}

export function runCreateUser(env: NodeJS.ProcessEnv, store: UserStore, log: (msg: string) => void = console.log): number {
  const username = env.NEW_USER_USERNAME?.trim();
  const email = env.NEW_USER_EMAIL?.trim();
  const role = (env.NEW_USER_ROLE?.trim() || 'student') as UserRole;
  const password = env.NEW_USER_PASSWORD;
  if (!username || !email || !password) {
    log('Set NEW_USER_USERNAME, NEW_USER_EMAIL and NEW_USER_PASSWORD (and optionally NEW_USER_ROLE). Nothing was changed.');
    return 2;
  }
  try {
    const user = store.createUser({ username, email, password, role }, 'user:create');
    log(`Created user "${user.username}" with role ${user.role}.`);
    return 0;
  } catch (err: any) {
    log(`User not created: ${err?.message || 'unknown error'}`);
    return 1;
  }
}

if (require.main === module) {
  // Loaded lazily so tests can import runCreateUser without opening the database.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../models/db');
  process.exit(runCreateUser(process.env, db));
}
