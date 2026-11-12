/**
 * Uncertainty & Risk Calibration Engine
 *
 * Mathematical / Statistical Model:
 * This model estimates the probability of deadline violation P(T_finish > Deadline)
 * using a Gaussian tail approximation evaluated through the complementary error function (erfc).
 *
 * 1. Intrinsic Runtime Variance:
 *    Batch workload execution duration exhibits intrinsic runtime jitter due to cache,
 *    I/O, and CPU resource contention:
 *    sigma_runtime = 0.15 * durationHours (std dev is ~15% of nominal duration)
 *
 * 2. Look-Ahead Horizon Dispersion:
 *    As dispatch is deferred into the future, temporal arrival uncertainty and grid forecast
 *    variance expand according to a sub-linear horizon dispersion model:
 *    sigma_horizon(t) = (baseCarbonStdDev / 100) * sqrt(t)
 *
 * 3. Total Completion Variance:
 *    sigma_completion = max(0.25, (sigma_runtime + sigma_horizon) * max(0.2, uncertaintyMultiplier))
 *
 * 4. Temporal Slack:
 *    slack = deadlineHours - (startHour + durationHours)
 *    If slack < 0: P(violation) = 1.0 (deterministic deadline violation)
 *
 * 5. Normalized Z-Score & Tail Risk:
 *    z = slack / sigma_completion
 *    P(violation) = 0.5 * erfc(z / sqrt(2))
 *
 * NOTE: This is a defensible statistical/probabilistic uncertainty model based on
 * Chebyshev rational erfc approximation (error < 1.2e-7), NOT an empirical trained ML model.
 */

export interface DeadlineRiskResult {
  violationRisk: number; // Probability in [0, 1]
  effectiveStdDev: number; // Effective completion time standard deviation in hours
  slackHours: number; // Available buffer before deadline in hours
  zScore: number; // Standardized score
}

export class UncertaintyService {
  /**
   * Evaluates the cumulative probability of deadline breach P(T_finish > deadlineHours)
   */
  public static calculateDeadlineRisk(
    startHour: number,
    durationHours: number,
    deadlineHours: number,
    baseCarbonStdDev: number | null = 20,
    uncertaintyMultiplier: number = 1.0
  ): DeadlineRiskResult {
    const slack = Number((deadlineHours - (startHour + durationHours)).toFixed(2));

    // If already infeasible by deterministic constraint
    if (slack < 0) {
      return {
        violationRisk: 1.0,
        effectiveStdDev: 99.0,
        slackHours: slack,
        zScore: -999,
      };
    }

    // No uncertainty data (e.g. Electricity Maps forecasts): no probabilistic model is applied
    // and no uncertainty is assumed. The window either fits before the deadline or it does not.
    if (baseCarbonStdDev === null) {
      return { violationRisk: 0, effectiveStdDev: 0, slackHours: slack, zScore: Infinity };
    }

    // 1. Intrinsic duration variance (15% of duration, min 0.2h)
    const sigmaRuntime = Math.max(0.2, 0.15 * durationHours);

    // 2. Horizon schedule drift (scales with sqrt(t) and grid forecast uncertainty)
    const carbonScale = Math.max(0.1, Number(baseCarbonStdDev || 20) / 100);
    const sigmaHorizon = carbonScale * Math.sqrt(Math.max(0, startHour));

    // 3. Combined completion time variance scaled by user/scenario multiplier
    const effectiveTimeStdDev = Math.max(
      0.25,
      (sigmaRuntime + sigmaHorizon) * Math.max(0.2, Number(uncertaintyMultiplier) || 1.0)
    );

    // 4. Standard score
    const zScore = slack / effectiveTimeStdDev;

    // 5. Tail probability via complementary error function
    const violationRisk = Math.min(1.0, Math.max(0.0, 0.5 * this.erfc(zScore / Math.SQRT2)));

    return {
      violationRisk: Number(violationRisk.toFixed(4)),
      effectiveStdDev: Number(effectiveTimeStdDev.toFixed(2)),
      slackHours: slack,
      zScore: Number(zScore.toFixed(3)),
    };
  }

  /**
   * Computes widening forecast uncertainty standard deviation over look-ahead horizon
   */
  public static calculateHorizonStdDev(
    horizonHour: number,
    baseStdDev: number = 15,
    growthRate: number = 0.18
  ): number {
    const sigma = Number(baseStdDev) * (1.0 + growthRate * Math.sqrt(Math.max(0, Number(horizonHour))));
    return Number(sigma.toFixed(2));
  }

  /**
   * Approximates the complementary error function erfc(x)
   * Chebyshev rational polynomial approximation accurate to 1.2e-7
   */
  public static erfc(x: number): number {
    if (x < 0) {
      return 2 - this.erfc(-x);
    }
    const t = 1.0 / (1.0 + 0.5 * x);
    const tau =
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
                          t *
                            (0.27886807 +
                              t *
                                (-1.13520398 +
                                  t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
      );
    return tau;
  }
}

// Export top-level convenience functions
export function calculateDeadlineRisk(
  startHour: number,
  durationHours: number,
  deadlineHours: number,
  baseCarbonStdDev?: number,
  uncertaintyMultiplier?: number
): DeadlineRiskResult {
  return UncertaintyService.calculateDeadlineRisk(
    startHour,
    durationHours,
    deadlineHours,
    baseCarbonStdDev,
    uncertaintyMultiplier
  );
}

export function calculateHorizonStdDev(
  horizonHour: number,
  baseStdDev?: number,
  growthRate?: number
): number {
  return UncertaintyService.calculateHorizonStdDev(horizonHour, baseStdDev, growthRate);
}
