/**
 * Deadline risk (P1 / audit C1, M2.4, M9.4).
 *
 * The previous model added "carbon forecast standard deviation / 100" to a runtime standard
 * deviation in hours. That mixes units (gCO2eq/kWh with hours) and is removed. Carbon
 * forecast uncertainty affects how much CO2 a window emits, not whether the job finishes on
 * time, so it is not part of the deadline risk.
 *
 * Deadline risk now depends only on how long the job runs:
 *
 *   runtime R ~ Normal(d, (cv * d)^2), d = declared duration (h), cv = declared runtime
 *   coefficient of variation (>= 0).
 *   P(miss) = P(start + R > deadline) = 1 - Phi((deadline - start - d) / (cv * d))
 *
 * - cv = 0 (or not given): deterministic. A window that ends by the deadline has risk 0,
 *   otherwise 1.
 * - cv is a value the user DECLARES. It is not learned from data: empirical runtime
 *   distributions need recorded executions (milestone M9.1) and do not exist yet.
 * - Start delays (queueing, image pulls) are not modelled.
 */

export interface DeadlineRiskResult {
  /** P(job finishes after the deadline), in [0, 1]. */
  violationRisk: number;
  /** Runtime standard deviation used (hours); 0 when deterministic. */
  runtimeStdDevHours: number;
  /** Deadline minus planned end (hours). */
  slackHours: number;
  model: 'deterministic' | 'declared-runtime-cv';
}

/** Largest accepted runtime coefficient of variation. */
export const MAX_RUNTIME_CV = 1;

/**
 * P17: the runtime CV values a user may declare through the API (0 = deterministic runtime).
 * The engine itself accepts any cv in [0, MAX_RUNTIME_CV] (the built-in feasibility demo and the
 * research replay use other values); only user input is restricted to this list.
 */
export const RUNTIME_CV_OPTIONS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/**
 * Returns the canonical option equal to `input` (a number, or a numeric string, within 1e-9),
 * or null when it is not one of RUNTIME_CV_OPTIONS. Booleans, empty strings and other types are null.
 */
export function toRuntimeCvOption(input: unknown): number | null {
  if (typeof input !== 'number' && !(typeof input === 'string' && input.trim() !== '')) return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  const match = RUNTIME_CV_OPTIONS.find((v) => Math.abs(v - n) < 1e-9);
  return match === undefined ? null : match;
}

/** Standard normal CDF via erfc. */
export function normalCdf(z: number): number {
  return 0.5 * UncertaintyService.erfc(-z / Math.SQRT2);
}

export class UncertaintyService {
  /**
   * Deadline-miss probability for a job of `durationHours` starting at `startHour` with a
   * deadline at `deadlineHours` (all hours on the same axis).
   */
  public static deadlineRisk(startHour: number, durationHours: number, deadlineHours: number, runtimeCv = 0): DeadlineRiskResult {
    const slack = deadlineHours - (startHour + durationHours);
    const cv = Number.isFinite(runtimeCv) && runtimeCv > 0 ? Math.min(MAX_RUNTIME_CV, runtimeCv) : 0;
    if (cv === 0) {
      return { violationRisk: slack < 0 ? 1 : 0, runtimeStdDevHours: 0, slackHours: slack, model: 'deterministic' };
    }
    const sigma = cv * durationHours;
    // A job (d > 0) that starts at or after its deadline cannot finish by it. The Normal model
    // puts some mass on runtimes <= 0, so 1 - Phi would give < 1 here; the scheduler never
    // evaluates such starts (it only considers t + d <= deadline), but the function is exact.
    if (deadlineHours - startHour <= 0) {
      return { violationRisk: 1, runtimeStdDevHours: sigma, slackHours: slack, model: 'declared-runtime-cv' };
    }
    const risk = 1 - normalCdf(slack / sigma);
    return {
      violationRisk: Math.min(1, Math.max(0, risk)),
      runtimeStdDevHours: sigma,
      slackHours: slack,
      model: 'declared-runtime-cv',
    };
  }

  /**
   * Complementary error function, Numerical Recipes rational approximation
   * (fractional error < 1.2e-7).
   */
  public static erfc(x: number): number {
    if (x < 0) {
      return 2 - this.erfc(-x);
    }
    const t = 1.0 / (1.0 + 0.5 * x);
    return (
      t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
      )
    );
  }
}
