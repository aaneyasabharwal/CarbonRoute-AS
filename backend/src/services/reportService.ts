/**
 * Job report: assembled only from stored records (job, forecast snapshot, decision,
 * execution, observation collections). It reports what was recorded; when something was
 * not observed it says so instead of filling it in.
 */
import { schedulingStore, SchedulingStore } from '../models/schedulingStore';
import { evaluateJob, WorkflowError } from './schedulingWorkflow';

export function buildReport(jobId: string, store: SchedulingStore = schedulingStore()) {
  const job = store.getJob(jobId);
  if (!job) throw new WorkflowError(404, `Job ${jobId} was not found.`);
  const { decision, snapshot, observationSet, evaluation, realized, observedComparison } = evaluateJob(jobId, store);
  const execution = store.latestExecutionForJob(jobId) ?? null;
  const result = decision.result || {};
  const synthetic = decision.dataClass === 'synthetic';

  const limitations = [
    'Energy use is an assumption (see energyAssumption), not a measurement; all emissions figures inherit this assumption.',
    'Electricity Maps forecasts carry no uncertainty estimate, so live deadline risk is deterministic (the window either fits before the deadline or it does not).',
    'Only the last 24 hours of Electricity Maps history are available on the current plan; observations not collected within that window are unavailable.',
  ];
  if (synthetic) limitations.unshift('SYNTHETIC DATA: this decision used the built-in demo trace, not real carbon data. No real-world conclusions can be drawn.');
  if (execution?.executionMode === 'simulated-no-workload') {
    limitations.push('Execution was simulated: no workload process was run. Carbon accounting uses the scheduled window, not a measured runtime.');
  }
  if (!execution) limitations.push('The job has not been dispatched yet.');
  if (result.timeline?.deadlineBeyondForecast) {
    limitations.push(`The deadline is after the end of the forecast (${result.timeline.forecastCoverageEndUtc}); later windows were not evaluated.`);
  }

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    dataClass: decision.dataClass,
    job: {
      id: job.id,
      name: job.name,
      zone: job.zone,
      durationHours: job.durationHours,
      cpu: job.cpu,
      memoryMb: job.memoryMb,
      arrivalAt: job.arrivalAt,
      deadlineAt: job.deadlineAt,
      riskTolerance: job.riskTolerance,
    },
    region: { zone: job.zone, timezone: result.timeline?.timezone ?? null },
    dataProvenance: snapshot
      ? {
          provider: snapshot.provider,
          dataClass: snapshot.dataClass,
          endpoint: snapshot.endpoint,
          forecastIssuedAt: snapshot.issuedAt,
          forecastFetchedAt: snapshot.fetchedAt,
          horizonHours: snapshot.horizonHours,
          granularity: snapshot.granularity,
          emissionFactorType: snapshot.emissionFactorType,
          unit: snapshot.unit,
          rawResponseSha256: snapshot.rawSha256,
          snapshotId: snapshot.id,
          observationsEndpoint: observationSet?.endpoint ?? null,
          observationsCollectedAt: observationSet?.collectedAt ?? null,
        }
      : null,
    decision: {
      id: decision.id,
      status: decision.status,
      engineVersion: decision.engineVersion,
      createdAt: decision.createdAt,
      riskModel: decision.riskModel,
      infeasibilityReason: decision.infeasibilityReason ?? null,
      recommendedPolicy: result.recommendedDecision?.policyName ?? null,
      recommendedWindow: decision.recommendedWindow,
      rationale: result.recommendedDecision?.rationale ?? null,
      deadlineCompliance: decision.recommendedWindow
        ? {
            scheduledEndUtc: decision.recommendedWindow.endUtc,
            deadlineAt: job.deadlineAt,
            meetsDeadline: Date.parse(decision.recommendedWindow.endUtc) <= Date.parse(job.deadlineAt),
            basis: 'Scheduled window end compared with the deadline.',
          }
        : null,
      algorithmComparison: (result.evaluatedPolicies || []).map((p: any) => ({
        policy: p.policyName,
        category: p.category,
        startUtc: p.selectedStartUtc ?? null,
        endUtc: p.selectedEndUtc ?? null,
        predictedIntensity: p.predictedCarbonIntensity,
        predictedEmissionsGrams: p.estimatedWorkloadEmissionsGrams,
        meetsDeadline: p.meetsDeadline ?? null,
        rationale: p.rationale,
      })),
      predictedSavingsVsImmediatePct: result.comparisonSummary?.carbonSavingsVsImmediatePct ?? null,
      predictedSavingsLabel: 'Predicted from the forecast, not observed.',
      energyAssumption: decision.energyAssumption,
    },
    execution: execution
      ? {
          mode: execution.executionMode,
          dispatchedAt: execution.dispatchedAt,
          scheduledStartUtc: execution.scheduledStartUtc,
          scheduledEndUtc: execution.scheduledEndUtc,
          note: execution.note,
        }
      : null,
    observations: observationSet
      ? {
          status: observationSet.status,
          statusDetail: observationSet.statusDetail,
          collectedAt: observationSet.collectedAt,
          intervals: observationSet.intervals,
          missingIntervals: observationSet.missingIntervals,
          points: observationSet.observations.map((o) => ({
            datetime: o.datetime,
            carbonIntensity: o.carbonIntensity,
            quality: o.quality,
            isEstimated: o.isEstimated,
            estimationMethod: o.estimationMethod,
          })),
        }
      : { status: 'NOT_COLLECTED', statusDetail: 'Observations have not been collected yet.', points: [] as any[] },
    forecastError: evaluation
      ? {
          pairs: evaluation.pairs,
          unmatchedIntervals: evaluation.unmatchedIntervals,
          versusMeasured: evaluation.measured,
          versusProviderEstimate: evaluation.providerEstimate,
          definition: 'error = forecast - observed, gCO2eq/kWh. Computed only for intervals with both values; measured and estimated observations are reported separately.',
        }
      : null,
    realized,
    observedComparison,
    limitations,
  };
}

