/**
 * Runs the replay benchmark and forecast-accuracy evaluation on collected data (P2).
 *
 *   npm run benchmark -- --data <collection dir> [--out <dir>] [--seed 42] [--workloads 20]
 *
 * Results (JSON + a Markdown summary) record the git commit, the config hash, the dataset
 * hash and the seed, so a run can be repeated exactly. They contain no secrets. Write them
 * outside the repository (default: ../CarbonRoute-AS-data/benchmark-results); results are
 * not committed.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadCollectedDataset } from '../benchmark/dataset';
import { forecastAccuracy } from '../benchmark/forecastAccuracy';
import { DEFAULT_BENCHMARK_CONFIG, runReplayBenchmark, BenchmarkResult } from '../benchmark/replay';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const fmt = (x: number | null | undefined, dp = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(dp));

export function renderSummary(result: BenchmarkResult & { gitCommit: string | null; accuracy: ReturnType<typeof forecastAccuracy> }): string {
  const lines: string[] = [];
  lines.push('# CarbonRoute replay benchmark', '');
  lines.push(`- Created: ${result.createdAt}`, `- Git commit: ${result.gitCommit ?? 'unknown'}`, `- Config SHA-256: ${result.configSha256}`, `- Dataset SHA-256: ${result.dataset.sha256}`);
  lines.push(`- Data: ${result.dataClass} — zones ${result.dataset.zones.join(', ')}; ${result.dataset.snapshots} forecast snapshots; ${result.dataset.realizedIntervals} realized hourly values (measured share ${fmt(result.dataset.measuredShare, 3)})`);
  lines.push(`- Seed ${result.config.seed}; ${result.config.workloadsPerSnapshot} synthetic workloads per snapshot; tau ${result.config.riskTolerance}`, '');
  lines.push('## Forecast accuracy (forecast minus realized, gCO2eq/kWh)', '');
  lines.push('| Zone | Snapshots | Pairs | MAE | RMSE | Bias | MAE (measured only, n) |', '|---|---|---|---|---|---|---|');
  for (const z of result.accuracy.zones) {
    lines.push(`| ${z.zone} | ${z.snapshots} | ${z.pairs} | ${fmt(z.all.mae)} | ${fmt(z.all.rmse)} | ${fmt(z.all.bias)} | ${fmt(z.measuredOnly.mae)} (${z.measuredOnly.n}) |`);
  }
  for (const s of result.scenarios) {
    lines.push('', `## Policies, declared runtime CV ${s.runtimeCv}`, '');
    lines.push(`Workloads ${s.workloads}; infeasible ${s.infeasible}; with at least one policy window not yet fully observed ${s.pendingRealized} (those windows are not scored; see Scored per policy); oracle available ${s.oracleAvailable}.`, '');
    lines.push('| Policy | Decisions | Scored | Mean realized intensity [95% CI] | Δ vs Immediate [95% CI, cluster over snapshots] (clusters) | Mean delay h | Violation rate | Regret vs oracle | Est. emissions g (assumed energy) |', '|---|---|---|---|---|---|---|---|---|');
    for (const p of s.policies) {
      const ci = p.realizedIntensityCI;
      const d = p.diffVsImmediateClusterCI ?? p.diffVsImmediateCI;
      lines.push(
        `| ${p.policyId} | ${p.decisions} | ${p.scored} | ${fmt(p.meanRealizedIntensity)} [${fmt(ci.low)}, ${fmt(ci.high)}] | ${fmt(d.estimate)} [${fmt(d.low)}, ${fmt(d.high)}] (${(d as any).clusters ?? 'n/a'}) | ${fmt(p.meanDelayHours)} | ${fmt(p.deadlineViolationRate, 3)} | ${fmt(p.meanRegretVsOracle)} | ${fmt(p.meanEstimatedEmissionsGrams, 1)} |`
      );
    }
  }
  lines.push('', '## Notes', '', ...result.notes.map((n) => `- ${n}`), '');
  return lines.join('\n');
}

if (require.main === module) {
  const data = arg('data');
  if (!data) {
    console.log('Usage: npm run benchmark -- --data <collection dir> [--out <dir>] [--seed 42] [--workloads 20]');
    process.exit(2);
  }
  const out = path.resolve(arg('out', path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'benchmark-results'))!);
  const config = { ...DEFAULT_BENCHMARK_CONFIG, seed: Number(arg('seed', '42')), workloadsPerSnapshot: Number(arg('workloads', '20')) };
  const dataset = loadCollectedDataset(path.resolve(data));
  let gitCommit: string | null = null;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    gitCommit = null;
  }
  const result = { ...runReplayBenchmark(dataset, config), gitCommit, accuracy: forecastAccuracy(dataset) };
  fs.mkdirSync(out, { recursive: true });
  const stamp = result.createdAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(out, `benchmark-${stamp}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, `benchmark-${stamp}.md`), renderSummary(result));
  console.log(renderSummary(result));
  console.log(`\nWritten to ${out}`);
}
