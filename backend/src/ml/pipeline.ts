/**
 * Forecast-error ML pipeline (P5, plan M12.2-M12.7).
 *
 * The thresholds and the promotion rule are fixed HERE, before any data is seen, so a model
 * can never be "promoted" by tuning the rule to the result.
 *
 * Status (never "trained" without metrics):
 *   insufficient-data      thresholds not met: NO model is fitted; only the data inventory and
 *                          the provider's own error are reported (descriptive, not a model).
 *   evaluated-not-promoted the candidate was fitted and evaluated on the held-out test period
 *                          but did not meet the promotion rule.
 *   evaluated-promoted     the candidate met the promotion rule on the test period.
 * Promotion only means "better than the baselines on this test period"; nothing here is wired
 * into scheduling (plan M12.8 is a separate step).
 */
import crypto from 'crypto';
import { buildErrorRows, chronologicalSplit, assertNoLeakage, ErrorRow } from './dataset';
import { providerAsIs, persistence, fitBiasCorrection, selectRidge, Predictor } from './models';
import { residualAnomalies, AnomalyReport } from './anomaly';
import { errorMetrics, ErrorMetrics, pairedClusterBootstrapDiffCI, ConfidenceInterval } from '../evaluation/metrics';
import type { CollectionRecord } from '../benchmark/dataset';

export const ML_THRESHOLDS = Object.freeze({
  minTrainRows: 500,
  minValidationRows: 100,
  minTestRows: 200,
  minSpanDays: 7,
});

/**
 * Promotion rule. Amended in the PR #13 review (2026-11-13), BEFORE any evaluation had run
 * (every real run so far was insufficient-data): the interval now resamples whole target hours,
 * because the same hour is predicted by up to 24 snapshots and those rows are not independent;
 * and a candidate may not be worse than the best baseline on MEASURED values.
 */
export const PROMOTION_RULE = Object.freeze({
  /** Candidate test MAE must be at most this fraction of the best baseline's test MAE. */
  maxMaeRatio: 0.95,
  /** And the paired 95% CI of (|candidate error| - |baseline error|) must be below 0 ... */
  requireCiBelowZero: true,
  /** ... computed by resampling whole target hours (cluster bootstrap) ... */
  clusterBy: 'target-hour' as const,
  /** ... with at least this many distinct target hours in the test period. */
  minTestClusters: 30,
  /** With at least this many MEASURED test rows, the candidate's measured-only MAE must not exceed the best baseline's. */
  measuredCheckMinRows: 30,
  bootstrapIterations: 2000,
  seed: 20261113,
});

export interface PromotionInput {
  candidateMae: number;
  bestBaseline: { name: string; mae: number };
  diffCI: ConfidenceInterval & { clusters: number };
  measured: { rows: number; candidateMae: number | null; bestBaselineMae: number | null };
}

/** The promotion decision as a pure function of the held-out test results. */
export function decidePromotion(p: PromotionInput): { promoted: boolean; ratio: number | null; reasons: string[] } {
  const ratio = p.bestBaseline.mae > 0 ? p.candidateMae / p.bestBaseline.mae : null;
  const failures: string[] = [];
  if (ratio === null || ratio > PROMOTION_RULE.maxMaeRatio) {
    failures.push(`test MAE is ${ratio === null ? 'n/a' : `${(ratio * 100).toFixed(1)}%`} of the best baseline (${p.bestBaseline.name}); required <= ${PROMOTION_RULE.maxMaeRatio * 100}%`);
  }
  if (p.diffCI.clusters < PROMOTION_RULE.minTestClusters) {
    failures.push(`only ${p.diffCI.clusters} independent target hours in the test period; at least ${PROMOTION_RULE.minTestClusters} are required`);
  }
  if (p.diffCI.high === null || !(p.diffCI.high < 0)) {
    failures.push(`the 95% cluster-bootstrap CI of the paired error difference [${p.diffCI.low?.toFixed(2) ?? 'n/a'}, ${p.diffCI.high?.toFixed(2) ?? 'n/a'}] is not below 0`);
  }
  const measuredNotes: string[] = [];
  if (p.measured.rows >= PROMOTION_RULE.measuredCheckMinRows) {
    if (p.measured.candidateMae === null || p.measured.bestBaselineMae === null || p.measured.candidateMae > p.measured.bestBaselineMae) {
      failures.push(`on measured values only (n=${p.measured.rows}) the candidate's MAE ${p.measured.candidateMae?.toFixed(2)} exceeds the best baseline's ${p.measured.bestBaselineMae?.toFixed(2)}`);
    }
  } else {
    measuredNotes.push(`Measured-only check not possible: ${p.measured.rows} measured test rows (< ${PROMOTION_RULE.measuredCheckMinRows}); the result relies on provider estimates.`);
  }
  if (failures.length) return { promoted: false, ratio, reasons: [`Not promoted: ${failures.join('; ')}.`, ...measuredNotes] };
  return {
    promoted: true,
    ratio,
    reasons: [
      `Promoted: test MAE is ${(ratio! * 100).toFixed(1)}% of the best baseline (${p.bestBaseline.name}), the cluster-bootstrap CI over ${p.diffCI.clusters} target hours is below 0${measuredNotes.length ? '' : ', and it is not worse on measured values'}.`,
      ...measuredNotes,
    ],
  };
}

