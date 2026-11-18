/**
 * Durable persistence (P22).
 *
 * The application keeps its records in two JSON documents (the main database and the scheduling
 * store) and uploaded files on the local disk. On Render Free the local disk is ephemeral: it is
 * wiped on every deploy, restart and spin-down (after 15 minutes without traffic). Writes were
 * committed correctly, but to a disk that does not survive, so accounts, uploads and deletions
 * reverted to the seed data.
 *
 * When DATABASE_URL is set, every document and uploaded file is also written to PostgreSQL (for
 * example a free Neon project, no card needed) and loaded from it at start-up. Without it the
 * server keeps the local-file behaviour and reports `durable: false` in /api/health, so nothing
 * claims persistence the infrastructure cannot give.
 *
 * Writes are queued per key (the newest version wins) and a mutating API request does not answer
 * until its writes have reached the database (see persistBeforeRespond in app.ts).
 */
import type { Pool as PgPool } from 'pg';

export interface StoredBlob {
  content: Buffer;
  mimeType: string;
  size: number;
}

export interface DurableStore {
  readonly kind: 'postgres';
  /** Creates the tables if needed. */
  init(): Promise<void>;
  getDocument<T>(key: string): Promise<T | null>;
  putDocument(key: string, doc: unknown): Promise<void>;
  putBlob(key: string, blob: StoredBlob): Promise<void>;
  getBlob(key: string): Promise<StoredBlob | null>;
  deleteBlob(key: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Minimal part of pg.Pool used here, so tests can pass pg-mem's adapter. */
type Queryable = Pick<PgPool, 'query' | 'end'>;

export class PostgresDurableStore implements DurableStore {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: Queryable) {}

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS carbonroute_documents (
         key TEXT PRIMARY KEY,
         doc JSONB NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL
       )`
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS carbonroute_blobs (
         key TEXT PRIMARY KEY,
         content BYTEA NOT NULL,
         mime_type TEXT NOT NULL,
         size INTEGER NOT NULL,
         created_at TIMESTAMPTZ NOT NULL
       )`
    );
  }

  async getDocument<T>(key: string): Promise<T | null> {
    const r = await this.pool.query('SELECT doc FROM carbonroute_documents WHERE key = $1', [key]);
    if (!r.rows.length) return null;
    const doc = r.rows[0].doc;
    return (typeof doc === 'string' ? JSON.parse(doc) : doc) as T;
  }

  async putDocument(key: string, doc: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO carbonroute_documents (key, doc, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at`,
      [key, JSON.stringify(doc), new Date().toISOString()]
    );
  }

  async putBlob(key: string, blob: StoredBlob): Promise<void> {
    await this.pool.query(
      `INSERT INTO carbonroute_blobs (key, content, mime_type, size, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, mime_type = EXCLUDED.mime_type,
         size = EXCLUDED.size, created_at = EXCLUDED.created_at`,
      [key, blob.content, blob.mimeType, blob.size, new Date().toISOString()]
    );
  }

  async getBlob(key: string): Promise<StoredBlob | null> {
    const r = await this.pool.query('SELECT content, mime_type, size FROM carbonroute_blobs WHERE key = $1', [key]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { content: Buffer.from(row.content), mimeType: row.mime_type, size: Number(row.size) };
  }

  async deleteBlob(key: string): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM carbonroute_blobs WHERE key = $1', [key]);
    return (r.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Serialises document writes: at most one write per key in flight, and only the newest pending
 * version is written next. flush() resolves when everything scheduled so far is stored, and
 * rejects if any of those writes failed (the failure is reported once, to the request that waits).
 */
export class WriteQueue {
  private pending = new Map<string, () => unknown>();
  private running: Promise<void> | null = null;
  private failure: Error | null = null;

  constructor(private readonly store: DurableStore) {}

  schedule(key: string, snapshot: () => unknown): void {
    this.pending.set(key, snapshot);
    if (!this.running) this.running = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending.size) {
        const [key, snapshot] = this.pending.entries().next().value as [string, () => unknown];
        this.pending.delete(key);
        try {
          await this.store.putDocument(key, snapshot());
        } catch (err: any) {
          this.failure = err instanceof Error ? err : new Error(String(err));
          console.error(`[persistence] write of "${key}" failed: ${this.failure.message}`);
        }
      }
    } finally {
      this.running = null;
    }
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
    if (this.failure) {
      const err = this.failure;
      this.failure = null;
      throw err;
    }
  }
}

export interface PersistenceStatus {
  mode: 'postgres' | 'local-file';
  durable: boolean;
  /** Process start time; a change means the server restarted. */
  startedAt: string;
  note: string;
}

const STARTED_AT = new Date().toISOString();

let durable: DurableStore | null = null;
let queue: WriteQueue | null = null;

/** The durable store, or null when only the local disk is used. */
export function durableStore(): DurableStore | null {
  return durable;
}

/** Schedules a document write to the durable store (no-op without one). */
export function scheduleDocumentWrite(key: string, snapshot: () => unknown): void {
  queue?.schedule(key, snapshot);
}

/** Waits until every scheduled write is stored; rejects if one failed. */
export async function flushDurableWrites(): Promise<void> {
  if (queue) await queue.flush();
}

/** Installs a store (start-up and tests). Passing null returns to local-file mode. */
export function setDurableStore(store: DurableStore | null): void {
  durable = store;
  queue = store ? new WriteQueue(store) : null;
}

export function persistenceStatus(): PersistenceStatus {
  return durable
    ? {
        mode: 'postgres',
        durable: true,
        startedAt: STARTED_AT,
        note: 'Accounts, resources, jobs and uploaded files are stored in PostgreSQL and survive restarts and redeploys.',
      }
    : {
        mode: 'local-file',
        durable: false,
        startedAt: STARTED_AT,
        note:
          'Data is stored on this server\'s local disk. On hosts with an ephemeral disk (Render Free) accounts, uploads and deletions are lost on every restart, redeploy and spin-down. Set DATABASE_URL for durable storage.',
      };
}

/** Opens the PostgreSQL store named by DATABASE_URL (null when it is not set). */
export async function connectDurableStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<DurableStore | null> {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  // Loaded only when configured, so local development and tests do not need a database.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg') as typeof import('pg');
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 3,
    ssl: local || env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: true },
  });
  const store = new PostgresDurableStore(pool);
  await store.init();
  return store;
}
