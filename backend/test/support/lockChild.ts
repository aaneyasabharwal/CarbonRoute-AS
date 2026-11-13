/**
 * Child process for the collector-lock tests (run with ts-node).
 *   race   <dir> <port|-> <startAtMs> <holdMs>  take the lock at a shared instant, print acquired/refused
 *   hold   <dir> <port|->                        take the lock and wait until killed
 *   crash  <dir> <port|->                        take the lock, then crash with an uncaught error
 *   freeze <dir> <port|-> <ms>                   take the lock, then block the event loop for <ms>
 *                                                 (models laptop sleep, a stalled process or a delayed
 *                                                 heartbeat), then report whether it still owns it
 * "-" as port means: derive it from the folder, as the real collector does.
 */
import { acquireCollectorLock } from '../../src/scripts/collectorLock';

const [mode, dir, portArg, a, b] = process.argv.slice(2);
const opts = portArg && portArg !== '-' ? { port: Number(portArg) } : {};

async function main() {
  if (mode === 'race') {
    const start = Number(a);
    await new Promise((r) => setTimeout(r, Math.max(0, start - Date.now() - 30)));
    while (Date.now() < start) {
      /* spin to the shared instant */
    }
    const l = await acquireCollectorLock(dir, opts);
    if ('error' in l) {
      process.stdout.write('refused\n');
      return process.exit(0);
    }
    process.stdout.write('acquired\n');
    setTimeout(async () => {
      await l.release();
      process.exit(0);
    }, Number(b));
    return;
  }
  const l = await acquireCollectorLock(dir, opts);
  if ('error' in l) {
    process.stdout.write(`refused ${l.error}\n`);
    return process.exit(3);
  }
  process.stdout.write('acquired\n');
  if (mode === 'hold') setInterval(() => {}, 1 << 30);
  if (mode === 'crash') setTimeout(() => {
    throw new Error('simulated crash while holding the lock');
  }, 50);
  if (mode === 'freeze') {
    setTimeout(() => {
      const until = Date.now() + Number(a);
      while (Date.now() < until) {
        /* frozen: no timers, no I/O callbacks */
      }
      process.stdout.write(`still-owner ${l.isOwner()}\n`);
      process.exit(0);
    }, 50);
  }
}
main();