export type MlStatus = 'insufficient-data' | 'evaluated-not-promoted' | 'evaluated-promoted';

export interface ModelScore {
  model: string;
  all: ErrorMetrics;
  measuredOnly: ErrorMetrics;
}

export interface MlReport {
  kind: 'carbonroute-ml-evaluation';
  createdAt: string;
  status: MlStatus;
  statusReasons: string[];
  dataset: {
    sha256: string;
    rows: number;
    measuredRows: number;
    zones: string[];
    firstIssue: string | null;
    lastIssue: string | null;
    spanDays: number;
    leadHours: { min: number | null; max: number | null };
  };
  thresholds: typeof ML_THRESHOLDS;
  promotionRule: typeof PROMOTION_RULE;
  /** Provider forecast error over ALL rows (descriptive accuracy, not a model). */
  providerErrorAllRows: { all: ErrorMetrics; measuredOnly: ErrorMetrics };
  split: {
    train: number;
    validation: number;
    test: number;
    /** Measured-target rows in each split (the rest are provider estimates). */
    measured: { train: number; validation: number; test: number };
    droppedForGap: number;
    validationStart: string | null;
    testStart: string | null;
  } | null;
  candidate: { model: 'ridge-error-correction'; lambda: number; validationMae: Record<string, number | null> } | null;
  testScores: ModelScore[] | null;
  promotion: { bestBaseline: string; maeRatio: number | null; diffCI: ConfidenceInterval & { clusters: number }; measuredTestRows: number } | null;
  anomalies: AnomalyReport;
  notes: string[];
}

const DAY = 86_400_000;

function score(model: string, rows: ErrorRow[], f: Predictor): ModelScore {
  const pairs = rows.map((r) => ({ forecast: f(r), actual: r.actual }));
  const measured = rows.filter((r) => r.quality === 'measured').map((r) => ({ forecast: f(r), actual: r.actual }));
  return { model, all: errorMetrics(pairs), measuredOnly: errorMetrics(measured) };
}

