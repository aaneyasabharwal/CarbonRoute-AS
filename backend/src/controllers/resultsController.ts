/**
 * Historical experiment results (P4): benchmark runs written by `npm run benchmark`.
 *
 * Results are read from BENCHMARK_RESULTS_DIR (default: ../CarbonRoute-AS-data/
 * benchmark-results next to the repository). Only files named benchmark-<timestamp>.json
 * are served; ids are validated so no other file can be read. Results are aggregate
 * statistics (no user data); they are shown to signed-in users.
 */
import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';

const ID_PATTERN = /^benchmark-[0-9A-Za-z-]{8,64}$/;

export function resultsDir(): string {
  return path.resolve(process.env.BENCHMARK_RESULTS_DIR || path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'benchmark-results'));
}

function readResult(id: string): any | null {
  if (!ID_PATTERN.test(id)) return null;
  const file = path.join(resultsDir(), `${id}.json`);
  if (path.dirname(file) !== resultsDir() || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** GET /api/results/benchmarks: newest first, metadata only. */
export const listBenchmarks = (_req: AuthRequest, res: Response) => {
  const dir = resultsDir();
  if (!fs.existsSync(dir)) return res.json({ success: true, data: [] });
  const items = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && ID_PATTERN.test(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .map((id) => ({ id, r: readResult(id) }))
    .filter((x) => x.r && x.r.kind === 'carbonroute-replay-benchmark')
    .map(({ id, r }) => ({
      id,
      createdAt: r.createdAt,
      gitCommit: r.gitCommit ?? null,
      dataClass: r.dataClass,
      dataset: r.dataset,
      seed: r.config?.seed,
      workloadsPerSnapshot: r.config?.workloadsPerSnapshot,
      scenarios: (r.scenarios || []).map((s: any) => ({ runtimeCv: s.runtimeCv, workloads: s.workloads, pendingRealized: s.pendingRealized })),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return res.json({ success: true, data: items });
};

/** GET /api/results/benchmarks/:id: one run (policies, intervals, accuracy, notes). */
export const getBenchmark = (req: AuthRequest, res: Response) => {
  const r = readResult(String(req.params.id));
  if (!r || r.kind !== 'carbonroute-replay-benchmark') {
    return res.status(404).json({ success: false, code: 'RESULT_NOT_FOUND', message: 'Benchmark result not found.' });
  }
  const { workloads: _omit, ...rest } = r;
  return res.json({ success: true, data: { id: String(req.params.id), ...rest } });
};

// ---- P5: forecast-error model evaluations (`npm run ml`) ----

const ML_ID_PATTERN = /^ml-[0-9A-Za-z-]{8,64}$/;

export function mlResultsDir(): string {
  return path.resolve(process.env.ML_RESULTS_DIR || path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'ml-results'));
}

function readMl(id: string): any | null {
  if (!ML_ID_PATTERN.test(id)) return null;
  const file = path.join(mlResultsDir(), `${id}.json`);
  if (path.dirname(file) !== mlResultsDir() || !fs.existsSync(file)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && r.kind === 'carbonroute-ml-evaluation' ? r : null;
  } catch {
    return null;
  }
}

/** GET /api/results/ml: evaluations newest first (status and data inventory). */
export const listMlEvaluations = (_req: AuthRequest, res: Response) => {
  const dir = mlResultsDir();
  if (!fs.existsSync(dir)) return res.json({ success: true, data: [] });
  const items = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && ML_ID_PATTERN.test(f.slice(0, -5)))
    .map((f) => ({ id: f.slice(0, -5), r: readMl(f.slice(0, -5)) }))
    .filter((x) => x.r)
    .map(({ id, r }) => ({ id, createdAt: r.createdAt, status: r.status, dataset: r.dataset }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return res.json({ success: true, data: items });
};

/** GET /api/results/ml/:id */
export const getMlEvaluation = (req: AuthRequest, res: Response) => {
  const r = readMl(String(req.params.id));
  if (!r) return res.status(404).json({ success: false, code: 'RESULT_NOT_FOUND', message: 'Model evaluation not found.' });
  return res.json({ success: true, data: { id: String(req.params.id), ...r } });
};
