/**
 * Reproducible end-to-end demonstration on REAL collected data (P6).
 *
 *   npm run demo -- --data <collection dir> [--zone DE] [--out <dir>]
 *
 * Replays a real Electricity Maps forecast snapshot that `npm run collect` stored, through the
 * SAME code paths the API uses (scheduleWorkflow, collectObservations, evaluateJob, the offline
 * oracle and the report builder), then collects the realized values that were recorded LATER by
 * the collector. Nothing is fetched from the provider, no API key or other secret is read, and
 * the output is identical for the same input files.
 *
 * Every number in the output carries its provenance:
 *   real-forecast     provider forecast, as fetched at the time
 *   measured          realized value the provider marks as measured
 *   provider-estimate realized value the provider marks as estimated
 *   assumed-energy    energy model (0.125 kW/vCPU), never measured
 *   synthetic         generated workloads (benchmark) or the demo trace (never used here)
 *
 * Output goes to a NEW folder outside the repository (default
 * ../CarbonRoute-AS-data/demo-runs/demo-<timestamp>), including its own scheduling store,
 * so no existing database or result is changed.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { buildDataset, parseCollection, CollectionRecord } from '../benchmark/dataset';
import { runReplayBenchmark, DEFAULT_BENCHMARK_CONFIG } from '../benchmark/replay';
import { forecastAccuracy } from '../benchmark/forecastAccuracy';
import { runMlPipeline } from '../ml/pipeline';
import { SchedulingStore } from '../models/schedulingStore';
import { scheduleWorkflow, collectObservations, evaluateJob } from '../services/schedulingWorkflow';
import { ElectricityMapsDataProvider } from '../services/carbonService';
import { evaluateOracle } from '../evaluation/oracle';
import { buildReport, renderReportHtml } from '../services/reportService';
import type { ForecastSnapshot, Observation } from '../carbon/types';

type HistoryResult = { observations: Observation[]; missing: string[]; endpoint: string; rawSha256: string };
import { createHash } from 'crypto';

const HOUR = 3600_000;

export interface DemoOptions {
  zone?: string;
  durationHours?: number;
  slackHours?: number;
  riskTolerance?: number;
  runtimeCv?: number;
}

/** Latest successful history record of a zone (the realized values the collector stored). */
function latestHistory(records: CollectionRecord[], zone: string): { runAt: string; data: HistoryResult } | null {
  const h = records.filter((r) => r.ok && r.kind === 'history' && r.zone === zone && r.data?.observations?.length);
  if (h.length === 0) return null;
  const last = h.reduce((a, b) => (Date.parse(b.runAt) > Date.parse(a.runAt) ? b : a));
  return { runAt: last.runAt, data: last.data as HistoryResult };
}

/** The zone with the most realized values marked measured (ties: alphabetical). */
function pickZone(records: CollectionRecord[]): string | null {
  const zones = [...new Set(records.filter((r) => r.ok).map((r) => r.zone))].sort();
  let best: { zone: string; measured: number } | null = null;
  for (const zone of zones) {
    const h = latestHistory(records, zone);
    const measured = h ? h.data.observations.filter((o) => o.quality === 'measured').length : 0;
    if (h && (!best || measured > best.measured)) best = { zone, measured };
  }
  return best?.zone ?? null;
}

