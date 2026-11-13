import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

export interface StoredFileResult {
  fileName: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  sha256Checksum: string;
}

export interface IStorageProvider {
  saveFile(file: Express.Multer.File, category: 'presentations' | 'resources'): Promise<StoredFileResult>;
  getFileStream(category: string, fileName: string): Promise<{ stream: NodeJS.ReadableStream; mimeType?: string; fileSize?: number }>;
  deleteFile(category: string, fileName: string): Promise<boolean>;
  getDownloadUrl(category: string, fileName: string): Promise<string>;
}

/** The only storage categories that exist (S1 / M1.5). Anything else is rejected. */
export const STORAGE_CATEGORIES = ['presentations', 'resources'] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

export class StorageAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageAccessError';
  }
}

/**
 * Validates a category and file name from a request (S1 / M1.5: path traversal). The
 * category must be on the allow-list and the file name must be a single plain path segment
 * (no separators, no "." or "..", no control characters).
 */
export function safeStorageRef(category: string, fileName: string): { category: StorageCategory; fileName: string } {
  if (!(STORAGE_CATEGORIES as readonly string[]).includes(category)) throw new StorageAccessError('Unknown storage category.');
  const name = String(fileName);
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) || path.basename(name) !== name) {
    throw new StorageAccessError('Invalid file name.');
  }
  return { category: category as StorageCategory, fileName: name };
}

export class LocalStorageProvider implements IStorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = config.localStorageDir;
    this.ensureDirs();
  }

  private ensureDirs() {
    const presentationsDir = path.join(this.baseDir, 'presentations');
    const resourcesDir = path.join(this.baseDir, 'resources');
    fs.mkdirSync(presentationsDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  async saveFile(file: Express.Multer.File, category: 'presentations' | 'resources'): Promise<StoredFileResult> {
    this.ensureDirs();
    const timestamp = Date.now();
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueFileName = `${timestamp}-${cleanOriginalName}`;
    const destinationPath = path.join(this.baseDir, category, uniqueFileName);

    // Calculate sha256 checksum
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Write file to disk
    await fs.promises.writeFile(destinationPath, file.buffer);

    const relativePath = path.posix.join('uploads', category, uniqueFileName);
    const fileUrl = `/api/storage/${category}/${uniqueFileName}`;

    return {
      fileName: uniqueFileName,
      originalName: file.originalname,
      filePath: relativePath,
      fileSize: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      fileUrl,
      sha256Checksum: hash,
    };
  }

  /** Absolute path for a validated reference; also checks it stays inside the category folder. */
  private resolvePath(category: string, fileName: string): string {
    const ref = safeStorageRef(category, fileName);
    const dir = path.resolve(this.baseDir, ref.category);
    const filePath = path.resolve(dir, ref.fileName);
    if (path.dirname(filePath) !== dir) throw new StorageAccessError('Invalid file path.');
    return filePath;
  }

  async getFileStream(category: string, fileName: string): Promise<{ stream: NodeJS.ReadableStream; mimeType?: string; fileSize?: number }> {
    const filePath = this.resolvePath(category, fileName);
    const safeFileName = path.basename(filePath);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${category}/${safeFileName}`);
    }

    const stat = await fs.promises.stat(filePath);
    const stream = fs.createReadStream(filePath);
    return { stream, fileSize: stat.size };
  }

  async deleteFile(category: string, fileName: string): Promise<boolean> {
    const filePath = this.resolvePath(category, fileName);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
    return false;
  }

  async getDownloadUrl(category: string, fileName: string): Promise<string> {
    const ref = safeStorageRef(category, fileName);
    return `/api/storage/${ref.category}/${encodeURIComponent(ref.fileName)}`;
  }
}

export class S3StorageProvider implements IStorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.s3.bucketName;
    this.client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    });
  }

  async saveFile(file: Express.Multer.File, category: 'presentations' | 'resources'): Promise<StoredFileResult> {
    const timestamp = Date.now();
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `${category}/${timestamp}-${cleanOriginalName}`;
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        originalName: cleanOriginalName,
        sha256: hash,
      },
    });

    await this.client.send(command);

    const fileUrl = `/api/storage/${key}`;

    return {
      fileName: `${timestamp}-${cleanOriginalName}`,
      originalName: file.originalname,
      filePath: key,
      fileSize: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      fileUrl,
      sha256Checksum: hash,
    };
  }

  async getFileStream(category: string, fileName: string): Promise<{ stream: NodeJS.ReadableStream; mimeType?: string; fileSize?: number }> {
    const ref = safeStorageRef(category, fileName);
    const key = `${ref.category}/${ref.fileName}`;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Failed to read object from S3: ${key}`);
    }

    return {
      stream: response.Body as NodeJS.ReadableStream,
      mimeType: response.ContentType,
      fileSize: response.ContentLength,
    };
  }

  async deleteFile(category: string, fileName: string): Promise<boolean> {
    const ref = safeStorageRef(category, fileName);
    const key = `${ref.category}/${ref.fileName}`;
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
    return true;
  }

  async getDownloadUrl(category: string, fileName: string): Promise<string> {
    const ref = safeStorageRef(category, fileName);
    const key = `${ref.category}/${ref.fileName}`;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}

export const storageProvider: IStorageProvider =
  config.storageType === 's3' && config.s3.accessKeyId
    ? new S3StorageProvider()
    : new LocalStorageProvider();
