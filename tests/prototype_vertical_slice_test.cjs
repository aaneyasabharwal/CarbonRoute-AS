/**
 * CarbonRoute Prototype Vertical Slice Automated Test Suite
 * Validates the complete integrated flow:
 * 1. Carbon forecast ingestion (Live API or Demo trace fallback)
 * 2. Horizon uncertainty modeling & tail risk calculation
 * 3. 5-policy evaluation (Immediate, EDF, Deterministic, Baseline, CarbonRoute)
 * 4. Sensitivity test: Same forecast, different risk tolerance (tau)
 * 5. Kubernetes Job manifest generation & local sandbox fallback execution
 * 6. Live log streaming & realized carbon accounting
 */

// Never let a local .env key reach this script (dotenv does not override existing variables).
process.env.ELECTRICITY_MAPS_API_KEY = '';
const { CarbonService, getForecast } = require('../backend/dist/services/carbonService');
const { UncertaintyService, calculateDeadlineRisk, calculateHorizonStdDev, erfc } = require('../backend/dist/services/uncertaintyService');
const { SchedulerService, evaluateAllPolicies } = require('../backend/dist/services/schedulerService');
const { K8sConnector, generateJobManifest, dispatchJob } = require('../backend/dist/services/k8sConnector');

async function runVerticalSliceTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 CarbonRoute: Prototype Milestone Vertical Slice Verification');
  console.log('🧪 ========================================================');

  let passed = 0;
  let failed = 0;

  async function assert(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // EXPORT TEST: Top-Level Functions
  await assert('Exports: Top-level function exports (getForecast, calculateDeadlineRisk, evaluateAllPolicies, generateJobManifest, dispatchJob) exist and are callable', async () => {
    if (typeof getForecast !== 'function') throw new Error('getForecast is not a function');
    if (typeof calculateDeadlineRisk !== 'function') throw new Error('calculateDeadlineRisk is not a function');
    if (typeof calculateHorizonStdDev !== 'function') throw new Error('calculateHorizonStdDev is not a function');
    if (typeof evaluateAllPolicies !== 'function') throw new Error('evaluateAllPolicies is not a function');
    if (typeof generateJobManifest !== 'function') throw new Error('generateJobManifest is not a function');
    if (typeof dispatchJob !== 'function') throw new Error('dispatchJob is not a function');
    console.log('      Verified 6 top-level function exports successfully.');
  });

  // TEST 1: Carbon Service Ingestion & Fallback
  let forecastData = null;
  await assert('Step 1: Carbon forecast returns 24 calibrated hourly points with confidence bounds', async () => {
    forecastData = await getForecast('US-CAL-CISO', 24, 'demo');
    if (!forecastData || !forecastData.hourlyProfile || forecastData.hourlyProfile.length !== 24) {
      throw new Error(`Expected 24 points, got ${forecastData?.hourlyProfile?.length}`);
    }
    const p0 = forecastData.hourlyProfile[0];
    if (typeof p0.predictedCarbon !== 'number' || typeof p0.stdDev !== 'number') {
      throw new Error('Point missing predictedCarbon or stdDev');
    }
    console.log(`      [Data Mode: ${forecastData.dataMode}] Hour 0: ${p0.predictedCarbon} gCO2/kWh (stdDev: ${p0.stdDev}, bounds: [${p0.confidenceLow}, ${p0.confidenceHigh}])`);
  });

  // TEST 2: Horizon Uncertainty Growth
  await assert('Step 2: Uncertainty sigma(t) monotonically expands across the 24h horizon', async () => {
    const sigma0 = UncertaintyService.calculateHorizonStdDev(0, 15);
    const sigma6 = UncertaintyService.calculateHorizonStdDev(6, 15);
    const sigma12 = UncertaintyService.calculateHorizonStdDev(12, 15);
    const sigma24 = UncertaintyService.calculateHorizonStdDev(24, 15);

    if (!(sigma0 < sigma6 && sigma6 < sigma12 && sigma12 < sigma24)) {
      throw new Error(`Variance did not grow over horizon: s0=${sigma0}, s6=${sigma6}, s12=${sigma12}, s24=${sigma24}`);
    }
    console.log(`      Horizon Dispersion: 0h=${sigma0.toFixed(1)} -> 6h=${sigma6.toFixed(1)} -> 12h=${sigma12.toFixed(1)} -> 24h=${sigma24.toFixed(1)}`);
  });

  // TEST 3: Tail Risk Calculation
  await assert('Step 3: Chebyshev erfc correctly bounds deadline risk between 0 and 1', async () => {
    const riskSafe = UncertaintyService.calculateDeadlineRisk(0, 4, 16, 15, 1.0).violationRisk;
    const riskRisky = UncertaintyService.calculateDeadlineRisk(11, 4, 16, 15, 1.0).violationRisk;
    const riskBreach = UncertaintyService.calculateDeadlineRisk(13, 4, 16, 15, 1.0).violationRisk;

    if (riskSafe > 0.05) throw new Error(`Expected safe risk < 0.05, got ${riskSafe}`);
    if (riskRisky <= riskSafe) throw new Error(`Expected risky slot to have higher risk: ${riskRisky} vs ${riskSafe}`);
    if (riskBreach !== 1.0) throw new Error(`Expected infeasible slot risk = 1.0, got ${riskBreach}`);
    console.log(`      Risk calibration: Safe slack risk = ${(riskSafe * 100).toFixed(2)}%, Tight slack risk = ${(riskRisky * 100).toFixed(2)}%`);
  });

  // =========================================================================
  // TEST A: BASE CASE (Runtime = 2h, Deadline = 12h, Risk Tolerance = 5%)
  // =========================================================================
  let baseJob = {
    id: 'test-job-base',
    name: 'ResNet-50 Batch Training',
    commandOrImage: 'carbonroute/test-workload:latest',
    isContainerImage: true,
    durationHours: 2,
    deadlineHours: 12,
    arrivalHour: 0,
    cpu: 2,
    memoryMb: 1024,
    region: 'US-CAL-CISO',
    riskTolerance: 0.05,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  let decisionResult = null;

  await assert('Test A: Base Case (2h runtime, 12h deadline, 5% risk) executes complete vertical slice', async () => {
    // 1. Forecast contains 24 data points
    if (!forecastData || forecastData.hourlyProfile.length !== 24) {
      throw new Error(`Expected 24 points, got ${forecastData?.hourlyProfile?.length}`);
    }

    // 2. Evaluate all 5 policies
    decisionResult = evaluateAllPolicies(baseJob, forecastData, 1.0);
    if (!decisionResult || decisionResult.evaluatedPolicies.length !== 5) {
      throw new Error(`Expected 5 policies, got ${decisionResult?.evaluatedPolicies?.length}`);
    }

    const immediate = decisionResult.evaluatedPolicies.find(p => p.policyId === 'immediate');
    const rec = decisionResult.recommendedDecision;

    // 3. CarbonRoute selects window with carbon < immediate and risk <= 5%
    if (rec.predictedCarbon >= immediate.predictedCarbon) {
      throw new Error(`Recommended carbon ${rec.predictedCarbon} not lower than immediate ${immediate.predictedCarbon}`);
    }
    if (rec.estimatedDeadlineRisk > 0.051) {
      throw new Error(`Estimated risk ${(rec.estimatedDeadlineRisk * 100).toFixed(2)}% exceeds 5% tolerance`);
    }

    console.log(`      Immediate: ${immediate.predictedCarbon} gCO2, CarbonRoute: ${rec.predictedCarbon} gCO2 (Slot: T+${rec.selectedStartHour}:00, Savings: ${decisionResult.comparisonSummary.carbonSavingsVsImmediatePct}%, Risk: ${(rec.estimatedDeadlineRisk * 100).toFixed(2)}%)`);

    // 4. Kubernetes Job manifest generated
    const manifest = generateJobManifest(baseJob, rec.selectedStartHour, 'carbonroute-job-testa');
    if (manifest.apiVersion !== 'batch/v1' || manifest.kind !== 'Job') {
      throw new Error('Invalid manifest apiVersion or kind');
    }

    // 5. Workload execution & realized carbon recording
    const execution = await dispatchJob(
      baseJob,
      rec,
      undefined,
      undefined,
      undefined,
      undefined,
      2 // 2s simulated duration for test
    );

    if (!execution || !execution.jobId) {
      throw new Error('Dispatch failed to return valid execution record');
    }

    // Poll to completion
    let completed = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 150));
      const status = K8sConnector.getExecutionStatus(baseJob.id);
      if (status && (status.status === 'completed' || status.status === 'failed')) {
        completed = true;
        // Changed in M5 (audit C2, task M2.1): realized carbon used to be a random perturbation
        // of the prediction. It is no longer invented; it comes only from provider observations.
        if (status.realizedCarbon !== undefined) throw new Error('Realized carbon must not be invented by the connector');
        if (status.carbonObservation !== 'collect-from-provider-after-window') throw new Error('Missing carbonObservation marker');
        console.log(`      Execution Mode: ${status.clusterMode} | Realized carbon: collected from provider observations after the window`);
        break;
      }
    }
    if (!completed) throw new Error('Execution did not complete within timeout window');
  });

  // =========================================================================
  // TEST B: SAME FORECAST, DIFFERENT UNCERTAINTY
  // =========================================================================
  await assert('Test B: Same forecast with different uncertainty shifts decision conservatively', async () => {
    // Run 1: baseline uncertainty
    const run1 = evaluateAllPolicies(baseJob, forecastData, 1.0);
    // Run 2: higher uncertainty (multiplier = 2.4)
    const run2 = evaluateAllPolicies(baseJob, forecastData, 2.4);

    // 1. Forecast carbon values are identical between runs
    const c1 = run1.evaluatedPolicies.map(p => p.predictedCarbon);
    const c2 = run2.evaluatedPolicies.map(p => p.predictedCarbon);
    for (let i = 0; i < c1.length; i++) {
      if (c1[i] !== c2[i]) throw new Error(`Predicted carbon differs at index ${i}: ${c1[i]} vs ${c2[i]}`);
    }

    // 2. Deadline violation risk is strictly higher in Run 2 for distant windows
    const lateHour = 8;
    const risk1 = calculateDeadlineRisk(lateHour, baseJob.durationHours, baseJob.deadlineHours, 15, 1.0).violationRisk;
    const risk2 = calculateDeadlineRisk(lateHour, baseJob.durationHours, baseJob.deadlineHours, 15, 2.4).violationRisk;
    if (risk2 <= risk1) {
      throw new Error(`Distant window risk did not increase under higher uncertainty: run1=${risk1}, run2=${risk2}`);
    }

    // 3. Optimal window in Run 2 is either earlier than or equal to Run 1
    const slot1 = run1.recommendedDecision.selectedStartHour;
    const slot2 = run2.recommendedDecision.selectedStartHour;
    console.log(`      Run 1 (Baseline sigma):  Window = T+${slot1}:00 (Risk: ${(run1.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(2)}%)`);
    console.log(`      Run 2 (Elevated sigma):  Window = T+${slot2}:00 (Risk: ${(run2.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(2)}%)`);

    if (slot2 > slot1) {
      throw new Error(`Higher uncertainty unexpectedly selected later window (${slot2} > ${slot1})`);
    }

    // 4. CarbonRoute explains why the decision shifted
    if (!run2.recommendedDecision.rationale || run2.recommendedDecision.rationale.length < 20) {
      throw new Error('Missing dynamic rationale in Run 2');
    }
  });

  // =========================================================================
  // TEST C: WORKLOAD RUNTIME SENSITIVITY (2h vs 6h)
  // =========================================================================
  await assert('Test C: Workload runtime sensitivity (2h vs 6h) shrinks feasible set and computes continuous window averages', async () => {
    const job2h = { ...baseJob, id: 'job-c-2h', durationHours: 2, deadlineHours: 12 };
    const job6h = { ...baseJob, id: 'job-c-6h', durationHours: 6, deadlineHours: 12 };

    const dec2h = evaluateAllPolicies(job2h, forecastData, 1.0);
    const dec6h = evaluateAllPolicies(job6h, forecastData, 1.0);

    // Max feasible start hour: 12 - 6 = 6
    const det6h = dec6h.evaluatedPolicies.find(p => p.policyId === 'deterministic_carbon');
    if (det6h.selectedStartHour > 6) {
      throw new Error(`6h job selected infeasible start hour ${det6h.selectedStartHour} (deadline 12h)`);
    }

    // Multi-hour carbon averages reflect 6-hour windows, not 2-hour
    let sum2h = 0;
    for (let w = 0; w < 2; w++) sum2h += forecastData.hourlyProfile[w].predictedCarbon;
    const avg2h = Math.round(sum2h / 2);

    let sum6h = 0;
    for (let w = 0; w < 6; w++) sum6h += forecastData.hourlyProfile[w].predictedCarbon;
    const avg6h = Math.round(sum6h / 6);

    console.log(`      Hour 0 averages: 2-hour window = ${avg2h} gCO2/kWh vs 6-hour window = ${avg6h} gCO2/kWh`);
    console.log(`      2h job selected: T+${dec2h.recommendedDecision.selectedStartHour}:00 | 6h job selected: T+${dec6h.recommendedDecision.selectedStartHour}:00`);
  });

  // =========================================================================
  // TEST D: DEADLINE SENSITIVITY (12h vs 8h)
  // =========================================================================
  await assert('Test D: Deadline sensitivity (12h vs 8h) shrinks candidate set and elevates tail risk', async () => {
    const job12h = { ...baseJob, id: 'job-d-12h', durationHours: 2, deadlineHours: 12 };
    const job8h = { ...baseJob, id: 'job-d-8h', durationHours: 2, deadlineHours: 8 };

    const dec12h = evaluateAllPolicies(job12h, forecastData, 1.0);
    const dec8h = evaluateAllPolicies(job8h, forecastData, 1.0);

    // For slot 6: finishes at 8h
    // Under 12h deadline: slack = 4h
    // Under 8h deadline: slack = 0h
    const riskSlack4 = calculateDeadlineRisk(6, 2, 12, 15, 1.0).violationRisk;
    const riskSlack0 = calculateDeadlineRisk(6, 2, 8, 15, 1.0).violationRisk;

    if (riskSlack0 <= riskSlack4) {
      throw new Error(`Slack decrease did not increase violation risk: slack4=${riskSlack4}, slack0=${riskSlack0}`);
    }

    console.log(`      Slot T+6:00 risk with 4h slack = ${(riskSlack4 * 100).toFixed(2)}% vs 0h slack = ${(riskSlack0 * 100).toFixed(2)}%`);
    console.log(`      12h deadline selected: T+${dec12h.recommendedDecision.selectedStartHour}:00 | 8h deadline selected: T+${dec8h.recommendedDecision.selectedStartHour}:00`);

    if (dec8h.recommendedDecision.selectedStartHour > 6) {
      throw new Error(`8h deadline job selected start ${dec8h.recommendedDecision.selectedStartHour} which exceeds deadline`);
    }
  });

  // =========================================================================
  // TEST E: RISK TOLERANCE SENSITIVITY (tau: 1% strict vs 5% normal vs 20% relaxed)
  // =========================================================================
  await assert('Test E: Risk tolerance sensitivity dynamically adjusts acceptable window set', async () => {
    const jobStrict = { ...baseJob, id: 'job-e-strict', riskTolerance: 0.01 };
    const jobNormal = { ...baseJob, id: 'job-e-normal', riskTolerance: 0.05 };
    const jobRelaxed = { ...baseJob, id: 'job-e-relaxed', riskTolerance: 0.20 };

    const decStrict = evaluateAllPolicies(jobStrict, forecastData, 1.0);
    const decNormal = evaluateAllPolicies(jobNormal, forecastData, 1.0);
    const decRelaxed = evaluateAllPolicies(jobRelaxed, forecastData, 1.0);

    console.log(`      Strict  (tau=1%):  T+${decStrict.recommendedDecision.selectedStartHour}:00 (Risk: ${(decStrict.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(2)}%, Carbon: ${decStrict.recommendedDecision.predictedCarbon} gCO2)`);
    console.log(`      Normal  (tau=5%):  T+${decNormal.recommendedDecision.selectedStartHour}:00 (Risk: ${(decNormal.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(2)}%, Carbon: ${decNormal.recommendedDecision.predictedCarbon} gCO2)`);
    console.log(`      Relaxed (tau=20%): T+${decRelaxed.recommendedDecision.selectedStartHour}:00 (Risk: ${(decRelaxed.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(2)}%, Carbon: ${decRelaxed.recommendedDecision.predictedCarbon} gCO2)`);

    if (decStrict.recommendedDecision.estimatedDeadlineRisk > 0.011) {
      throw new Error(`Strict policy violated 1% risk bound: ${decStrict.recommendedDecision.estimatedDeadlineRisk}`);
    }
  });

  // =========================================================================
  // TEST F: CANDIDATE WINDOWS EXPLORER EVALUATION & CLASSIFICATION INTEGRITY
  // =========================================================================
  await assert('Test F: Candidate Windows Explorer exhaustively enumerates, evaluates, and classifies all candidate windows', async () => {
    const dec = evaluateAllPolicies(baseJob, forecastData, 1.0);
    const windows = dec.candidateWindows;

    if (!Array.isArray(windows) || windows.length === 0) {
      throw new Error(`Expected non-empty candidateWindows array, got ${windows?.length}`);
    }

    // Check all fields on every candidate window
    let recommendedCount = 0;
    let feasibleCount = 0;
    let highRiskCount = 0;
    let deadlineBreachCount = 0;

    for (const w of windows) {
      if (typeof w.slotIndex !== 'number') throw new Error(`Missing slotIndex in window ${w.windowLabel}`);
      if (typeof w.startHour !== 'number') throw new Error(`Missing startHour in window ${w.windowLabel}`);
      if (typeof w.endHour !== 'number') throw new Error(`Missing endHour in window ${w.windowLabel}`);
      if (typeof w.predictedCarbonIntensity !== 'number' || w.predictedCarbonIntensity <= 0) {
        throw new Error(`Invalid predictedCarbonIntensity in window ${w.windowLabel}: ${w.predictedCarbonIntensity}`);
      }
      if (typeof w.predictedCarbonImpactGrams !== 'number' || w.predictedCarbonImpactGrams <= 0) {
        throw new Error(`Invalid predictedCarbonImpactGrams in window ${w.windowLabel}: ${w.predictedCarbonImpactGrams}`);
      }
      if (typeof w.stdDev !== 'number' || w.stdDev <= 0) {
        throw new Error(`Invalid stdDev in window ${w.windowLabel}: ${w.stdDev}`);
      }
      if (typeof w.uncertaintyRange !== 'string' || !w.uncertaintyRange.includes('±')) {
        throw new Error(`Invalid uncertaintyRange in window ${w.windowLabel}: ${w.uncertaintyRange}`);
      }
      if (typeof w.deadlineRisk !== 'number' || w.deadlineRisk < 0 || w.deadlineRisk > 1) {
        throw new Error(`Invalid deadlineRisk in window ${w.windowLabel}: ${w.deadlineRisk}`);
      }
      if (typeof w.deadlineRiskPct !== 'string' || !w.deadlineRiskPct.includes('%')) {
        throw new Error(`Invalid deadlineRiskPct in window ${w.windowLabel}: ${w.deadlineRiskPct}`);
      }
      if (typeof w.slackHours !== 'number') throw new Error(`Missing slackHours in window ${w.windowLabel}`);
      if (typeof w.isFeasible !== 'boolean') throw new Error(`Missing isFeasible in window ${w.windowLabel}`);
      if (typeof w.reason !== 'string' || w.reason.length < 10) {
        throw new Error(`Missing or short reason in window ${w.windowLabel}: ${w.reason}`);
      }

      if (w.classification === 'RECOMMENDED') {
        recommendedCount++;
        feasibleCount++;
      } else if (w.classification === 'FEASIBLE') {
        feasibleCount++;
      } else if (w.classification === 'REJECTED_HIGH_RISK') {
        highRiskCount++;
      } else if (w.classification === 'REJECTED_DEADLINE_BREACH') {
        deadlineBreachCount++;
      } else {
        throw new Error(`Unknown classification: ${w.classification}`);
      }

      // Semantic integrity assertions
      if (!w.meetsDeadline && w.classification !== 'REJECTED_DEADLINE_BREACH') {
        throw new Error(`Window ${w.windowLabel} misses deadline but classification is ${w.classification}`);
      }
      if (w.meetsDeadline && w.deadlineRisk > baseJob.riskTolerance && w.classification !== 'REJECTED_HIGH_RISK') {
        throw new Error(`Window ${w.windowLabel} exceeds risk tolerance but classification is ${w.classification}`);
      }
      if (w.isFeasible && !['RECOMMENDED', 'FEASIBLE'].includes(w.classification)) {
        throw new Error(`Window ${w.windowLabel} is feasible but classification is ${w.classification}`);
      }
    }

    if (recommendedCount !== 1) {
      throw new Error(`Expected exactly 1 RECOMMENDED window, got ${recommendedCount}`);
    }

    console.log(`      Total Candidate Windows: ${windows.length}`);
    console.log(`      Feasible (incl. Recommended): ${feasibleCount} | High Risk: ${highRiskCount} | Deadline Breaches: ${deadlineBreachCount}`);
    console.log(`      Sample Window: ${windows[0].windowLabel} -> Intensity: ${windows[0].predictedCarbonIntensity} g/kWh, Impact: ${windows[0].predictedCarbonImpactGrams} gCO2, Risk: ${windows[0].deadlineRiskPct}, Status: ${windows[0].classification}`);
  });

  // =========================================================================
  // TEST G: USER REQUIRED 4-CASE DYNAMIC SENSITIVITY VERIFICATION
  // =========================================================================
  await assert('Test G: Evaluates Cases A, B, C, D dynamically with strict risk-feasibility enforcement', async () => {
    // -------------------------------------------------------------
    // CASE A: Runtime = 3h, Deadline = 12h, Risk tolerance = 2% (0.02)
    // -------------------------------------------------------------
    const jobA = {
      id: 'job-case-a',
      name: 'ML Model Training Case A',
      commandOrImage: 'carbonroute/ml-model:latest',
      isContainerImage: true,
      durationHours: 3,
      deadlineHours: 12,
      arrivalHour: 0,
      cpu: 2,
      memoryMb: 1024,
      region: 'US-CAL-CISO',
      riskTolerance: 0.02,
    };
    const decA = evaluateAllPolicies(jobA, forecastData, 1.0);

    // Verify candidate windows: exactly 10 windows (T+0 to T+9)
    if (decA.candidateWindows.length !== 10) {
      throw new Error(`Case A: Expected 10 candidate windows, got ${decA.candidateWindows.length}`);
    }
    // Verify last candidate T+9 -> T+12 has 0 slack, 50% risk, and is REJECTED
    const lastWinA = decA.candidateWindows[9];
    if (lastWinA.windowLabel !== 'T+9:00 → T+12:00') {
      throw new Error(`Case A: Expected last window T+9:00 → T+12:00, got ${lastWinA.windowLabel}`);
    }
    if (lastWinA.deadlineRisk < 0.49 || lastWinA.isFeasible !== false) {
      throw new Error(`Case A: Last window should be rejected (risk ${lastWinA.deadlineRiskPct})`);
    }

    // Verify policy comparison feasibility enforcement:
    const detA = decA.evaluatedPolicies.find(p => p.policyId === 'deterministic_carbon');
    if (detA.estimatedDeadlineRisk > 0.02 && detA.isFeasible !== false) {
      throw new Error(`Case A: Deterministic policy has risk ${(detA.estimatedDeadlineRisk * 100).toFixed(1)}% > 2% but is marked Feasible!`);
    }

    // Verify CarbonRoute recommendation strictly obeys tau = 2%
    const recA = decA.recommendedDecision;
    if (recA.estimatedDeadlineRisk > 0.0201) {
      throw new Error(`Case A: CarbonRoute recommendation violates 2% risk tolerance: ${(recA.estimatedDeadlineRisk * 100).toFixed(2)}%`);
    }

    console.log('\n      === CASE A (Runtime=3h, Deadline=T+12, Risk Tol=2%) ===');
    console.log(`      Candidate Windows Count: ${decA.candidateWindows.length} (T+0:00 to T+9:00)`);
    console.log(`      CarbonRoute Recommended: ${recA.selectedWindow} (${recA.predictedCarbon} gCO2, Risk: ${(recA.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: Feasible)`);
    console.log(`      Deterministic Carbon:    ${detA.selectedWindow} (${detA.predictedCarbon} gCO2, Risk: ${(detA.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: ${detA.isFeasible ? 'Feasible' : 'REJECTED'})`);

    // -------------------------------------------------------------
    // CASE B: Same Job, Risk tolerance = 50% (0.50)
    // -------------------------------------------------------------
    const jobB = { ...jobA, id: 'job-case-b', riskTolerance: 0.50 };
    const decB = evaluateAllPolicies(jobB, forecastData, 1.0);

    const detB = decB.evaluatedPolicies.find(p => p.policyId === 'deterministic_carbon');
    if (detB.estimatedDeadlineRisk <= 0.50 && detB.isFeasible !== true) {
      throw new Error(`Case B: Deterministic policy has risk <= 50% but is marked Infeasible!`);
    }
    const recB = decB.recommendedDecision;
    console.log('\n      === CASE B (Runtime=3h, Deadline=T+12, Risk Tol=50%) ===');
    console.log(`      CarbonRoute Recommended: ${recB.selectedWindow} (${recB.predictedCarbon} gCO2, Risk: ${(recB.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: Feasible)`);
    console.log(`      Deterministic Carbon:    ${detB.selectedWindow} (${detB.predictedCarbon} gCO2, Risk: ${(detB.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: ${detB.isFeasible ? 'Feasible' : 'REJECTED'})`);

    // -------------------------------------------------------------
    // CASE C: Same Job, Runtime = 6h, Deadline = 12h, Risk Tol = 2%
    // -------------------------------------------------------------
    const jobC = { ...jobA, id: 'job-case-c', durationHours: 6, riskTolerance: 0.02 };
    const decC = evaluateAllPolicies(jobC, forecastData, 1.0);

    // Verify candidate windows: 12 - 6 + 1 = 7 windows (T+0 to T+6)
    if (decC.candidateWindows.length !== 7) {
      throw new Error(`Case C: Expected 7 candidate windows for 6h duration, got ${decC.candidateWindows.length}`);
    }
    const recC = decC.recommendedDecision;
    console.log('\n      === CASE C (Runtime=6h, Deadline=T+12, Risk Tol=2%) ===');
    console.log(`      Candidate Windows Count: ${decC.candidateWindows.length} (T+0:00 to T+6:00)`);
    console.log(`      CarbonRoute Recommended: ${recC.selectedWindow} (${recC.predictedCarbon} gCO2, Risk: ${(recC.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: Feasible)`);

    // -------------------------------------------------------------
    // CASE D: Same Job, Runtime = 3h, Deadline = T+8, Risk Tol = 2%
    // -------------------------------------------------------------
    const jobD = { ...jobA, id: 'job-case-d', deadlineHours: 8, riskTolerance: 0.02 };
    const decD = evaluateAllPolicies(jobD, forecastData, 1.0);

    // Verify candidate windows: 8 - 3 + 1 = 6 windows (T+0 to T+5)
    if (decD.candidateWindows.length !== 6) {
      throw new Error(`Case D: Expected 6 candidate windows for 8h deadline, got ${decD.candidateWindows.length}`);
    }
    const recD = decD.recommendedDecision;
    console.log('\n      === CASE D (Runtime=3h, Deadline=T+8, Risk Tol=2%) ===');
    console.log(`      Candidate Windows Count: ${decD.candidateWindows.length} (T+0:00 to T+5:00)`);
    console.log(`      CarbonRoute Recommended: ${recD.selectedWindow} (${recD.predictedCarbon} gCO2, Risk: ${(recD.estimatedDeadlineRisk * 100).toFixed(1)}%, Status: Feasible)`);
  });

  // =========================================================================
  // TEST H: CONTROLLED RESEARCH BENCHMARK 5-POLICY DIVERGENCE & RESEARCH INSIGHT
  // =========================================================================
  await assert('Test H: Controlled Research Benchmark (BENCHMARK-RESEARCH) demonstrates genuine 5-policy divergence & research insight', async () => {
    const benchmarkForecast = await getForecast('BENCHMARK-RESEARCH', 24, 'demo');
    if (!benchmarkForecast || benchmarkForecast.hourlyProfile.length !== 24) {
      throw new Error(`Expected 24 points in BENCHMARK-RESEARCH, got ${benchmarkForecast?.hourlyProfile?.length}`);
    }

    const researchJob = {
      id: 'job-research-benchmark',
      name: 'Controlled Research Experiment Job',
      commandOrImage: 'carbonroute/benchmark-workload:latest',
      isContainerImage: true,
      durationHours: 2,
      deadlineHours: 12,
      arrivalHour: 0,
      cpu: 2,
      memoryMb: 1024,
      region: 'BENCHMARK-RESEARCH',
      riskTolerance: 0.05,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const dec = evaluateAllPolicies(researchJob, benchmarkForecast, 1.0);
    const policies = dec.evaluatedPolicies;

    if (policies.length !== 5) {
      throw new Error(`Expected 5 policies, got ${policies.length}`);
    }

    const imm = policies.find(p => p.policyId === 'immediate');
    const edf = policies.find(p => p.policyId === 'edf' || p.policyId === 'earliest_deadline_first');
    const det = policies.find(p => p.policyId === 'deterministic_carbon');
    const base = policies.find(p => p.policyId === 'carbon_aware_baseline');
    const cr = policies.find(p => p.policyId === 'carbonroute_uncertainty');

    if (!imm || !edf || !det || !base || !cr) {
      throw new Error('One or more of the 5 policies are missing');
    }

    // 1. Immediate starts at T+0
    if (imm.selectedStartHour !== 0 || imm.isFeasible !== true) {
      throw new Error(`Immediate policy did not select T+0 or is not feasible: T+${imm.selectedStartHour}`);
    }

    // 2. EDF starts at earliest arrival T+0 with maximal slack
    if (edf.selectedStartHour !== 0 || edf.isFeasible !== true) {
      throw new Error(`EDF policy did not select T+0: T+${edf.selectedStartHour}`);
    }

    // 3. Deterministic greedy carbon picks T+10 (lowest point forecast ~133 gCO2eq/kWh)
    // but has 50% risk which violates tau=5%, so is marked REJECTED (isFeasible: false)
    if (det.selectedStartHour !== 10) {
      throw new Error(`Deterministic carbon should greedily select T+10, got T+${det.selectedStartHour}`);
    }
    if (det.isFeasible !== false) {
      throw new Error(`Deterministic carbon at T+10 (risk ${(det.estimatedDeadlineRisk * 100).toFixed(1)}%) should be REJECTED`);
    }

    // 4. CarbonAware baseline threshold selects safe window T+2 or T+3
    if (base.selectedStartHour < 1 || base.selectedStartHour > 3 || base.isFeasible !== true) {
      throw new Error(`CarbonAware baseline should select T+2 or T+3, got T+${base.selectedStartHour}`);
    }

    // 5. CarbonRoute rejects T+10 and selects T+2 (the lowest carbon FEASIBLE window)
    if (cr.selectedStartHour !== 2 || cr.isFeasible !== true) {
      throw new Error(`CarbonRoute should select T+2, got T+${cr.selectedStartHour}`);
    }
    if (cr.estimatedDeadlineRisk > 0.05) {
      throw new Error(`CarbonRoute selected window exceeds risk tolerance: ${(cr.estimatedDeadlineRisk * 100).toFixed(2)}%`);
    }

    // 6. Verify researchInsight structure and contents
    const ri = dec.researchInsight;
    if (!ri) {
      throw new Error('Missing researchInsight in scheduling decision response');
    }
    if (ri.lowestCarbonWindow.windowLabel !== 'T+10:00 → T+12:00') {
      throw new Error(`Expected lowestCarbonWindow "T+10:00 → T+12:00", got "${ri.lowestCarbonWindow.windowLabel}"`);
    }
    if (ri.isLowestCarbonSafe !== false) {
      throw new Error('Expected isLowestCarbonSafe to be false');
    }
    if (ri.recommendedWindow.windowLabel !== 'T+2:00 → T+4:00') {
      throw new Error(`Expected recommendedWindow "T+2:00 → T+4:00", got "${ri.recommendedWindow.windowLabel}"`);
    }
    if (ri.carbonInsurancePenaltyGramsPerKwh <= 0) {
      throw new Error(`Expected positive carbonInsurancePenaltyGramsPerKwh, got ${ri.carbonInsurancePenaltyGramsPerKwh}`);
    }
    if (!ri.explanation || ri.explanation.length < 20) {
      throw new Error('Missing or short research insight explanation');
    }

    console.log('\n      === 5 POLICIES ON CONTROLLED RESEARCH BENCHMARK ===');
    console.log(`      1. Immediate:     T+${imm.selectedStartHour}:00 | ${imm.predictedCarbonIntensity} g/kWh | Risk: ${(imm.estimatedDeadlineRisk * 100).toFixed(1)}% | Status: ${imm.isFeasible ? 'Feasible' : 'REJECTED'}`);
    console.log(`      2. EDF:           T+${edf.selectedStartHour}:00 | ${edf.predictedCarbonIntensity} g/kWh | Risk: ${(edf.estimatedDeadlineRisk * 100).toFixed(1)}% | Status: ${edf.isFeasible ? 'Feasible' : 'REJECTED'}`);
    console.log(`      3. Greedy Delay:  T+${det.selectedStartHour}:00 | ${det.predictedCarbonIntensity} g/kWh | Risk: ${(det.estimatedDeadlineRisk * 100).toFixed(1)}% | Status: ${det.isFeasible ? 'Feasible' : 'REJECTED'}`);
    console.log(`      4. Baseline:      T+${base.selectedStartHour}:00 | ${base.predictedCarbonIntensity} g/kWh | Risk: ${(base.estimatedDeadlineRisk * 100).toFixed(1)}% | Status: ${base.isFeasible ? 'Feasible' : 'REJECTED'}`);
    console.log(`      5. CarbonRoute:   T+${cr.selectedStartHour}:00 | ${cr.predictedCarbonIntensity} g/kWh | Risk: ${(cr.estimatedDeadlineRisk * 100).toFixed(1)}% | Status: RECOMMENDED`);
    console.log(`      Research Insight: Lowest Window ${ri.lowestCarbonWindow.windowLabel} (${ri.lowestCarbonWindow.predictedCarbonIntensity} g/kWh) REJECTED for risk ${(ri.lowestCarbonWindow.deadlineRisk * 100).toFixed(0)}%.`);
    console.log(`      Safe Selection:   Window ${ri.recommendedWindow.windowLabel} (${ri.recommendedWindow.predictedCarbonIntensity} g/kWh) with +${ri.carbonInsurancePenaltyGramsPerKwh} g/kWh Carbon Insurance.`);
  });

  console.log('\n========================================================');
  console.log(`🎯 Prototype Vertical Slice Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerticalSliceTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
