/**
 * Oracle (hindsight) evaluation (P1, plan M10.6).
 *
 * OFFLINE ONLY: the oracle picks, after the fact, the candidate window with the lowest
 * REALIZED (observed) carbon intensity. It needs observations that cover every candidate
 * window completely; otherwise it is undefined and reported as unavailable. It is never used
 * to make a scheduling decision, because realized values are not known in advance.
 *
 * For each policy, regret = realized intensity of the policy's window - oracle intensity
 * (>= 0 by construction, since every policy window is one of the candidates).
 */
import { timeWeightedAverage, TimedValue } from './timeWeighting';

export interface OracleWindow {
  startUtc: string;
  endUtc: string;
}

export type OracleStatus = 'AVAILABLE' | 'UNAVAILABLE_INCOMPLETE_COVERAGE' | 'UNAVAILABLE_NO_CANDIDATES';

export interface OracleResult {
  status: OracleStatus;
  /** Always true: this is a hindsight benchmark, not a schedulable policy. */
  offlineOnly: true;
  candidatesEvaluated: number;
  candidatesFullyCovered: number;
  oracleWindow: (OracleWindow & { realizedIntensity: number }) | null;
  policies: {
    policyId: string;
    window: OracleWindow;
    realizedIntensity: number | null;
    regretGramsPerKwh: number | null;
  }[];
  basis: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * @param candidates every window the policies could choose from (wall-clock UTC)
 * @param realized   observed intervals (measured or provider-estimated; never forecasts)
 * @param policies   the window each policy chose
 */
export function evaluateOracle(
  candidates: OracleWindow[],
  realized: TimedValue[],
  policies: { policyId: string; window: OracleWindow }[] = []
): OracleResult {
  const basis =
    'Hindsight benchmark on realized observations (time-weighted over each window). Offline evaluation only; never used to schedule.';
  const realizedOf = (w: OracleWindow): number | null => {
    const r = timeWeightedAverage(w, realized);
    return r.complete && r.value !== null ? r.value : null;
  };
  const evaluated = candidates.map((w) => ({ ...w, realized: realizedOf(w) }));
  const covered = evaluated.filter((w) => w.realized !== null);
  const policyRows = (oracle: number | null) =>
    policies.map((p) => {
      const v = realizedOf(p.window);
      return {
        policyId: p.policyId,
        window: p.window,
        realizedIntensity: v === null ? null : round2(v),
        regretGramsPerKwh: v === null || oracle === null ? null : round2(Math.max(0, v - oracle)),
      };
    });

  if (candidates.length === 0) {
    return { status: 'UNAVAILABLE_NO_CANDIDATES', offlineOnly: true, candidatesEvaluated: 0, candidatesFullyCovered: 0, oracleWindow: null, policies: policyRows(null), basis };
  }
  if (covered.length < evaluated.length) {
    return {
      status: 'UNAVAILABLE_INCOMPLETE_COVERAGE',
      offlineOnly: true,
      candidatesEvaluated: evaluated.length,
      candidatesFullyCovered: covered.length,
      oracleWindow: null,
      policies: policyRows(null),
      basis: `${basis} Unavailable: only ${covered.length} of ${evaluated.length} candidate windows have complete realized observations.`,
    };
  }
  const best = covered.reduce((a, b) => ((b.realized as number) < (a.realized as number) ? b : a));
  const oracleValue = best.realized as number;
  return {
    status: 'AVAILABLE',
    offlineOnly: true,
    candidatesEvaluated: evaluated.length,
    candidatesFullyCovered: covered.length,
    oracleWindow: { startUtc: best.startUtc, endUtc: best.endUtc, realizedIntensity: round2(oracleValue) },
    policies: policyRows(oracleValue),
    basis,
  };
}
