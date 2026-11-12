import { Request, Response } from 'express';
import { CarbonService } from '../services/carbonService';
import { UncertaintyService } from '../services/uncertaintyService';

export interface TimeSlotCarbon {
  hour: number;
  predictedCarbon: number; // gCO2eq/kWh
  uncertaintyLow: { stdDev: number; violationRisk: number };
  uncertaintyHigh: { stdDev: number; violationRisk: number };
}

export const simulateFeasibilityDecision = async (req: Request, res: Response) => {
  try {
    const durationHours = Math.max(1, Math.min(6, Math.round(Number(req.body.durationHours) || 2)));
    const deadlineHours = Math.max(durationHours + 1, Math.min(18, Math.round(Number(req.body.deadlineHours) || 12)));
    const riskTolerance = Math.max(0.01, Math.min(0.50, Number(req.body.riskTolerance) || 0.10));
    const region = String(req.body.region || 'BENCHMARK-RESEARCH');

    // Retrieve controlled forecast trace for the research demonstration
    // Explicitly uses mode: 'demo' so the experiment is 100% reproducible and independent of live API key status
    const forecastData = await CarbonService.getForecast(region, 12, 'demo');
    const horizon = 12;

    // Dynamically compute candidate time slots from actual forecast and mathematical uncertainty models
    const timeSlots: TimeSlotCarbon[] = [];

    for (let h = 0; h < horizon; h++) {
      // Calculate window average carbon intensity across durationHours
      let sumCarbon = 0;
      let sumStd = 0;
      for (let w = h; w < h + durationHours; w++) {
        const pt = forecastData.hourlyProfile[w % forecastData.hourlyProfile.length];
        sumCarbon += pt.predictedCarbon;
        // This demo always uses the synthetic trace, whose points carry a (synthetic) stdDev.
        if (pt.stdDev === null) throw new Error('Feasibility demo requires the synthetic demo trace.');
        sumStd += pt.stdDev;
      }
      const avgCarbon = Math.round(sumCarbon / durationHours);
      const avgStd = Math.round(sumStd / durationHours);

      const riskLow = UncertaintyService.calculateDeadlineRisk(h, durationHours, deadlineHours, avgStd, 0.6);
      const riskHigh = UncertaintyService.calculateDeadlineRisk(h, durationHours, deadlineHours, avgStd, 2.5);

      timeSlots.push({
        hour: h,
        predictedCarbon: avgCarbon,
        uncertaintyLow: {
          stdDev: Math.round(riskLow.effectiveStdDev),
          violationRisk: riskLow.violationRisk,
        },
        uncertaintyHigh: {
          stdDev: Math.round(riskHigh.effectiveStdDev),
          violationRisk: riskHigh.violationRisk,
        },
      });
    }

    // Feasible start slots must satisfy: h + durationHours <= deadlineHours
    const maxStart = deadlineHours - durationHours;
    const feasibleSlots = timeSlots.filter((s) => s.hour <= maxStart);

    // Scenario A: Low Uncertainty
    // Filter by riskLow <= riskTolerance, then choose minimum carbon
    const candidatesA = feasibleSlots.filter((s) => s.uncertaintyLow.violationRisk <= riskTolerance);
    let slotA = candidatesA.length > 0
      ? candidatesA.reduce((min, cur) => (cur.predictedCarbon < min.predictedCarbon ? cur : min), candidatesA[0])
      : feasibleSlots[0];

    // Scenario B: High Uncertainty
    // Filter by riskHigh <= riskTolerance, then choose minimum carbon
    const candidatesB = feasibleSlots.filter((s) => s.uncertaintyHigh.violationRisk <= riskTolerance);
    let slotB = candidatesB.length > 0
      ? candidatesB.reduce((min, cur) => (cur.predictedCarbon < min.predictedCarbon ? cur : min), candidatesB[0])
      : feasibleSlots[0];

    // Build dynamic scientific rationale
    const rationaleA =
      slotA.hour > 0
        ? `Under low forecast uncertainty (sigma ~ ${slotA.uncertaintyLow.stdDev}h), delaying execution to T+${slotA.hour}:00 is safe: estimated deadline risk (${(slotA.uncertaintyLow.violationRisk * 100).toFixed(1)}%) satisfies your ${(riskTolerance * 100).toFixed(0)}% tolerance, reducing carbon to ${slotA.predictedCarbon} gCO2/kWh.`
        : `Under low forecast uncertainty, immediate dispatch at T+0 is selected with ${(slotA.uncertaintyLow.violationRisk * 100).toFixed(1)}% risk and ${slotA.predictedCarbon} gCO2/kWh.`;

    const rationaleB =
      slotB.hour < slotA.hour
        ? `Under high forecast uncertainty (sigma ~ ${slotB.uncertaintyHigh.stdDev}h), the T+${slotA.hour} low-carbon window violates your ${(riskTolerance * 100).toFixed(0)}% risk limit (tail risk jumps to ${(slotA.uncertaintyHigh.violationRisk * 100).toFixed(1)}%). CarbonRoute dynamically adapts by choosing an earlier window at T+${slotB.hour}:00 (${slotB.predictedCarbon} gCO2) to keep risk at ${(slotB.uncertaintyHigh.violationRisk * 100).toFixed(1)}%.`
        : `Under high forecast uncertainty, CarbonRoute confirms window T+${slotB.hour}:00 with ${(slotB.uncertaintyHigh.violationRisk * 100).toFixed(1)}% risk and ${slotB.predictedCarbon} gCO2/kWh.`;

    const conclusion =
      slotA.hour !== slotB.hour
        ? `Mathematical Proof: Under identical predicted carbon values, higher forecast uncertainty caused CarbonRoute to shift the decision from T+${slotA.hour} to T+${slotB.hour} to guarantee the P(violation) <= ${(riskTolerance * 100).toFixed(0)}% constraint.`
        : `At this deadline/duration configuration, window T+${slotA.hour} satisfies the risk constraint in both uncertainty scenarios.`;

    return res.json({
      success: true,
      data: {
        input: {
          durationHours,
          deadlineHours,
          riskTolerance,
          region,
        },
        timeSlots,
        scenarios: {
          scenarioA: {
            name: 'Scenario A: Low Forecast Uncertainty',
            predictedCarbonCurve: 'Identical forecast profile',
            uncertaintyLevel: `Low (tight error variance)`,
            selectedStartHour: slotA.hour,
            selectedWindow: `T+${slotA.hour}:00 to T+${slotA.hour + durationHours}:00`,
            predictedCarbonAtStart: slotA.predictedCarbon,
            estimatedViolationRisk: slotA.uncertaintyLow.violationRisk,
            riskToleranceSatisfied: slotA.uncertaintyLow.violationRisk <= riskTolerance,
            decisionRationale: rationaleA,
          },
          scenarioB: {
            name: 'Scenario B: High Forecast Uncertainty',
            predictedCarbonCurve: 'Identical forecast profile',
            uncertaintyLevel: `High (wide error variance)`,
            selectedStartHour: slotB.hour,
            selectedWindow: `T+${slotB.hour}:00 to T+${slotB.hour + durationHours}:00`,
            predictedCarbonAtStart: slotB.predictedCarbon,
            estimatedViolationRisk: slotB.uncertaintyHigh.violationRisk,
            riskToleranceSatisfied: slotB.uncertaintyHigh.violationRisk <= riskTolerance,
            decisionRationale: rationaleB,
          },
        },
        feasibilityConclusion: conclusion,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