const esc = (v: unknown) =>
  String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Self-contained printable HTML version of the report. */
export function renderReportHtml(r: ReturnType<typeof buildReport>): string {
  const row = (cells: unknown[]) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
  const metrics = (m: any) => (m ? `n=${m.n}, MAE=${m.mae}, RMSE=${m.rmse}, bias=${m.bias} ${m.unit}` : 'not available (no matching observations of this kind)');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CarbonRoute job report ${esc(r.job.id)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px auto;max-width:960px;padding:0 16px;color:#111;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #ccc}
table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f3f3f3}.warn{background:#fff4d6;border:1px solid #e0b400;padding:8px}.badge{font-size:12px;padding:1px 6px;border-radius:8px;background:#eee}
</style></head><body>
<h1>CarbonRoute job report</h1>
<p>Job <b>${esc(r.job.id)}</b> (${esc(r.job.name)}) · generated ${esc(r.generatedAt)} · data class <span class="badge">${esc(r.dataClass)}</span></p>
${r.dataClass === 'synthetic' ? '<p class="warn"><b>Synthetic data.</b> This report is based on the built-in demo trace, not real carbon data.</p>' : ''}
<h2>Job</h2><table>
${row(['Zone', r.job.zone])}${row(['Time zone (display only)', r.region.timezone ?? 'unknown: times shown in UTC'])}
${row(['Duration (h)', r.job.durationHours])}${row(['CPU / memory', `${r.job.cpu} vCPU / ${r.job.memoryMb} MiB`])}
${row(['Arrival (UTC)', r.job.arrivalAt])}${row(['Deadline (UTC)', r.job.deadlineAt])}${row(['Risk tolerance', r.job.riskTolerance])}
</table>
<h2>Data provenance</h2><table>
${r.dataProvenance ? Object.entries(r.dataProvenance).map(([k, v]) => row([k, v])).join('') : row(['—', 'No forecast was fetched (job infeasible before data retrieval).'])}
</table>
<h2>Decision</h2><table>
${row(['Status', r.decision.status])}${row(['Recommended policy', r.decision.recommendedPolicy])}
${row(['Recommended window (UTC)', r.decision.recommendedWindow ? `${r.decision.recommendedWindow.startUtc} to ${r.decision.recommendedWindow.endUtc}` : 'none'])}
${row(['Deadline compliance', r.decision.deadlineCompliance ? (r.decision.deadlineCompliance.meetsDeadline ? 'Meets deadline' : 'MISSES deadline') : 'n/a'])}
${row(['Risk model', r.decision.riskModel])}${row(['Infeasibility reason', r.decision.infeasibilityReason])}
${row(['Rationale', r.decision.rationale])}
${row(['Predicted saving vs Immediate', r.decision.predictedSavingsVsImmediatePct === null ? 'n/a' : `${r.decision.predictedSavingsVsImmediatePct}% (${r.decision.predictedSavingsLabel})`])}
${row(['Energy assumption', `${r.decision.energyAssumption.energyKwh} kWh: ${r.decision.energyAssumption.basis}`])}
</table>
<h3>Algorithm comparison (predicted, from the forecast)</h3>
<table><tr><th>Policy</th><th>Start (UTC)</th><th>End (UTC)</th><th>Predicted gCO2eq/kWh</th><th>Predicted gCO2eq</th><th>Meets deadline</th></tr>
${r.decision.algorithmComparison.map((p: any) => row([p.policy, p.startUtc, p.endUtc, p.predictedIntensity, p.predictedEmissionsGrams, p.meetsDeadline])).join('')}
</table>
<h2>Execution</h2><table>
${r.execution ? Object.entries(r.execution).map(([k, v]) => row([k, v])).join('') : row(['—', 'Not dispatched'])}
</table>
<h2>Observations</h2>
<p>Status: <b>${esc(r.observations.status)}</b>: ${esc(r.observations.statusDetail)}</p>
${
  (r.observations.points || []).length
    ? `<table><tr><th>Interval start (UTC)</th><th>Observed gCO2eq/kWh</th><th>Quality</th><th>Estimation method</th></tr>${(r.observations.points || [])
        .map((p: any) => row([p.datetime, p.carbonIntensity, p.quality === 'measured' ? 'Measured' : 'Provider estimate', p.estimationMethod]))
        .join('')}</table>`
    : ''
}
<h2>Forecast error</h2>
${
  r.forecastError
    ? `<table>${row(['Versus measured observations', metrics(r.forecastError.versusMeasured)])}${row([
        'Versus provider estimates (model-vs-model)',
        metrics(r.forecastError.versusProviderEstimate),
      ])}${row(['Unmatched intervals', r.forecastError.unmatchedIntervals.join(', ') || 'none'])}${row(['Definition', r.forecastError.definition])}</table>`
    : '<p>Not calculable yet: no matching observations.</p>'
}
<h2>Realized result</h2>
${
  r.realized
    ? `<table>${row(['Average observed intensity', r.realized.averageIntensity ?? 'n/a'])}${row(['Emissions (assumed energy x observed intensity)', r.realized.emissionsGrams ?? 'n/a'])}${row([
        'Observation quality',
        r.realized.quality ?? 'n/a',
      ])}${row(['Coverage', `${r.realized.coverage.observed}/${r.realized.coverage.expected}`])}${row(['Note', r.realized.reason])}</table>`
    : '<p>No realized result yet.</p>'
}
${
  r.observedComparison
    ? `<h3>Observed comparison with Immediate execution</h3><table>${Object.entries(r.observedComparison)
        .map(([k, v]) => row([k, typeof v === 'object' ? JSON.stringify(v) : v]))
        .join('')}</table>`
    : ''
}
<h2>Limitations and assumptions</h2><ul>${r.limitations.map((l: string) => `<li>${esc(l)}</li>`).join('')}</ul>
</body></html>`;
}