export async function runDemo(records: CollectionRecord[], datasetSha256: string, outDir: string, opts: DemoOptions = {}) {
  const dur = opts.durationHours ?? 2;
  const slack = opts.slackHours ?? 3;
  const tau = opts.riskTolerance ?? 0.1;
  const cv = opts.runtimeCv ?? 0.1;
  const zone = opts.zone ?? pickZone(records);
  if (!zone) throw new Error('No zone with collected history. Run `npm run collect` first.');
  const history = latestHistory(records, zone);
  if (!history) throw new Error(`No collected history for ${zone}.`);
  const collectedAt = Date.parse(history.runAt);

  // The newest forecast snapshot whose job window (deadline) ended before the latest history
  // was collected, and no more than 24 h earlier (the provider's history window).
  const snapshots: ForecastSnapshot[] = records
    .filter((r) => r.ok && r.kind === 'forecast' && r.zone === zone && r.data?.granularity === 'hourly')
    .map((r) => r.data as ForecastSnapshot)
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
  const snapshot = snapshots.find((s) => {
    const t = Date.parse(s.fetchedAt);
    return t + (dur + slack) * HOUR <= collectedAt && t >= collectedAt - 22 * HOUR;
  });
  if (!snapshot) {
    throw new Error(`No ${zone} forecast snapshot is old enough for a ${dur} h job with ${slack} h slack to have finished by the last collection (${history.runAt}). Collect for longer.`);
  }
  const now = Date.parse(snapshot.fetchedAt);

  fs.mkdirSync(outDir, { recursive: true });
  const store = new SchedulingStore(path.join(outDir, 'demo-scheduling-store.json'));
  // The real conversion path (ElectricityMapsDataProvider) with a client that returns the stored
  // snapshot instead of calling the provider.
  const replayProvider = new ElectricityMapsDataProvider(undefined, { getForecast: async () => snapshot } as any);
  const getForecast = async (z: string, horizon: number) => replayProvider.getForecast(z, horizon);
  const base = {
    commandOrImage: 'python workload.py',
    isContainerImage: false,
    zone,
    cpu: 2,
    memoryMb: 1024,
    mode: 'live' as const,
    ownerId: 'demo-user',
  };
  const arrivalAt = new Date(now).toISOString();

  // 1. A job with slack: the policies can differ.
  const scheduled: any = await scheduleWorkflow(
    { ...base, name: 'demo-batch-job', durationHours: dur, riskTolerance: tau, runtimeCv: cv, arrivalAt, deadlineAt: new Date(now + (dur + slack) * HOUR).toISOString() },
    { now: () => now, store, getForecast }
  );
  // 2. The same job with no slack and an uncertain runtime: no window meets the risk budget,
  //    so the result is an explicit infeasible decision (no fallback).
  const infeasible: any = await scheduleWorkflow(
    { ...base, name: 'demo-tight-deadline', durationHours: dur, riskTolerance: 0.05, runtimeCv: 0.3, arrivalAt, deadlineAt: new Date(now + dur * HOUR).toISOString() },
    { now: () => now, store, getForecast }
  );

  // 3. Collect realized values as of the latest collection run (the stored history response).
  let observationSet: any = null;
  let evaluation: any = null;
  let oracle: any = null;
  let report: any = null;
  if (scheduled.status === 'RECOMMENDED') {
    const replayClient = { getHistory: async () => history.data } as any;
    observationSet = await collectObservations(scheduled.job.id, { now: () => collectedAt, store, client: replayClient });
    evaluation = evaluateJob(scheduled.job.id, store);
    // The two windows can overlap: one value per interval, as GET /api/jobs/:id/oracle does.
    const byInterval = new Map<string, { datetime: string; value: number; intervalMinutes: number }>();
    for (const o of [...observationSet.observations, ...(observationSet.immediate?.observations || [])]) byInterval.set(o.datetime, { datetime: o.datetime, value: o.carbonIntensity, intervalMinutes: 60 });
    const realized = [...byInterval.values()];
    oracle = evaluateOracle(
      scheduled.candidateWindows.filter((c: any) => c.classification !== 'REJECTED_DATA_GAP').map((c: any) => ({ startUtc: c.startUtc, endUtc: c.endUtc })),
      realized,
      scheduled.evaluatedPolicies.map((p: any) => ({ policyId: p.policyId, window: { startUtc: p.selectedStartUtc, endUtc: p.selectedEndUtc } }))
    );
    report = buildReport(scheduled.job.id, store);
    fs.writeFileSync(path.join(outDir, 'demo-job-report.html'), renderReportHtml(report));
  }

  // 4. Benchmark and model evaluation on the same collected files.
  const dataset = buildDataset(records, [], datasetSha256);
  const benchmark = runReplayBenchmark(dataset, DEFAULT_BENCHMARK_CONFIG, { createdAt: new Date(collectedAt).toISOString() });
  const accuracy = forecastAccuracy(dataset);
  const ml = runMlPipeline(records, { datasetSha256 });

  const result = {
    kind: 'carbonroute-demo',
    note: 'Replay of real collected Electricity Maps data through the production code paths. No provider calls; no secrets.',
    dataset: { sha256: datasetSha256, records: records.length, zone, snapshotFetchedAt: snapshot.fetchedAt, historyCollectedAt: history.runAt, snapshotRawSha256: snapshot.rawSha256 },
    scheduled,
    infeasible,
    observationSet,
    evaluation,
    oracle,
    report,
    benchmark,
    accuracy,
    ml,
  };
  fs.writeFileSync(path.join(outDir, 'demo-result.json'), JSON.stringify(result, null, 2));
  const summary = renderDemoSummary(result);
  fs.writeFileSync(path.join(outDir, 'demo-summary.md'), summary);
  return { result, summary };
}

