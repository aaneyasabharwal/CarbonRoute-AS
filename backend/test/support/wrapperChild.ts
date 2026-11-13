/**
 * Mirrors the collector wrapper script (em-collector.cjs): it contains no collection logic and only
 * delegates to runCollectorCli. Used to prove that wrapper invocations take the same lock.
 *   wrapperChild.ts <outDir> <runs>
 */
import { runCollectorCli } from '../../src/scripts/collectElectricityMaps';

const [outDir, runs] = process.argv.slice(2);
runCollectorCli(['--out', outDir, '--runs', String(runs || 1), '--interval-min', '60']).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(String(err?.message || err));
    process.exit(1);
  }
);
