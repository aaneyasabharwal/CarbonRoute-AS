/**
 * P22 regression tests: accounts and resources persist.
 *
 * Root cause of the staging bug: every write was committed, but to a disk that Render Free wipes on
 * each restart, redeploy and spin-down. These tests run the real API and simulate restarts:
 *   - "restart" = a fresh module graph (new process state) reading the same storage;
 *   - "wiped disk" = the database file and uploads folder are deleted first, as on Render Free.
 * The durable store is PostgreSQL in production; here pg-mem provides an in-memory PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import request from 'supertest';
import { newDb } from 'pg-mem';
import type { Express } from 'express';
import { testAdminCredentials } from '../support/auth';

const dbFile = () => process.env.CARBONROUTE_DB_FILE as string;
const uploadsDir = () => process.env.LOCAL_STORAGE_DIR as string;
// A fixed secret, as on a real server, so tokens stay valid across simulated restarts.
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

/** The test admin row written by test/setup.ts, kept to re-create a wiped disk like Render does. */
const initialFile = fs.readFileSync(dbFile(), 'utf8');

function wipeDisk() {
  fs.rmSync(path.dirname(dbFile()), { recursive: true, force: true });
  fs.rmSync(uploadsDir(), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
  fs.writeFileSync(dbFile(), initialFile);
}

function newPgPool() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

const initialised = new WeakSet<object>();

/** Starts the app as a fresh process would, optionally connected to a durable store. */
async function startServer(pool?: unknown): Promise<Express> {
  vi.resetModules();
  const app = (await import('../../src/app')).default;
  if (pool) {
    const { PostgresDurableStore } = await import('../../src/persistence/durableStore');
    const { loadFromDurableStore } = await import('../../src/persistence/bootstrap');
    const store = new PostgresDurableStore(pool as never);
    // pg-mem cannot re-run CREATE TABLE IF NOT EXISTS with constraints; real PostgreSQL can.
    if (!initialised.has(pool as object)) {
      await store.init();
      initialised.add(pool as object);
    }
    await loadFromDurableStore(store);
  }
  return app;
}

async function adminAuth(app: Express) {
  const res = await request(app).post('/api/auth/login').send(testAdminCredentials());
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
}

const studentBody = (name: string) => ({ username: name, email: `${name}@example.org`, password: 'Student-pass-1234', role: 'student' });

async function createStudent(app: Express, auth: Record<string, string>, name: string) {
  const r = await request(app).post('/api/admin/users').set(auth).send(studentBody(name));
  expect(r.status).toBe(201);
  return r.body.data as { id: string; username: string };
}

async function uploadResource(app: Express, auth: Record<string, string>, title: string, content = `content of ${title}`) {
  const r = await request(app)
    .post('/api/resources/upload')
    .set(auth)
    .field('title', title)
    .field('category', 'documentation')
    .attach('file', Buffer.from(content), `${title}.txt`);
  expect(r.status).toBe(201);
  return r.body.data as { id: string; fileUrl: string; title: string };
}

const usernames = async (app: Express, auth: Record<string, string>) =>
  (await request(app).get('/api/admin/users').set(auth)).body.data.map((u: { username: string }) => u.username) as string[];
const resourceIds = async (app: Express, auth: Record<string, string>) =>
  (await request(app).get('/api/resources/all').set(auth)).body.data.map((r: { id: string }) => r.id) as string[];
/** A presentation that may be deleted (not the protected v1 planning baseline). */
const deletablePresentation = async (app: Express) =>
  ((await request(app).get('/api/presentations/versions')).body.data as { id: string; versionTag: string; deliverableType: string }[]).find(
    (p) => !(p.versionTag === 'v1' && p.deliverableType === 'planning')
  )!.id;
const presentationIds = async (app: Express) =>
  (await request(app).get('/api/presentations/versions')).body.data.map((p: { id: string }) => p.id) as string[];

beforeEach(() => {
  wipeDisk();
});

describe('accounts and resources in one server process (a page refresh)', () => {
  it('a created account is returned by fresh requests and can be retrieved by id from the list', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    const s = await createStudent(app, auth, 'stud-refresh');
    // A refresh is a new request; nothing comes from frontend state.
    expect(await usernames(app, auth)).toContain('stud-refresh');
    expect((await request(app).get('/api/admin/users').set(auth)).body.data.find((u: { id: string }) => u.id === s.id)).toMatchObject({
      username: 'stud-refresh',
      role: 'student',
      emailVerified: false,
    });
  });

  it('upload, re-fetch, delete and re-fetch: the deletion stays', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    const r = await uploadResource(app, auth, 'Design notes');
    expect(await resourceIds(app, auth)).toContain(r.id);
    expect((await request(app).get(r.fileUrl)).text).toBe('content of Design notes');
    expect((await request(app).delete(`/api/resources/${r.id}`).set(auth)).status).toBe(200);
    expect(await resourceIds(app, auth)).not.toContain(r.id);
    expect(await resourceIds(app, auth)).not.toContain(r.id);
  });

  it('the protected v1 planning presentation answers 409, not a server error', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    const all = (await request(app).get('/api/presentations/versions')).body.data as { id: string; versionTag: string; deliverableType: string }[];
    const v1 = all.find((p) => p.versionTag === 'v1' && p.deliverableType === 'planning')!;
    expect((await request(app).delete(`/api/presentations/versions/${v1.id}`).set(auth)).status).toBe(409);
    expect(await presentationIds(app)).toContain(v1.id);
  });

  it('failure cases: no file, missing title, unknown id, and no admin rights', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    expect((await request(app).post('/api/resources/upload').set(auth).field('title', 'x').field('category', 'c')).status).toBe(400);
    expect(
      (await request(app).post('/api/resources/upload').set(auth).field('category', 'c').attach('file', Buffer.from('x'), 'x.txt')).status
    ).toBe(400);
    expect((await request(app).delete('/api/resources/no-such-id').set(auth)).status).toBe(404);
    expect((await request(app).delete('/api/resources/no-such-id')).status).toBe(401);
    expect((await request(app).post('/api/admin/users').send(studentBody('anon'))).status).toBe(401);
  });

  it('API answers are never stored by the browser (Cache-Control: no-store)', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    for (const res of [
      await request(app).get('/api/resources'),
      await request(app).get('/api/resources/all').set(auth),
      await request(app).get('/api/admin/users').set(auth),
      await request(app).get('/api/presentations/versions'),
    ]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('server restart with the disk kept (local development, or a host with a persistent disk)', () => {
  it('accounts, uploads and deletions survive and sessions stay valid', async () => {
    let app = await startServer();
    const auth = await adminAuth(app);
    await createStudent(app, auth, 'stud-disk');
    const r = await uploadResource(app, auth, 'Kept');
    const victim = await deletablePresentation(app);
    expect((await request(app).delete(`/api/presentations/versions/${victim}`).set(auth)).status).toBe(200);

    app = await startServer();
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(200);
    expect(await usernames(app, auth)).toContain('stud-disk');
    expect(await resourceIds(app, auth)).toContain(r.id);
    expect(await presentationIds(app)).not.toContain(victim);
  });

  it('an unreadable database file is moved aside, never overwritten by the seed data', async () => {
    fs.writeFileSync(dbFile(), '{ "users": [ truncated');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await startServer();
    const aside = fs.readdirSync(path.dirname(dbFile())).filter((f) => f.includes('.unreadable-'));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(dbFile()), aside[0]), 'utf8')).toBe('{ "users": [ truncated');
    vi.restoreAllMocks();
  });

  it('writes are atomic: no temporary file is left behind', async () => {
    const app = await startServer();
    const auth = await adminAuth(app);
    await createStudent(app, auth, 'stud-atomic');
    expect(fs.existsSync(`${dbFile()}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(dbFile(), 'utf8')).users.some((u: { username: string }) => u.username === 'stud-atomic')).toBe(true);
  });
});

describe('server restart with the disk wiped (Render Free)', () => {
  it('without a durable store the loss happens, and /api/health says so honestly', async () => {
    let app = await startServer();
    const auth = await adminAuth(app);
    const health = (await request(app).get('/api/health')).body.persistence;
    expect(health).toMatchObject({ mode: 'local-file', durable: false });
    await createStudent(app, auth, 'stud-lost');
    const r = await uploadResource(app, auth, 'Lost');

    wipeDisk();
    app = await startServer();
    expect(await usernames(app, auth)).not.toContain('stud-lost');
    expect(await resourceIds(app, auth)).not.toContain(r.id);
  });

  it('with the durable store everything survives: accounts, verification state, uploads (with content), deletions, sessions', async () => {
    const pool = newPgPool();
    let app = await startServer(pool);
    expect((await request(app).get('/api/health')).body.persistence).toMatchObject({ mode: 'postgres', durable: true });
    const auth = await adminAuth(app);
    const s = await createStudent(app, auth, 'stud-durable');
    expect((await request(app).post(`/api/admin/users/${s.id}/verify-email`).set(auth).send({ confirm: true })).status).toBe(200);
    const kept = await uploadResource(app, auth, 'Durable', 'durable bytes');
    const removed = await uploadResource(app, auth, 'Removed');
    expect((await request(app).delete(`/api/resources/${removed.id}`).set(auth)).status).toBe(200);
    const victim = await deletablePresentation(app);
    expect((await request(app).delete(`/api/presentations/versions/${victim}`).set(auth)).status).toBe(200);

    wipeDisk();
    app = await startServer(pool);
    // Same admin id as before, so the session continues.
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(200);
    const users = (await request(app).get('/api/admin/users').set(auth)).body.data;
    expect(users.find((u: { username: string }) => u.username === 'stud-durable')).toMatchObject({ emailVerified: true });
    const ids = await resourceIds(app, auth);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(removed.id);
    expect((await request(app).get(kept.fileUrl)).text).toBe('durable bytes');
    expect(await presentationIds(app)).not.toContain(victim);
    // The student can sign in after the restart.
    expect((await request(app).post('/api/auth/login').send({ username: 'stud-durable', password: 'Student-pass-1234' })).status).toBe(200);
  });

  it('jobs (scheduling store) survive as well', async () => {
    const pool = newPgPool();
    let app = await startServer(pool);
    const auth = await adminAuth(app);
    const { schedulingStore } = await import('../../src/models/schedulingStore');
    schedulingStore().addJob({ ownerId: 'x', spec: {} } as never);
    const { flushDurableWrites } = await import('../../src/persistence/durableStore');
    await flushDurableWrites();
    const before = schedulingStore().listJobs().map((j) => j.id);

    wipeDisk();
    app = await startServer(pool);
    const again = await import('../../src/models/schedulingStore');
    expect(again.schedulingStore().listJobs().map((j) => j.id)).toEqual(before);
    expect(auth).toBeTruthy();
  });

  it('a failed database write is reported as NOT_PERSISTED (503), never as success', async () => {
    const pool = newPgPool();
    const app = await startServer(pool);
    const auth = await adminAuth(app);
    const { durableStore } = await import('../../src/persistence/durableStore');
    const store = durableStore()!;
    vi.spyOn(store, 'putDocument').mockRejectedValue(new Error('connection lost'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await request(app).post('/api/admin/users').set(auth).send(studentBody('stud-unsaved'));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ success: false, code: 'NOT_PERSISTED' });
    vi.restoreAllMocks();
  });

  it('the server does not start in ephemeral mode when DATABASE_URL is set but unusable', async () => {
    const { connectDurableStoreFromEnv } = await import('../../src/persistence/durableStore');
    await expect(connectDurableStoreFromEnv({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none' } as never)).rejects.toBeTruthy();
    expect(await connectDurableStoreFromEnv({} as never)).toBeNull();
  });
});
