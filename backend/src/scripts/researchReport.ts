/**
 * Research report generator (P8). Builds a complete, reproducible research report from SAVED results
 * only (no provider calls, no secrets):
 *
 *   npm run report -- [--benchmarks <dir>] [--ml <dir>] [--data <collection dir>] [--out <dir>] [--no-overhead]
 *
 * Defaults: the latest `benchmark-*.json` in ../CarbonRoute-AS-data/benchmark-results, the latest
 * `ml-*.json` in ../CarbonRoute-AS-data/ml-results, the collection in ../CarbonRoute-AS-data/em-collection.
 * Output: research-report-<benchmark id>.md and .json in ../CarbonRoute-AS-data/reports.
 *
 * The report body is a pure function of the input files (same inputs, same report). The only
 * measured-at-report-time section is the scheduler runtime overhead, which is machine-dependent and
 * labelled as such (omit it with --no-overhead).
 *
 * Interpretation guardrails are applied automatically and cannot be switched off:
 *  - a difference is only described as lower/higher when its 95 % interval excludes 0;
 *  - fewer than 7 days of data or fewer than 30 snapshot clusters: "not statistically conclusive";
 *  - emissions are always "estimated (assumed energy)"; deadline violations use simulated runtimes;
 *  - the ML section never shows model accuracy unless the model was actually evaluated.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

type CI = { n: number; estimate: number | null; low: number | null; high: number | null; clusters?: number; note?: string };

const MIN_DAYS = 7;
const MIN_CLUSTERS = 30;
const POLICY_NAMES: Record<string, string> = {
  immediate: 'Immediate',
  edf: 'EDF',
  deterministic_carbon: 'Greedy (deterministic carbon)',
  carbon_aware_baseline: 'CarbonAware baseline',
  carbonroute_uncertainty: 'CarbonRoute (risk-constrained)',
};

const f = (x: number | null | undefined, dp = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(dp));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)} %`);

/** How a paired difference (policy minus Immediate) may be described. */
export function describeDifference(ci: CI | undefined | null): string {
  if (!ci || ci.estimate === null) return 'not available';
  if (ci.low === null || ci.high === null) return 'no interval (too few snapshots)';
  if (ci.low <= 0 && ci.high >= 0) return 'no evidence of a difference (interval includes 0)';
  return ci.high < 0 ? 'lower than Immediate in this sample' : 'higher than Immediate in this sample';
}

export interface ReportInputs {
  benchmark: any;
  ml?: any | null;
  /** Collected-data inventory (optional): records, failed calls, per-zone quality. */
  collection?: { sha256?: string; records: number; failedCalls: number; firstRunAt: string | null; lastRunAt: string | null; spanDays: number | null; zones: { zone: string; measuredShare: number | null; realized: number; snapshots: number }[] } | null;
  /** Machine-dependent; reported separately (optional). */
  overhead?: { samples: number; medianMs: number; p95Ms: number; machine: string } | null;
}

