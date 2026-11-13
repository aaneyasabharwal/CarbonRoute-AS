/**
 * Child process for the collector-lock race tests. Waits until a shared start instant, then tries
 * to take the lock, prints "acquired" or "refused", holds it for a while and releases it.
 *   node -r ts-node/register/transpile-only lockChild.ts <dir> <startAtMs> <holdMs>
 */
import { acquireCollectorLock } from '../../src/scripts/collectorLock';

const [dir, startAt, hold] = process.argv.slice(2);
const start = Number(startAt);
const go = () => {
  while (Date.now() < start) {
    /* spin to the shared instant for maximum overlap */
  }
  const r = acquireCollectorLock(dir);
  if ('error' in r) {
    process.stdout.write('refused\n');
    process.exit(0);
  }
  process.stdout.write('acquired\n');
  setTimeout(() => {
    r.release();
    process.exit(0);
  }, Number(hold));
};
setTimeout(go, Math.max(0, start - Date.now() - 50));
