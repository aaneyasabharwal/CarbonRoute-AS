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
import { errorMetrics, ErrorMetrics, pairedBootstrapDiffCI, ConfidenceInterval } from '../evaluation/metrics';
import type { CollectionRecord } from '../benchmark/dataset';

export const ML_THRESHOLDS = Object.freeze({
  minTrainRows: 500,
  minValidationRows: 100,
  minTestRows: 200,
  minSpanDays: 7,
});

export const PROMOTION_RULE = Object.freeze({
  /** Candidate test MAE must be at most this fraction of the best baseline's test MAE. */
  maxMaeRatio: 0.95,
  /** And the paired bootstrap 95% CI of (|candidate error| - |baseline error|) must be below 0. */
  requireCiBelowZero: true,
  bootstrapIterations: 2000,
  seed: 20261113,
});

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
  split: { train: number; validation: number; test: number; droppedForGap: number; validationStart: string | null; testStart: string | null } | null;
  candidate: { model: 'ridge-error-correction'; lambda: number; validationMae: Record<string, number | null> } | null;
  testScores: ModelScore[] | null;
  promotion: { bestBaseline: string; maeRatio: number | null; diffCI: ConfidenceInterval } | null;
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
  const splitInfo = {
    train: split.train.length,
    validation: split.validation.length,
    test: split.test.length,
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
  const candMae = testScores[testScores.length - 1].all.mae as number;
  const diffCI = pairedBootstrapDiffCI(
    split.test.map((r) => Math.abs(model.predict(r) - r.actual)),
    split.test.map((r) => Math.abs(best.f(r) - r.actual)),
    { iterations: PROMOTION_RULE.bootstrapIterations, seed: PROMOTION_RULE.seed }
  );
  const ratio = best.mae > 0 ? candMae / best.mae : null;
  const promoted = ratio !== null && ratio <= PROMOTION_RULE.maxMaeRatio && diffCI.high !== null && diffCI.high < 0;
  const why = promoted
    ? [`Candidate test MAE is ${(ratio! * 100).toFixed(1)}% of the best baseline (${best.n}) and the 95% CI of the paired difference is entirely below 0.`]
    : [
        `Not promoted: candidate test MAE is ${ratio === null ? 'n/a' : `${(ratio * 100).toFixed(1)}%`} of the best baseline (${best.n}); required <= ${PROMOTION_RULE.maxMaeRatio * 100}% with the paired 95% CI below 0 (CI [${diffCI.low?.toFixed(2)}, ${diffCI.high?.toFixed(2)}]).`,
      ];
  return {
    ...base,
    status: promoted ? 'evaluated-promoted' : 'evaluated-not-promoted',
    statusReasons: why,
    split: splitInfo,
    candidate: { model: 'ridge-error-correction', lambda: model.lambda, validationMae },
    testScores,
    promotion: { bestBaseline: best.n, maeRatio: ratio === null ? null : Math.round(ratio * 10000) / 10000, diffCI },
  };
}