export function buildResearchReport(inp: ReportInputs): { markdown: string; summary: any } {
  const b = inp.benchmark;
  const ml = inp.ml ?? null;
  const col = inp.collection ?? null;
  // The benchmark's input span is only known when a dataset with the SAME hash reports it: the current
  // collection may contain data added after the benchmark was run.
  const benchSha = b.dataset?.sha256;
  const spanDays: number | null =
    col && col.sha256 && col.sha256 === benchSha ? col.spanDays : ml && ml.dataset?.sha256 === benchSha ? ml.dataset.spanDays : null;
  const minClusters = Math.min(
    ...b.scenarios.flatMap((s: any) => s.policies.filter((p: any) => p.policyId !== 'immediate' && p.diffVsImmediateClusterCI).map((p: any) => p.diffVsImmediateClusterCI.clusters ?? 0)),
    Number.POSITIVE_INFINITY
  );
  const conclusive = spanDays !== null && spanDays >= MIN_DAYS && Number.isFinite(minClusters) && minClusters >= MIN_CLUSTERS;
  const verdict = conclusive
    ? 'Data meets the minimum duration and snapshot-cluster thresholds; results are still specific to the zones and period collected.'
    : `Not statistically conclusive: ${spanDays === null ? 'unknown data duration' : `${f(spanDays, 2)} days of data (minimum ${MIN_DAYS})`}${Number.isFinite(minClusters) ? `, as few as ${minClusters} snapshot clusters (minimum ${MIN_CLUSTERS})` : ''}. The numbers below describe this sample only.`;

  const out: string[] = [];
  out.push('# CarbonRoute research report', '');
  out.push(`> **${verdict}**`, '');
  out.push('Generated from saved results only (no provider calls). Every value is labelled: *real forecast*, *measured* or *provider estimate* (realized values), *synthetic* (workloads), *assumed energy* (emissions), *simulated* (runtimes).', '');

  out.push('## 1. Provenance', '');
  out.push('| Item | Value |', '|---|---|');
  out.push(`| Benchmark run | ${b.createdAt} (commit ${String(b.gitCommit ?? 'unknown').slice(0, 12)}) |`);
  out.push(`| Dataset SHA-256 | ${String(b.dataset?.sha256 ?? '').slice(0, 16)} |`);
  out.push(`| Configuration SHA-256 | ${String(b.configSha256 ?? '').slice(0, 16)} |`);
  out.push(`| Seed / workloads per snapshot / tau | ${b.config?.seed} / ${b.config?.workloadsPerSnapshot} / ${b.config?.riskTolerance} |`);
  out.push(`| Declared runtime CVs | ${(b.config?.runtimeCvs ?? []).join(', ')} |`);
  if (ml) out.push(`| ML evaluation | ${ml.createdAt} (commit ${String(ml.gitCommit ?? 'unknown').slice(0, 12)}) |`);
  out.push('');

  out.push('## 2. Data', '');
  const same = Boolean(col?.sha256 && col.sha256 === benchSha);
  if (col) {
    out.push(`- ${same ? 'Collection (the benchmark input)' : 'Current collection (newer than the benchmark input; re-run `npm run benchmark` to include it)'}: ${col.records} provider calls recorded, ${col.failedCalls} failed; ${col.firstRunAt ?? 'n/a'} to ${col.lastRunAt ?? 'n/a'} (${f(col.spanDays, 2)} days).`);
  }
  out.push(`- Benchmark input (dataset ${String(benchSha ?? '').slice(0, 12)}${spanDays === null ? '' : `, ${f(spanDays, 2)} days`}): ${b.dataset.snapshots} forecast snapshots, ${b.dataset.realizedIntervals} realized hourly values, measured share ${pct(b.dataset.measuredShare)}; zones ${b.dataset.zones.join(', ')}.`);
  if (col?.zones?.length) {
    out.push('', `Per zone (${same ? 'benchmark input' : 'current collection'}):`, '', '| Zone | Snapshots | Realized hours | Measured share |', '|---|---|---|---|');
    for (const z of col.zones) out.push(`| ${z.zone} | ${z.snapshots} | ${z.realized} | ${z.measuredShare === null ? 'n/a' : f(z.measuredShare, 3)} |`);
  }
  out.push('', 'Realized values marked *provider estimate* are another model\'s output, not measurements.', '');

  out.push('## 3. Forecast accuracy (forecast minus realized, gCO2eq/kWh)', '');
  const acc = b.accuracy;
  if (acc) {
    out.push('| Zone | Pairs | MAE | RMSE | Bias | MAE vs measured only (n) | Error bands |', '|---|---|---|---|---|---|---|');
    for (const z of acc.zones) {
      const bands = (z.errorBands ?? []).filter((e: any) => e.status === 'ok').length;
      out.push(`| ${z.zone} | ${z.pairs} | ${f(z.all.mae)} | ${f(z.all.rmse)} | ${f(z.all.bias)} | ${f(z.measuredOnly.mae)} (${z.measuredOnly.n}) | ${bands ? `${bands} lead bucket(s) with >= 30 pairs` : 'insufficient data'} |`);
    }
    out.push(`| **All** | ${acc.overall.n} | ${f(acc.overall.mae)} | ${f(acc.overall.rmse)} | ${f(acc.overall.bias)} | ${f(acc.measuredOnly.mae)} (${acc.measuredOnly.n}) | |`, '');
  } else {
    out.push('Not included in this benchmark file.', '');
  }

  out.push('## 4. Scheduling policies (replay: real forecasts, synthetic workloads)', '');
  out.push('Every policy schedules the same workloads on the same forecast snapshots. The paired difference is policy minus Immediate realized intensity on workloads where both windows are observed; its 95 % interval resamples **forecast snapshots** (cluster bootstrap). Mean realized intensities are over different subsets per policy and must not be compared directly.', '');
  const scenSummary: any[] = [];
  for (const s of b.scenarios) {
    out.push(`### Declared runtime CV ${s.runtimeCv}`, '');
    out.push(`${s.workloads} workloads; ${s.infeasible} infeasible for CarbonRoute; ${s.pendingRealized} with a window not yet observed (not scored); oracle available for ${s.oracleAvailable}.`, '');
    out.push('| Policy | Scored | Paired Δ vs Immediate [95 % CI] (n, snapshots) | Reading | Violation rate (simulated) | Mean delay h | Regret vs oracle | Est. emissions g (assumed energy) |', '|---|---|---|---|---|---|---|---|');
    const rows: any[] = [];
    for (const p of s.policies) {
      const ci: CI | undefined = p.diffVsImmediateClusterCI ?? undefined;
      const reading = p.policyId === 'immediate' ? 'reference' : ci ? describeDifference(ci) : 'workload-level interval only (older file): not reported';
      const diff = p.policyId === 'immediate' ? 'reference' : ci ? `${f(ci.estimate)} [${f(ci.low)}, ${f(ci.high)}] (${ci.n}, ${ci.clusters ?? 'n/a'})` : 'n/a';
      out.push(`| ${POLICY_NAMES[p.policyId] ?? p.policyId} | ${p.scored}/${p.decisions} | ${diff} | ${reading} | ${pct(p.deadlineViolationRate)} | ${f(p.meanDelayHours)} | ${f(p.meanRegretVsOracle)} | ${f(p.meanEstimatedEmissionsGrams, 1)} |`);
      rows.push({ policyId: p.policyId, scored: p.scored, diff: ci ?? null, reading, violationRate: p.deadlineViolationRate, meanDelayHours: p.meanDelayHours, regret: p.meanRegretVsOracle });
    }
    scenSummary.push({ runtimeCv: s.runtimeCv, workloads: s.workloads, infeasible: s.infeasible, pending: s.pendingRealized, policies: rows });
    out.push('');
  }
  out.push('- Deadline violations come from simulated runtimes Normal(d, (cv d)^2); they show the effect of the risk constraint, not measured runtime behaviour.');
  out.push('- Resource utilisation is **not modelled** (single jobs, no capacity), so it is not reported.');
  out.push('- Emissions use the assumed energy model (0.125 kW per vCPU); no realized emissions exist.', '');

  out.push('## 5. Forecast-error model (machine learning)', '');
  if (!ml) {
    out.push('No ML evaluation file found.', '');
  } else if (ml.status === 'insufficient-data') {
    out.push(`Status **insufficient-data**: ${ml.dataset.rows} forecast/realized pairs (${ml.dataset.measuredRows} measured) over ${ml.dataset.spanDays} days. The pre-registered thresholds are ${ml.thresholds.minTrainRows} / ${ml.thresholds.minValidationRows} / ${ml.thresholds.minTestRows} train / validation / test rows over at least ${ml.thresholds.minSpanDays} days. **No model was trained; no model accuracy exists.**`, '');
  } else {
    out.push(`Status **${ml.status}** on a held-out chronological test period (${ml.split?.test ?? 'n/a'} rows).`, '');
    out.push('| Model | MAE | RMSE | Bias | MAE vs measured only (n) |', '|---|---|---|---|---|');
    for (const s of ml.testScores ?? []) out.push(`| ${s.model} | ${f(s.all.mae)} | ${f(s.all.rmse)} | ${f(s.all.bias)} | ${f(s.measuredOnly.mae)} (${s.measuredOnly.n}) |`);
    out.push('', ml.status === 'evaluated-promoted' ? 'Promoted means: better than the baselines on the held-out period under the pre-registered rule. It is not used by the scheduler.' : 'Not promoted: it did not beat the baselines under the pre-registered rule.', '');
  }

  out.push('## 6. Scheduler runtime overhead (machine-dependent, not part of the reproducible results)', '');
  if (inp.overhead) {
    out.push(`Median ${f(inp.overhead.medianMs, 3)} ms, 95th percentile ${f(inp.overhead.p95Ms, 3)} ms per scheduling decision (all five policies), ${inp.overhead.samples} decisions on the saved snapshots; ${inp.overhead.machine}.`, '');
  } else {
    out.push('Not measured for this report.', '');
  }

  out.push('## 7. Threats to validity', '');
  out.push(`- Duration of the benchmark input: ${spanDays === null ? 'unknown' : `${f(spanDays, 2)} days`}; diurnal, weekly and seasonal patterns are ${spanDays !== null && spanDays >= MIN_DAYS ? 'only partly' : 'not'} represented.`);
  out.push('- Dependence: workloads share snapshots (handled by the cluster bootstrap) and neighbouring snapshots share hours (not handled; intervals may be optimistic).');
  out.push('- Selection: only windows already observed are scored; later windows are under-represented until more data is collected.');
  out.push('- Ground truth: realized values include provider estimates (see the measured share).');
  out.push('- Workloads are synthetic (uniform mix); deadline risk uses a declared, uncalibrated runtime CV; energy is assumed.', '');

  const markdown = out.join('\n');
  const summary = {
    kind: 'carbonroute-research-report',
    benchmark: { createdAt: b.createdAt, datasetSha256: b.dataset?.sha256, configSha256: b.configSha256, gitCommit: b.gitCommit ?? null },
    ml: ml ? { createdAt: ml.createdAt, status: ml.status } : null,
    spanDays,
    minSnapshotClusters: Number.isFinite(minClusters) ? minClusters : null,
    conclusive,
    verdict,
    scenarios: scenSummary,
    overhead: inp.overhead ?? null,
    reportSha256: createHash('sha256').update(markdown.split('## 6.')[0]).digest('hex'),
  };
  return { markdown, summary };
}

