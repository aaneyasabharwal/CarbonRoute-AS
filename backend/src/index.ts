/**
 * Server entry point: starts the HTTP listener for the Express app defined in app.ts.
 * Kept as index.ts so `npm start`, `npm run dev` and the Docker CMD (dist/index.js) are unchanged.
 */
import app from './app';
import { config } from './config';

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 CarbonRoute Backend Server running on port ${PORT}`);
  console.log(`📡 Environment: ${config.env}`);
  console.log(`📦 Storage Provider: ${config.storageType.toUpperCase()}`);
  console.log(`🔐 Admin: ${config.initialAdmin.username} (${config.initialAdmin.email})`);
  console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
  console.log(`====================================================`);
});

export default app;
