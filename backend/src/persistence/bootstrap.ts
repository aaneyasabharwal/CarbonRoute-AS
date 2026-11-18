/**
 * Start-up loading of the durable store (P22). Runs before the server accepts requests.
 *
 * - If the store already holds a document, it replaces the local copy (the local disk may have been
 *   wiped by a restart; the database has the real state).
 * - If it is empty (first start with a new database), the current local data is copied into it.
 */
import { db, DB_DOCUMENT_KEY, DatabaseSchema } from '../models/db';
import { schedulingStore, SCHEDULING_DOCUMENT_KEY } from '../models/schedulingStore';
import { DurableStore, flushDurableWrites, setDurableStore } from './durableStore';

export async function loadFromDurableStore(store: DurableStore): Promise<{ main: 'loaded' | 'initialised'; scheduling: 'loaded' | 'initialised' }> {
  setDurableStore(store);
  const main = await store.getDocument<Partial<DatabaseSchema>>(DB_DOCUMENT_KEY);
  if (main) db.replaceAll(main);
  else db.persistAll();
  const sched = await store.getDocument<Record<string, unknown>>(SCHEDULING_DOCUMENT_KEY);
  if (sched) schedulingStore().replaceAll(sched as never);
  else schedulingStore().persistAll();
  await flushDurableWrites();
  return { main: main ? 'loaded' : 'initialised', scheduling: sched ? 'loaded' : 'initialised' };
}