function latest(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function collectionInventory(dir: string): ReportInputs['collection'] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadCollectedDataset, parseCollection } = require('../benchmark/dataset');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { observedQuality } = require('../carbon/coverage');
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort();
  if (!files.length) return null;
  const records = files.flatMap((x) => parseCollection(fs.readFileSync(path.join(dir, x), 'utf8').split('\n')));
  const runs = [...new Set(records.map((r: any) => r.runAt as string))].sort();
  const q = observedQuality(loadCollectedDataset(dir));
  // (sha256 below uses the same hashing as the benchmark, so the two can be compared)
  const first = runs[0] ?? null;
  const last = runs[runs.length - 1] ?? null;
  return {
    sha256: loadCollectedDataset(dir).sha256,
    records: records.length,
    failedCalls: records.filter((r: any) => !r.ok).length,
    firstRunAt: first,
    lastRunAt: last,
    spanDays: first && last ? Math.round(((Date.parse(last) - Date.parse(first)) / 86_400_000) * 100) / 100 : null,
    zones: q.zones.map((z: any) => ({ zone: z.zone, measuredShare: z.measuredShare ?? null, realized: z.realizedHours ?? z.realized ?? 0, snapshots: z.forecastSnapshots ?? z.snapshots ?? 0 })),
  };
}

