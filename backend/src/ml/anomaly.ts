/**
 * Residual anomaly flags (P5, plan M12.7). UNSUPERVISED: a robust z-score of the provider's
 * forecast error per zone, |z| = |e - median| / (1.4826 * MAD) > threshold. There are no labelled
 * anomalies, so this is a screening flag, never an "accurate" detector. Zones with fewer than
 * MIN_ROWS errors are not flagged at all.
 */
import type { ErrorRow } from './dataset';

export const ANOMALY_MIN_ROWS = 30;
export const ANOMALY_Z = 3.5;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface AnomalyReport {
  method: 'robust-z of forecast error per zone (median / MAD), unsupervised';
  threshold: number;
  zones: { zone: string; rows: number; status: 'ok' | 'insufficient-data' | 'zero-spread'; flagged: { targetTime: string; leadHours: number; error: number; z: number; quality: string }[] }[];
}

export function residualAnomalies(rows: ErrorRow[], threshold = ANOMALY_Z): AnomalyReport {
  const zones = [...new Set(rows.map((r) => r.zone))].sort();
  return {
    method: 'robust-z of forecast error per zone (median / MAD), unsupervised',
    threshold,
    zones: zones.map((zone) => {
      const zr = rows.filter((r) => r.zone === zone);
      if (zr.length < ANOMALY_MIN_ROWS) return { zone, rows: zr.length, status: 'insufficient-data' as const, flagged: [] };
      const errs = zr.map((r) => r.forecast - r.actual);
      const med = median(errs);
      const mad = median(errs.map((e) => Math.abs(e - med)));
      if (mad === 0) return { zone, rows: zr.length, status: 'zero-spread' as const, flagged: [] };
      const flagged = zr
        .map((r, i) => ({ r, e: errs[i], z: (errs[i] - med) / (1.4826 * mad) }))
        .filter((x) => Math.abs(x.z) > threshold)
        .map((x) => ({ targetTime: new Date(x.r.targetTime).toISOString(), leadHours: x.r.leadHours, error: Math.round(x.e * 100) / 100, z: Math.round(x.z * 100) / 100, quality: x.r.quality }));
      return { zone, rows: zr.length, status: 'ok' as const, flagged };
    }),
  };
}
