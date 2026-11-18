/**
 * Server entry point: starts the HTTP listener for the Express app defined in app.ts.
 * Kept as index.ts so `npm start`, `npm run dev` and the Docker CMD (dist/index.js) are unchanged.
 *
 * P22: when DATABASE_URL is set, the durable store is connected and loaded before the server
 * accepts requests. If it is set but cannot be reached, the server does not start: silently
 * falling back to an ephemeral disk would lose every change made afterwards.
 */
import app from './app';
import { config } from './config';
import { connectDurableStoreFromEnv, persistenceStatus } from './persistence/durableStore';
import { loadFromDurableStore } from './persistence/bootstrap';
import { emailProvider } from './services/emailProvider';

async function start() {
  try {
    const store = await connectDurableStoreFromEnv();
    if (store) {
      const loaded = await loadFromDurableStore(store);
      console.log(`🗄️  Durable store: PostgreSQL (database ${loaded.main}, scheduling ${loaded.scheduling})`);
    }
  } catch (err: any) {
    // The message never includes the connection string.
    console.error(`[persistence] DATABASE_URL is set but the database could not be used: ${err?.code || ''} ${err?.message || err}`);
    process.exit(1);
  }

  const PORT = config.port;
  const persistence = persistenceStatus();
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 CarbonRoute Backend Server running on port ${PORT}`);
    console.log(`📡 Environment: ${config.env}`);
    console.log(`📦 Storage: ${persistence.mode}${persistence.durable ? ' (durable)' : ' (NOT durable on ephemeral hosts)'}`);
    console.log(`✉️  Email delivery: ${emailProvider().name}`);
    console.log(`🔐 Admin: ${config.initialAdmin.username} (${config.initialAdmin.email})`);
    console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
    console.log(`====================================================`);
  });
}

start();

export default app;
