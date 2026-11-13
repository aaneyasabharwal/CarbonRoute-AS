import { Request, Response } from 'express';
import { CarbonService } from '../services/carbonService';
import { SchedulerService, WorkloadJob, EngineOutcome } from '../services/schedulerService';

export interface TimeSlotCarbon {
  hour: number;
  predictedCarbon: number; // gCO2eq/kWh, window average of the synthetic forecast
  /** stdDev is the runtime standard deviation in HOURS (declared CV x duration). */
  uncertaintyLow: { stdDev: number; violationRisk: number };
  uncertaintyHigh: { stdDev: number; violationRisk: number };
}

/** Declared runtime variability for the two scenarios (coefficient of variation). */
export const FEASIBILITY_RUNTIME_CV = { low: 0.05, high: 0.25 } as const;

/**
 * Feasibility demonstration (M2.6 / M3.9, P1): the same synthetic forecast, scheduled by the
 * production engine twice: once with low and once with high declared runtime variability.
 * Higher runtime variability raises the deadline-miss risk of late windows, so the
 * risk-constrained policy may have to start earlier. Synthetic data only; labelled as such.
 */
export const simulateFeasibilityDecision = async (req: Request, res: Response) => {
  try {
    const durationHours = Number(req.body?.durationHours ?? 2);
    const deadlineHours = Number(req.body?.deadlineHours ?? 12);
    const riskTolerance = Number(req.body?.riskTolerance ?? 0.1);
    const region = String(req.body?.region || 'BENCHMARK-RESEARCH');
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 6) {
      return res.status(400).json({ success: false, message: 'durationHours must be a whole number from 1 to 6.' });
    }
    if (!Number.isInteger(deadlineHours) || deadlineHours <= durationHours || deadlineHours > 23) {
      return res.status(400).json({ success: false, message: 'deadlineHours must be a whole number after durationHours and at most 23.' });
    }
    if (!(riskTolerance >= 0.01 && riskTolerance <= 0.5)) {
      return res.status(400).json({ success: false, message: 'riskTolerance must be between 0.01 and 0.5.' });
    }

    // Synthetic demo trace only, so the demonstration is reproducible without any API key.
    const forecastData = await CarbonService.getForecast(region, 24, 'demo');
    const job: WorkloadJob = {
      id: 'feasibility-demo',
      name: 'Feasibility demonstration',
      commandOrImage: 'synthetic',
      isContainerImage: false,
      durationHours,
      deadlineHours,
      arrivalHour: 0,
      cpu: 2,
      memoryMb: 512,
      region,
      riskTolerance,
      createdAt: new Date().toISOString(),
    };
    const low = SchedulerService.evaluatePolicies(job, forecastData, { runtimeCv: FEASIBILITY_RUNTIME_CV.low });
    const high = SchedulerService.evaluatePolicies(job, forecastData, { runtimeCv: FEASIBILITY_RUNTIME_CV.high });

    const timeSlots: TimeSlotCarbon[] = low.candidateWindows.map((w, i) => ({
      hour: w.startHour,
      predictedCarbon: w.predictedCarbonIntensity,
      uncertaintyLow: { stdDev: FEASIBILITY_RUNTIME_CV.low * durationHours, violationRisk: w.deadlineRisk },
      uncertaintyHigh: { stdDev: FEASIBILITY_RUNTIME_CV.high * durationHours, violationRisk: high.candidateWindows[i].deadlineRisk },
    }));

    const scenario = (out: EngineOutcome, name: string, level: string, cv: number) => {
      if (out.status !== 'RECOMMENDED') {
        return {
          name,
          predictedCarbonCurve: 'Identical synthetic forecast',
          uncertaintyLevel: level,
          selectedStartHour: -1,
          selectedWindow: 'No feasible window',
          predictedCarbonAtStart: null,
          estimatedViolationRisk: null,
          riskToleranceSatisfied: false,
          decisionRationale: out.reason,
        };
      }
      const r = out.recommendedDecision;
      return {
        name,
        predictedCarbonCurve: 'Identical synthetic forecast',
        uncertaintyLevel: level,
        selectedStartHour: r.selectedStartHour,
        selectedWindow: r.selectedWindow,
        predictedCarbonAtStart: r.predictedCarbonIntensity,
        estimatedViolationRisk: r.estimatedDeadlineRisk,
        riskToleranceSatisfied: r.estimatedDeadlineRisk <= riskTolerance,
        decisionRationale: `With declared runtime CV ${cv} (σ = ${(cv * durationHours).toFixed(2)} h), the lowest-forecast window meeting the ${(riskTolerance * 100).toFixed(0)}% tolerance is ${r.selectedWindow} (${r.predictedCarbonIntensity} gCO2eq/kWh, deadline-miss risk ${(r.estimatedDeadlineRisk * 100).toFixed(1)}%).`,
      };
    };
    const a = scenario(low, 'Scenario A: Low runtime variability', `Low (declared CV ${FEASIBILITY_RUNTIME_CV.low})`, FEASIBILITY_RUNTIME_CV.low);
    const b = scenario(high, 'Scenario B: High runtime variability', `High (declared CV ${FEASIBILITY_RUNTIME_CV.high})`, FEASIBILITY_RUNTIME_CV.high);
    const conclusion =
      a.selectedStartHour >= 0 && b.selectedStartHour >= 0 && a.selectedStartHour !== b.selectedStartHour
        ? `With the same forecast, higher declared runtime variability moved the risk-constrained decision from T+${a.selectedStartHour} to T+${b.selectedStartHour} to keep the deadline-miss risk within ${(riskTolerance * 100).toFixed(0)}%.`
        : `For this duration and deadline, both runtime-variability scenarios give the same decision (or no feasible window).`;

    return res.json({
      success: true,
      data: {
        input: { durationHours, deadlineHours, riskTolerance, region },
        dataClass: 'synthetic',
        riskModel: 'declared-runtime-cv',
        timeSlots,
        scenarios: { scenarioA: a, scenarioB: b },
        feasibilityConclusion: conclusion,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