export function runMlPipeline(records: CollectionRecord[], opts: { createdAt?: string; datasetSha256?: string } = {}): MlReport {
  const rows = buildErrorRows(records);
  assertNoLeakage(rows);
  const issues = rows.map((r) => r.issuedAt);
  const first = issues.length ? Math.min(...issues) : null;
  const last = issues.length ? Math.max(...issues) : null;
  const spanDays = first === null || last === null ? 0 : (last - first) / DAY;
  const leads = rows.map((r) => r.leadHours);
  const dataset = {
    sha256: opts.datasetSha256 ?? crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    rows: rows.length,
    measuredRows: rows.filter((r) => r.quality === 'measured').length,
    zones: [...new Set(rows.map((r) => r.zone))].sort(),
    firstIssue: first === null ? null : new Date(first).toISOString(),
    lastIssue: last === null ? null : new Date(last).toISOString(),
    spanDays: Math.round(spanDays * 100) / 100,
    leadHours: { min: leads.length ? Math.min(...leads) : null, max: leads.length ? Math.max(...leads) : null },
  };
  const base = {
    kind: 'carbonroute-ml-evaluation' as const,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    dataset,
    thresholds: ML_THRESHOLDS,
    promotionRule: PROMOTION_RULE,
    providerErrorAllRows: { all: score('provider-as-is', rows, providerAsIs).all, measuredOnly: score('provider-as-is', rows, providerAsIs).measuredOnly },
    anomalies: residualAnomalies(rows),
    notes: [
      'Targets are realized values from Electricity Maps history; provider estimates are included and reported separately (measuredOnly).',
      'Features use only information available when the forecast was fetched (leakage-checked).',
      'Splits are chronological with a gap: no target hour of an earlier split overlaps a later split.',
      'Thresholds and the promotion rule were fixed in code before evaluation.',
      'Anomaly flags are unsupervised screening flags, not a validated detector.',
    ],
  };

  const split = chronologicalSplit(rows);
  const reasons: string[] = [];
  if (spanDays < ML_THRESHOLDS.minSpanDays) reasons.push(`Data spans ${dataset.spanDays} days; at least ${ML_THRESHOLDS.minSpanDays} are required.`);
  if (split.train.length < ML_THRESHOLDS.minTrainRows) reasons.push(`Training rows ${split.train.length} < ${ML_THRESHOLDS.minTrainRows}.`);
  if (split.validation.length < ML_THRESHOLDS.minValidationRows) reasons.push(`Validation rows ${split.validation.length} < ${ML_THRESHOLDS.minValidationRows}.`);
  if (split.test.length < ML_THRESHOLDS.minTestRows) reasons.push(`Test rows ${split.test.length} < ${ML_THRESHOLDS.minTestRows}.`);
  const measuredCount = (rs: ErrorRow[]) => rs.filter((r) => r.quality === 'measured').length;
  const splitInfo = {
    train: split.train.length,
    validation: split.validation.length,
    test: split.test.length,
    measured: { train: measuredCount(split.train), validation: measuredCount(split.validation), test: measuredCount(split.test) },
    droppedForGap: split.droppedForGap,
    validationStart: split.boundaries.validationStart,
    testStart: split.boundaries.testStart,
  };
  if (reasons.length) {
    return { ...base, status: 'insufficient-data', statusReasons: [...reasons, 'No model was fitted. Reliable training is pending more collected data.'], split: splitInfo, candidate: null, testScores: null, promotion: null };
  }

  const bias = fitBiasCorrection(split.train);
  const { model, validationMae } = selectRidge(split.train, split.validation);
  const baselines: [string, Predictor][] = [
    ['provider-as-is', providerAsIs],
    ['bias-corrected', bias],
    ['persistence', persistence],
  ];
  const testScores = [...baselines.map(([n, f]) => score(n, split.test, f)), score('ridge-error-correction', split.test, model.predict)];
  const best = baselines
    .map(([n, f]) => ({ n, f, mae: score(n, split.test, f).all.mae as number }))
    .sort((a, b) => a.mae - b.mae)[0];
  const candidateScore = testScores[testScores.length - 1];
  const candMae = candidateScore.all.mae as number;
  const diffCI = pairedClusterBootstrapDiffCI(
    split.test.map((r) => Math.abs(model.predict(r) - r.actual)),
    split.test.map((r) => Math.abs(best.f(r) - r.actual)),
    split.test.map((r) => r.targetTime),
    { iterations: PROMOTION_RULE.bootstrapIterations, seed: PROMOTION_RULE.seed }
  );
  const decision = decidePromotion({
    candidateMae: candMae,
    bestBaseline: { name: best.n, mae: best.mae },
    diffCI,
    measured: {
      rows: splitInfo.measured.test,
      candidateMae: candidateScore.measuredOnly.mae,
      bestBaselineMae: testScores.find((s) => s.model === best.n)!.measuredOnly.mae,
    },
  });
  const promoted = decision.promoted;
  const ratio = decision.ratio;
  const why = decision.reasons;
  return {
    ...base,
    status: promoted ? 'evaluated-promoted' : 'evaluated-not-promoted',
    statusReasons: why,
    split: splitInfo,
    candidate: { model: 'ridge-error-correction', lambda: model.lambda, validationMae },
    testScores,
    promotion: { bestBaseline: best.n, maeRatio: ratio === null ? null : Math.round(ratio * 10000) / 10000, diffCI, measuredTestRows: splitInfo.measured.test },
  };
}
