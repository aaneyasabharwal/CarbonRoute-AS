/**
 * Replay benchmark (P2, plan M11.1-M11.3).
 *
 * For every collected forecast snapshot, a seeded set of SYNTHETIC workloads (labelled as
 * such) is scheduled by every policy on that same snapshot, so all policies see identical
 * workloads and data. Each chosen window is then scored on REALIZED observations collected
 * later (time-weighted over the exact window); windows not yet fully observed are not scored
 * and are counted as pending. The Oracle (offline, hindsight) is computed only when every
 * candidate window is fully observed.
 *
 * Runtime is simulated per workload as Normal(d, (cv d)^2) with a seeded generator, to count
 * deadline violations under the declared runtime variability. With cv = 0 no violation is
 * possible by construction. Emissions use the ASSUMED energy model.
 */
import crypto from 'crypto';
import { SchedulerService, WorkloadJob } from '../services/schedulerService';
import { energyAssumption } from '../services/energyModel';
import { timeWeightedAverage } from '../evaluation/timeWeighting';
import { evaluateOracle } from '../evaluation/oracle';
import { bootstrapMeanCI, mean, normalSample, pairedBootstrapDiffCI, seededRandom, ConfidenceInterval } from '../evaluation/metrics';
import type { CollectedDataset } from './dataset';

const HOUR = 3600_000;

export interface BenchmarkConfig {
  seed: number;
  workloadsPerSnapshot: number;
  /** Declared runtime CVs to evaluate (each is a separate scenario). */
  runtimeCvs: number[];
  riskTolerance: number;
  durationsHours: number[];
  maxSlackHours: number;
  cpu: number;
  bootstrapIterations: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  seed: 42,
  workloadsPerSnapshot: 20,
  runtimeCvs: [0, 0.2],
  riskTolerance: 0.05,
  durationsHours: [1, 2, 3, 4],
  maxSlackHours: 12,
  cpu: 2,
  bootstrapIterations: 2000,
};

export const POLICY_IDS = ['immediate', 'edf', 'deterministic_carbon', 'carbon_aware_baseline', 'carbonroute_uncertainty'] as const;

export interface WorkloadResult {
  zone: string;
  snapshotFetchedAt: string;
  workload: { durationHours: number; slackHours: number; runtimeCv: number; simulatedRuntimeHours: number };
  status: 'RECOMMENDED' | 'INFEASIBLE_RISK' | 'NO_FEASIBLE_WINDOW';
  policies: Record<string, { startUtc: string; endUtc: string; forecastIntensity: number; realizedIntensity: number | null; delayHours: number; deadlineViolated: boolean; withinTolerance: boolean }>;
  oracle: { status: string; realizedIntensity: number | null };
}

export interface PolicySummary {
  policyId: string;
  /** Workloads in which this policy produced a window. */
  decisions: number;
  /** Of those, windows fully covered by realized observations. */
  scored: number;
  meanRealizedIntensity: number | null;
  meanForecastIntensity: number | null;
  meanEstimatedEmissionsGrams: number | null;
  meanDelayHours: number | null;
  deadlineViolationRate: number | null;
  meanRegretVsOracle: number | null;
  realizedIntensityCI: ConfidenceInterval;
  /** Paired: policy minus Immediate realized intensity on the same workloads (negative = cleaner). */
  diffVsImmediateCI: ConfidenceInterval;
}

export interface BenchmarkResult {
  kind: 'carbonroute-replay-benchmark';
  dataClass: 'real-carbon-data-synthetic-workloads';
  createdAt: string;
  config: BenchmarkConfig;
  configSha256: string;
  dataset: { sha256: string; files: string[]; zones: string[]; snapshots: number; realizedIntervals: number; measuredShare: number | null };
  scenarios: {
    runtimeCv: number;
    workloads: number;
    infeasible: number;
    pendingRealized: number;
    oracleAvailable: number;
    policies: PolicySummary[];
  }[];
  notes: string[];
  workloads?: WorkloadResult[];
}

