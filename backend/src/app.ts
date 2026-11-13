/**
 * Express application factory (no network listener).
 * Imported by index.ts (server entry) and by the test suite (supertest).
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import apiRouter from './routes/api';

const app = express();

// Behind a reverse proxy (e.g. Render) set TRUST_PROXY=1 so req.ip is the client address used
// by the rate limits. Off by default, so X-Forwarded-For cannot be spoofed to evade limits.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

/**
 * Browser origins allowed to call the API with credentials (M1.6): CORS_ORIGIN, a
 * comma-separated list. Requests without an Origin header (curl, same-origin) are allowed.
 */
export const allowedOrigins: string[] = config.corsOrigin
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Security headers (M1.7). The CSP applies to the frontend this server can serve and to every
// API response. PDFs from /api/storage are embedded by the frontend, so framing is allowed
// only for this origin and the CORS allow-list (frame-ancestors), not for any site.
app.use(
  helmet({
    frameguard: false, // replaced by the frame-ancestors allow-list below
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", ...allowedOrigins],
        frameSrc: ["'self'", 'blob:', 'https://docs.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", ...allowedOrigins],
      },
    },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      // A disallowed origin gets no Access-Control-Allow-Origin header, so browsers block it.
      return callback(null, allowedOrigins.includes(origin.replace(/\/$/, '')));
    },
    credentials: true,
  })
);

// Logging & Body Parsers
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve API Routes
app.use('/api', apiRouter);

// Serve local uploads folder statically as fallback
app.use('/uploads', express.static(config.localStorageDir));

// Serve Frontend build in production if available
const frontendDistPath = fs.existsSync(path.resolve(__dirname, '../../frontend/dist'))
  ? path.resolve(__dirname, '../../frontend/dist')
  : fs.existsSync(path.resolve(process.cwd(), '../frontend/dist'))
  ? path.resolve(process.cwd(), '../frontend/dist')
  : path.resolve(process.cwd(), 'frontend/dist');

app.use(express.static(frontendDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  const indexPath = path.join(frontendDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

// Generic 404 Handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found.',
  });
});

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error occurred.',
  });
});

export default app;
