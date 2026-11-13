import dotenv from 'dotenv';
import path from 'path';
import { resolveJwtSecret } from './secrets';

// Load .env from root or backend directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// No hardcoded secrets (M1.1): production refuses to start without a strong JWT_SECRET.
const jwt = resolveJwtSecret(process.env);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  // Comma-separated browser origins allowed to call the API (M1.6). Defaults to local dev servers.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173',
  jwtSecret: jwt.secret,
  jwtSecretSource: jwt.source,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  
  // Electricity Maps Live API Key
  electricityMapsApiKey: process.env.ELECTRICITY_MAPS_API_KEY || '',
  
  // Storage Configuration
  storageType: (process.env.STORAGE_TYPE || 'local') as 'local' | 's3',
  localStorageDir: process.env.LOCAL_STORAGE_DIR || path.resolve(__dirname, '../../uploads'),
  
  // S3 / Compatible Object Storage (AWS S3, MinIO, Cloudflare R2)
  s3: {
    endpoint: process.env.AWS_ENDPOINT || undefined,
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: process.env.AWS_BUCKET_NAME || 'carbonroute-presentations',
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  },

  // Initial admin account, created only when the user table is empty. There is no default
  // password: ADMIN_PASSWORD must be set (and strong) for the account to be created.
  initialAdmin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@carbonroute.org',
    password: process.env.ADMIN_PASSWORD?.trim() || undefined,
  }
};
