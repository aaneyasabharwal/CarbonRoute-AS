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

// Security Headers with allowance for cross-origin PDF preview frames and storage streaming
app.use(
  helmet({
    frameguard: false, // Allows PDF to be embedded in iframes on Vercel
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // Allows embedded iframe PDF views across domains
  })
);

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) return callback(null, true);
      return callback(null, true);
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