const f = (x: number | null | undefined, dp = 1) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(dp));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function renderDemoSummary(r: any): string {
  const s = r.scheduled;
  const out: string[] = ['# CarbonRoute end-to-end demo (real collected data, replayed)', ''];
  out.push(`- Dataset ${r.dataset.sha256.slice(0, 12)} (${r.dataset.records} collection records). Zone **${r.dataset.zone}**.`);
  out.push(`- Forecast snapshot fetched ${r.dataset.snapshotFetchedAt} [real-forecast]; realized values from the collection run at ${r.dataset.historyCollectedAt}.`);
  out.push('- No provider calls were made; no secrets were read. Re-running on the same files gives the same output.', '');

  out.push('## 1. Job submission and scheduling', '');
  out.push(`- Job: ${s.job.durationHours} h, ${s.job.cpu} vCPU, arrival ${s.timeline?.arrivalAt}, deadline ${s.timeline?.deadlineAt}, risk tolerance ${s.job.riskTolerance}, declared runtime CV ${s.runtimeCv ?? 'n/a'}.`);
  out.push(`- Status: **${s.status}**. Recommended window ${s.recommendedWindow?.startUtc ?? 'n/a'} to ${s.recommendedWindow?.endUtc ?? 'n/a'}.`);
  if (s.explanation?.summary) out.push(`- Explanation: ${s.explanation.summary}`);
  out.push('', '## 2. Policy comparison (forecast, time-weighted over each window)', '');
  out.push('| Policy | Window (UTC) | Forecast gCO2eq/kWh [real-forecast] | Deadline-miss risk (model) | Est. emissions g [assumed-energy] |', '|---|---|---|---|---|');
  for (const p of s.evaluatedPolicies || []) {
    out.push(`| ${p.policyName ?? p.policyId} | ${String(p.selectedStartUtc).slice(11, 16)}-${String(p.selectedEndUtc).slice(11, 16)} | ${f(p.forecastIntensityTimeWeighted)} | ${pct(p.estimatedDeadlineRisk)} | ${f(p.estimatedEmissionsAssumedEnergyGrams)} |`);
  }
  for (const u of s.unavailablePolicies || []) out.push(`| ${u.policyName ?? u.policyId} | unavailable: ${u.reason ?? ''} | | | |`);
  out.push('', `- Infeasible case (same job, no slack, runtime CV 0.3, tolerance 0.05): **${r.infeasible.status}**. ${r.infeasible.reason ?? ''}`, '');

  out.push('## 3. After the window: forecast vs realized', '');
  if (r.observationSet) {
    out.push(`- Observation collection: **${r.observationSet.status}**. ${r.observationSet.statusDetail}`);
    const q = (r.observationSet.observations || []).map((o: any) => `${o.datetime.slice(11, 16)} ${f(o.carbonIntensity)} [${o.quality}]`);
    out.push(`- Realized values for the recommended window: ${q.join(', ') || 'none'}`);
    const wc = r.evaluation?.windowComparison;
    if (wc) {
      out.push(`- Recommended window: forecast ${f(wc.recommended.forecastIntensity)}, realized ${f(wc.recommended.observedIntensity)} [${wc.recommended.observedQuality}]`);
      out.push(`- Immediate window: forecast ${f(wc.immediate.forecastIntensity)}, realized ${f(wc.immediate.observedIntensity)} [${wc.immediate.observedQuality}]`);
      out.push(`- Realized difference (Immediate - recommended): ${wc.available ? `${f(wc.observedDifference)} gCO2eq/kWh (${f(wc.observedDifferencePct)} %)` : 'not available (a window is not fully observed)'}. One job: an example, not evidence of an effect.`);
    }
    if (r.oracle) out.push(`- Hindsight oracle (offline evaluation only): ${r.oracle.status}${r.oracle.oracle ? `, best realized window ${f(r.oracle.oracle.realized)}` : ''}.`);
  } else {
    out.push('- Not applicable: the job had no recommended window.');
  }
  out.push('- Report: demo-job-report.html (the same report the API serves at /api/jobs/:id/report?format=html).', '');

  const b = r.benchmark;
  out.push('## 4. Replay benchmark (real forecasts, SYNTHETIC workloads)', '');
  out.push(`- ${b.dataset.snapshots} forecast snapshots, ${b.dataset.realizedIntervals} realized intervals (measured share ${pct(b.dataset.measuredShare)}), zones ${b.dataset.zones.join(', ')}.`);
  for (const sc of b.scenarios) {
    out.push('', `### Runtime CV ${sc.runtimeCv}: ${sc.workloads} workloads, ${sc.infeasible} infeasible, ${sc.pendingRealized} not yet scorable (realized values pending)`, '');
    out.push('| Policy | Scored | Mean realized (own scored set) | Violation rate | Paired Δ realized vs Immediate [95% CI, cluster bootstrap over snapshots] |', '|---|---|---|---|---|');
    for (const p of sc.policies) {
      const d: any = p.diffVsImmediateClusterCI;
      out.push(`| ${p.policyId} | ${p.scored} | ${f(p.meanRealizedIntensity)} | ${pct(p.deadlineViolationRate)} | ${p.policyId === 'immediate' ? 'reference' : d && d.estimate !== null ? `${f(d.estimate, 2)} [${f(d.low, 2)}, ${f(d.high, 2)}] (n=${d.n}, ${d.clusters} snapshots)` : 'n/a'} |`);
    }
  }
  out.push('', `- Forecast accuracy over all pairs: MAE ${f(r.accuracy.overall.mae, 2)} (n=${r.accuracy.overall.n}); measured only MAE ${f(r.accuracy.measuredOnly.mae, 2)} (n=${r.accuracy.measuredOnly.n}).`);
  out.push('- "Mean realized" is over the workloads each policy could be scored on, so it is NOT comparable across policies; the paired Δ compares the same workloads (negative = cleaner than Immediate).');
  out.push('- Workloads are synthetic. Intervals resample forecast snapshots (workloads on one snapshot are not independent); neighbouring snapshots are still correlated, so intervals may be optimistic. A few hours of data from one day: not evidence of carbon savings.', '');

  const m = r.ml;
  out.push('## 5. Forecast-error model', '');
  out.push(`- Status: **${m.status}**. ${m.statusReasons.join(' ')}`);
  out.push(`- ${m.dataset.rows} forecast/realized pairs (${m.dataset.measuredRows} measured) over ${m.dataset.spanDays} days. ${m.status === 'insufficient-data' ? 'No model was fitted, so no model accuracy exists.' : ''}`);
  out.push('');
  return out.join('\n');
}

if (require.main === module) {
  const arg = (n: string, d?: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const data = arg('data');
  if (!data) {
    console.log('Usage: npm run demo -- --data <collection dir> [--zone DE] [--out <dir>]');
    process.exit(2);
  }
  const dir = path.resolve(data);
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort();
  const hash = createHash('sha256');
  const records: CollectionRecord[] = [];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(dir, file));
    hash.update(file).update(bytes);
    records.push(...parseCollection(bytes.toString('utf8').split('\n')));
  }
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(arg('out', path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'demo-runs', `demo-${stamp}`))!);
  runDemo(records, hash.digest('hex'), out, { zone: arg('zone') })
    .then(({ summary }) => {
      console.log(summary);
      console.log(`Commit ${commit}. Written to ${out}`);
    })
    .catch((err) => {
      console.error(`Demo failed: ${err.message}`);
      process.exit(1);
    });
}