export function hashConfig(config: BenchmarkConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

const round = (x: number | null, dp = 2) => (x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp);

export function runReplayBenchmark(dataset: CollectedDataset, config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG, opts: { includeWorkloads?: boolean; createdAt?: string } = {}): BenchmarkResult {
  const rand = seededRandom(config.seed);
  const energyKwh = (d: number) => energyAssumption(config.cpu, d).energyKwh;
  const all: WorkloadResult[] = [];

  for (const zone of Object.keys(dataset.zones).sort()) {
    const z = dataset.zones[zone];
    const realized = z.realized.map((r) => ({ datetime: r.datetime, value: r.value, intervalMinutes: r.intervalMinutes }));
    const realizedOf = (w: { startUtc: string; endUtc: string }) => {
      const r = timeWeightedAverage(w, realized);
      return r.complete ? r.value : null;
    };
    for (const snap of z.snapshots) {
      if (snap.granularity !== 'hourly' || snap.points.length === 0) continue;
      const t0 = Date.parse(snap.points[0].datetime);
      const profile = snap.points.map((p, i) => ({
        hour: i,
        timestamp: p.datetime,
        predictedCarbon: p.carbonIntensity,
        carbonIntensity: p.carbonIntensity,
        stdDev: null,
        uncertaintyStdDev: null,
      })) as any[];
      const windowOf = (s: number, d: number) => ({ startUtc: new Date(t0 + s * HOUR).toISOString(), endUtc: new Date(t0 + (s + d) * HOUR).toISOString() });

      for (let k = 0; k < config.workloadsPerSnapshot; k++) {
        const d = config.durationsHours[Math.floor(rand() * config.durationsHours.length)];
        const slack = Math.floor(rand() * (config.maxSlackHours + 1));
        const z01 = normalSample(rand); // same runtime draw for every CV scenario (paired)
        for (const cv of config.runtimeCvs) {
          const job: WorkloadJob = {
            id: `bench-${zone}-${k}`,
            name: 'synthetic benchmark workload',
            commandOrImage: 'synthetic',
            isContainerImage: false,
            durationHours: d,
            deadlineHours: d + slack,
            arrivalHour: 0,
            cpu: config.cpu,
            memoryMb: 512,
            region: zone,
            riskTolerance: config.riskTolerance,
            createdAt: snap.fetchedAt,
          };
          const out = SchedulerService.evaluatePolicies(job, profile, { runtimeCv: cv });
          const runtime = Math.max(0, d * (1 + cv * z01));
          const policies: WorkloadResult['policies'] = {};
          for (const p of out.evaluatedPolicies) {
            const w = windowOf(p.selectedStartHour, d);
            policies[p.policyId] = {
              ...w,
              forecastIntensity: p.predictedCarbonIntensity,
              realizedIntensity: round(realizedOf(w), 4),
              delayHours: p.waitingTimeHours,
              deadlineViolated: p.selectedStartHour + runtime > d + slack + 1e-9,
              withinTolerance: p.isFeasible,
            };
          }
          if (out.status !== 'RECOMMENDED') delete policies.carbonroute_uncertainty; // no recommendation is made
          const candidates = out.candidateWindows.filter((c) => c.classification !== 'REJECTED_DATA_GAP').map((c) => windowOf(c.startHour, d));
          const oracle = evaluateOracle(candidates, realized);
          all.push({
            zone,
            snapshotFetchedAt: snap.fetchedAt,
            workload: { durationHours: d, slackHours: slack, runtimeCv: cv, simulatedRuntimeHours: round(runtime, 4) as number },
            status: out.status,
            policies,
            oracle: { status: oracle.status, realizedIntensity: oracle.oracleWindow?.realizedIntensity ?? null },
          });
        }
      }
    }
  }

  const realizedCount = Object.values(dataset.zones).reduce((n, z) => n + z.realized.length, 0);
  const measured = Object.values(dataset.zones).reduce((n, z) => n + z.realized.filter((r) => r.quality === 'measured').length, 0);
  const scenarios = config.runtimeCvs.map((cv, si) => {
    const ws = all.filter((w) => w.workload.runtimeCv === cv);
    const policies: PolicySummary[] = POLICY_IDS.map((pid, pi) => {
      const withPolicy = ws.filter((w) => w.policies[pid]);
      const scored = withPolicy.filter((w) => w.policies[pid].realizedIntensity !== null);
      const realizedVals = scored.map((w) => w.policies[pid].realizedIntensity as number);
      const pairedWs = scored.filter((w) => w.policies.immediate?.realizedIntensity != null);
      const withOracle = scored.filter((w) => w.oracle.realizedIntensity !== null);
      const seed = config.seed + 1000 * (si + 1) + pi;
      return {
        policyId: pid,
        decisions: withPolicy.length,
        scored: scored.length,
        meanRealizedIntensity: round(mean(realizedVals)),
        meanForecastIntensity: round(mean(withPolicy.map((w) => w.policies[pid].forecastIntensity))),
        meanEstimatedEmissionsGrams: round(mean(scored.map((w) => (w.policies[pid].realizedIntensity as number) * energyKwh(w.workload.durationHours))), 1),
        meanDelayHours: round(mean(withPolicy.map((w) => w.policies[pid].delayHours))),
        deadlineViolationRate: round(mean(withPolicy.map((w) => (w.policies[pid].deadlineViolated ? 1 : 0))), 4),
        meanRegretVsOracle: round(mean(withOracle.map((w) => (w.policies[pid].realizedIntensity as number) - (w.oracle.realizedIntensity as number)))),
        realizedIntensityCI: bootstrapMeanCI(realizedVals, { iterations: config.bootstrapIterations, seed }),
        diffVsImmediateCI: pairedBootstrapDiffCI(
          pairedWs.map((w) => w.policies[pid].realizedIntensity as number),
          pairedWs.map((w) => w.policies.immediate.realizedIntensity as number),
          { iterations: config.bootstrapIterations, seed: seed + 500 }
        ),
      };
    });
    return {
      runtimeCv: cv,
      workloads: ws.length,
      infeasible: ws.filter((w) => w.status !== 'RECOMMENDED').length,
      pendingRealized: ws.filter((w) => Object.values(w.policies).some((p) => p.realizedIntensity === null)).length,
      oracleAvailable: ws.filter((w) => w.oracle.realizedIntensity !== null).length,
      policies,
    };
  });

  const result: BenchmarkResult = {
    kind: 'carbonroute-replay-benchmark',
    dataClass: 'real-carbon-data-synthetic-workloads',
    createdAt: opts.createdAt ?? new Date().toISOString(),
    config,
    configSha256: hashConfig(config),
    dataset: {
      sha256: dataset.sha256,
      files: dataset.files,
      zones: Object.keys(dataset.zones).sort(),
      snapshots: Object.values(dataset.zones).reduce((n, z) => n + z.snapshots.length, 0),
      realizedIntervals: realizedCount,
      measuredShare: realizedCount ? round(measured / realizedCount, 4) : null,
    },
    scenarios,
    notes: [
      'Workloads are synthetic (seeded); carbon forecasts and realized values are real Electricity Maps data.',
      'Windows not yet fully observed are not scored ("pendingRealized"); nothing is interpolated or invented.',
      'Emissions use the ASSUMED energy model (0.125 kW per vCPU); they are not measured.',
      'Deadline violations use simulated runtimes Normal(d, (cv d)^2); with cv = 0 none can occur.',
      'Realized values include provider estimates; see dataset.measuredShare.',
      'Fewer than 10 scored workloads make confidence intervals unreliable; see each interval\'s note.',
      'Per-policy means are over the workloads that policy could be scored on, which differ between policies; compare policies with the paired "vs Immediate" difference.',
    ],
  };
  if (opts.includeWorkloads) result.workloads = all;
  return result;
}