function measureOverhead(dataDir: string): ReportInputs['overhead'] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadCollectedDataset } = require('../benchmark/dataset');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SchedulerService } = require('../services/schedulerService');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os');
  const ds = loadCollectedDataset(dataDir);
  const times: number[] = [];
  for (const z of Object.values(ds.zones) as any[]) {
    for (const snap of z.snapshots) {
      const forecast = {
        region: snap.zone,
        hourlyProfile: snap.points.map((p: any, i: number) => ({ hour: i, offsetHour: i, timestamp: p.datetime, predictedCarbon: p.carbonIntensity, carbonIntensity: p.carbonIntensity, stdDev: null })),
      };
      const job = { id: 'overhead', name: 'overhead', commandOrImage: 'x', isContainerImage: false, durationHours: 2, deadlineHours: Math.min(12, snap.points.length), arrivalHour: 0, cpu: 2, memoryMb: 512, region: snap.zone, riskTolerance: 0.05, createdAt: '' };
      for (let i = 0; i < 5; i++) {
        const t0 = process.hrtime.bigint();
        try {
          SchedulerService.evaluatePolicies(job, forecast, { runtimeCv: 0.2 });
        } catch {
          /* infeasible is fine: it still measures the work */
        }
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
    }
  }
  if (!times.length) return null;
  times.sort((a, c) => a - c);
  return { samples: times.length, medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))], machine: `${os.cpus()[0]?.model ?? 'unknown CPU'}, Node ${process.version}` };
}

if (require.main === module) {
  const arg = (n: string, d?: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const base = path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data');
  const benchFile = latest(path.resolve(arg('benchmarks', path.join(base, 'benchmark-results'))!), 'benchmark-');
  if (!benchFile) {
    console.error('No benchmark-*.json found. Run `npm run benchmark` first.');
    process.exit(2);
  }
  const mlFile = latest(path.resolve(arg('ml', path.join(base, 'ml-results'))!), 'ml-');
  const dataDir = path.resolve(arg('data', path.join(base, 'em-collection'))!);
  const benchmark = JSON.parse(fs.readFileSync(benchFile, 'utf8'));
  const ml = mlFile ? JSON.parse(fs.readFileSync(mlFile, 'utf8')) : null;
  const collection = fs.existsSync(dataDir) ? collectionInventory(dataDir) : null;
  const overhead = process.argv.includes('--no-overhead') || !fs.existsSync(dataDir) ? null : measureOverhead(dataDir);
  const { markdown, summary } = buildResearchReport({ benchmark, ml, collection, overhead });
  const out = path.resolve(arg('out', path.join(base, 'reports'))!);
  fs.mkdirSync(out, { recursive: true });
  const id = path.basename(benchFile, '.json').replace(/^benchmark-/, '');
  fs.writeFileSync(path.join(out, `research-report-${id}.md`), markdown);
  fs.writeFileSync(path.join(out, `research-report-${id}.json`), JSON.stringify({ ...summary, inputs: { benchmark: path.basename(benchFile), ml: mlFile ? path.basename(mlFile) : null } }, null, 2));
  console.log(markdown);
  console.log(`\nWritten to ${out}`);
}
