import { internalError } from '../utils/httpErrors';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CarbonService } from '../services/carbonService';
import { WorkloadJob } from '../services/schedulerService';
import { scheduleWorkflow, collectObservations, evaluateJob, WorkflowError } from '../services/schedulingWorkflow';
import { buildReport, renderReportHtml } from '../services/reportService';
import { schedulingStore, FINAL_EXECUTION_STATUSES } from '../models/schedulingStore';
import { electricityMaps } from '../carbon/electricityMaps';
import { ProviderError } from '../carbon/types';
import { K8sConnector } from '../services/k8sConnector';
import { validateWorkloadSpec, WorkloadSpecError } from '../services/workloadSpec';
import { evaluateOracle } from '../evaluation/oracle';
import { AuthRequest, isAdmin } from '../middleware/auth';
import { db } from '../models/db';
import {
  registeredJobs,
  findJob,
  canAccessJob,
  allJobs,
  jobSummary,
  jobStatus,
  auditAdminOverride,
  JobRef,
  JobRequest,
  JOB_NOT_FOUND,
} from '../services/jobAccess';

// Experiment records submitted through the API (in memory). The two pre-filled
// "Completed" records with invented realized-carbon values were removed (audit C2, task M2.2).
// Since M1.2 each record has an owner and is visible only to its owner and administrators.
const experimentRecords: any[] = [];

/** Job fields as a WorkloadJob-like object, whether the job was registered or only stored. */
function jobAsWorkload(job: JobRef): WorkloadJob | { id: string; [k: string]: any } {
  if (job.registered) return job.registered;
  const s = job.stored!;
  return {
    id: s.id,
    name: s.name,
    commandOrImage: s.commandOrImage,
    isContainerImage: s.isContainerImage,
    cpu: s.cpu,
    memoryMb: s.memoryMb,
    region: s.zone,
    durationHours: s.durationHours,
    riskTolerance: s.riskTolerance,
    deadlineAt: s.deadlineAt,
    ownerId: s.ownerId,
  };
}

const JOB_CANCELLED = { success: false, code: 'JOB_CANCELLED', message: 'This job has been cancelled.' } as const;

export const submitJob = (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      commandOrImage,
      isContainerImage = true,
      durationHours = 2,
      deadlineHours = 12,
      arrivalHour = 0,
      cpu = 1,
      memoryMb = 512,
      region = 'US-CAL-CISO',
      riskTolerance = 0.05,
    } = req.body;

    if (!name || (!commandOrImage && !req.body.command)) {
      return res.status(400).json({
        success: false,
        message: 'Job Name and Command/Container Image are required.',
      });
    }
    try {
      validateWorkloadSpec({ commandOrImage: commandOrImage || req.body.command, isContainerImage });
    } catch (err: any) {
      return res.status(400).json({ success: false, code: 'INVALID_WORKLOAD', message: err.message });
    }

    const job: WorkloadJob = {
      id: `job-${uuidv4().substring(0, 8)}`,
      name: String(name),
      commandOrImage: String(commandOrImage || req.body.command),
      isContainerImage: Boolean(isContainerImage),
      durationHours: Number(durationHours),
      deadlineHours: Number(deadlineHours),
      arrivalHour: Number(arrivalHour),
      cpu: Number(cpu),
      memoryMb: Number(memoryMb),
      region: String(region),
      riskTolerance: Number(riskTolerance),
      status: 'pending',
      createdAt: new Date().toISOString(),
      // Owner is always the authenticated caller; a client-supplied ownerId is ignored.
      ownerId: req.user!.id,
    };

    registeredJobs.set(job.id, job);

    return res.status(201).json({
      success: true,
      message: `Workload "${job.name}" registered successfully.`,
      data: job,
    });
  } catch (error: any) {
    return internalError(res, error, 'Job submission failed');
  }
};

// P8: every execution status change is persisted with the job's latest stored execution.
K8sConnector.onStatusChange((jobId, status, at) => {
  schedulingStore().updateExecutionStatus(jobId, status, at);
});

/** Maps a thrown error to an HTTP status and message without exposing internals. */
function sendError(res: Response, error: any, fallbackStatus = 500) {
  const status =
    error instanceof WorkflowError || error instanceof WorkloadSpecError
      ? error.status
      : error instanceof ProviderError
        ? error.apiStatus
        : typeof error?.apiStatus === 'number'
          ? error.apiStatus
          : fallbackStatus;
  // Only errors CarbonRoute raises on purpose carry a message meant for users; anything else that
  // ends as a server error is logged and answered generically (P8).
  const known = error instanceof WorkflowError || error instanceof WorkloadSpecError || error instanceof ProviderError || typeof error?.apiStatus === 'number';
  if (!known && status >= 500) return internalError(res, error, 'Request failed');
  return res.status(status).json({ success: false, message: error?.message || 'Request failed.', code: error?.code });
}

/**
 * Evaluates every scheduling policy for a job on the same forecast snapshot, returns a
 * recommendation that meets the deadline (or an explicit INFEASIBLE result), and stores
 * the job, the exact forecast snapshot and the decision.
 */
export const scheduleJob = async (req: AuthRequest, res: Response) => {
  const { jobId, jobData, region = 'US-CAL-CISO' } = req.body || {};
  const user = req.user!;
  let source: any;
  let ownerId: string | undefined = user.id;
  let existing: JobRef | null = null;
  if (jobId) {
    // Scheduling an existing job requires access to it (same 404 whether missing or not yours).
    existing = findJob(String(jobId));
    if (!existing || !canAccessJob(user, existing.ownerId)) return res.status(404).json(JOB_NOT_FOUND);
    source = jobAsWorkload(existing);
  } else if (jobData && typeof jobData === 'object') {
    // A client may only reuse the id of a job it can access. Any other requested id is
    // ignored and a new server-generated id is used, so ids cannot be chosen or hijacked.
    const requested = jobData.id ? findJob(String(jobData.id)) : null;
    if (requested && !canAccessJob(user, requested.ownerId)) return res.status(404).json(JOB_NOT_FOUND);
    existing = requested;
    source = { ...jobData, id: requested ? requested.id : `job-${uuidv4().substring(0, 8)}` };
  } else {
    return res.status(400).json({ success: false, message: 'Either jobId or jobData is required for scheduling.' });
  }
  if (existing) {
    if (existing.cancelled) return res.status(409).json(JOB_CANCELLED);
    ownerId = existing.ownerId; // an admin re-scheduling a user's job keeps the user as owner
    auditAdminOverride(user, existing, 'scheduled');
  }
  const mode: 'live' | 'demo' = req.body.mode === 'demo' || req.body.dataSource === 'demo' ? 'demo' : 'live';

  try {
    const data = await scheduleWorkflow({
      jobId: source.id,
      ownerId,
      name: String(source.name || 'Batch job'),
      commandOrImage: String(source.commandOrImage || 'carbonroute/test-workload:latest'),
      isContainerImage: source.isContainerImage ?? true,
      zone: String(source.region || region),
      durationHours: Number(source.durationHours ?? 2),
      cpu: Number(source.cpu ?? 1),
      memoryMb: Number(source.memoryMb ?? 512),
      riskTolerance: Number(source.riskTolerance ?? 0.05),
      deadlineAt: source.deadlineAt,
      deadlineHours: source.deadlineAt ? undefined : Number(source.deadlineHours ?? 12),
      arrivalAt: source.arrivalAt,
      // Declared runtime variability (P1); the old uncertaintyMultiplier is no longer used.
      runtimeCv: req.body?.runtimeCv ?? source.runtimeCv,
      mode,
    });
    const registered: WorkloadJob = {
      ...(registeredJobs.get(source.id) || source),
      id: source.id,
      status: 'scheduled',
      ownerId,
    };
    registeredJobs.set(source.id, registered);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};
/**
 * Jobs whose dispatch is in progress (P8 review). The executor registers a run only after an
 * asynchronous cluster probe, so without this two concurrent requests could both pass the
 * "already dispatched" check and start two runs.
 */
const dispatchesInProgress = new Set<string>();

export const dispatchJobToExecution = async (req: JobRequest, res: Response) => {
  const jobId = req.job!.id;
  if (dispatchesInProgress.has(jobId)) {
    return res.status(409).json({ success: false, code: 'JOB_ALREADY_DISPATCHED', message: 'This job is already being dispatched.' });
  }
  dispatchesInProgress.add(jobId);
  try {
    const ref = req.job!;
    if (ref.cancelled) return res.status(409).json(JOB_CANCELLED);
    auditAdminOverride(req.user!, ref, 'dispatched');
    const job: any = jobAsWorkload(ref);
    const decision = schedulingStore().latestDecisionForJob(jobId);
    const recommended = decision?.status === 'RECOMMENDED' ? decision.result?.recommendedDecision : null;
    // P8: only a job with a recommended window can be dispatched, and only once (a failed or
    // interrupted run may be dispatched again).
    if (!decision || decision.status !== 'RECOMMENDED' || !decision.recommendedWindow) {
      return res.status(409).json({
        success: false,
        code: 'NO_RECOMMENDATION',
        message: 'This job has no recommended execution window (not scheduled yet, or its decision was infeasible). Schedule it first.',
      });
    }
    const current = jobStatus(ref);
    if (current === 'scheduled' && K8sConnector.getJobExecution(jobId)) {
      return res.status(409).json({ success: false, code: 'JOB_ALREADY_DISPATCHED', message: 'This job has already been dispatched and is waiting to run.' });
    }
    if (current === 'running' || current === 'completed') {
      return res.status(409).json({ success: false, code: 'JOB_ALREADY_DISPATCHED', message: `This job has already been dispatched (${current}).` });
    }
    // An earlier stored run that is not finished and has no live executor (cut off by a restart, or
    // written before statuses were stored) is closed as 'interrupted' before the new run starts, so
    // the new run's status updates cannot be recorded on it.
    const previous = schedulingStore().latestExecutionForJob(jobId);
    if (previous && !(previous.status && FINAL_EXECUTION_STATUSES.includes(previous.status))) {
      schedulingStore().updateExecutionStatus(jobId, 'interrupted');
    }
    const { simulatedDurationSec = 6 } = req.body || {};
    const predictedCarbon = Number(recommended?.predictedCarbonIntensity ?? req.body?.predictedCarbon ?? 0);

    const command = job?.commandOrImage || 'python workload.py';
    const executionRecord = await K8sConnector.dispatchJob(
      job,
      { predictedCarbon, selectedStartHour: Number(recommended?.selectedStartHour ?? req.body?.scheduledHour ?? 0) },
      command,
      job?.cpu || 1,
      job?.memoryMb || 512,
      predictedCarbon,
      Number(simulatedDurationSec)
    );

    let execution = null;
    if (decision?.status === 'RECOMMENDED' && decision.recommendedWindow) {
      execution = schedulingStore().addExecution({
        jobId,
        decisionId: decision.id,
        executionMode: executionRecord.clusterMode === 'minikube' ? 'kubernetes' : 'simulated-no-workload',
        scheduledStartUtc: decision.recommendedWindow.startUtc,
        scheduledEndUtc: decision.recommendedWindow.endUtc,
        dispatchedAt: new Date().toISOString(),
        status: executionRecord.status,
        statusUpdatedAt: new Date().toISOString(),
        note:
          executionRecord.clusterMode === 'minikube'
            ? 'Submitted to the connected Kubernetes cluster at dispatch time.'
            : 'Simulated: no workload process was run. Carbon accounting uses the scheduled window.',
      });
    }

    return res.json({
      success: true,
      message: `Job ${jobId} dispatched (${executionRecord.clusterMode === 'minikube' ? 'Kubernetes' : 'simulated execution'}).`,
      data: { ...executionRecord, execution },
    });
  } catch (error: any) {
    return sendError(res, error);
  } finally {
    dispatchesInProgress.delete(jobId);
  }
};

/** Collects Electricity Maps observations for the job's scheduled window. */
export const collectJobObservations = async (req: JobRequest, res: Response) => {
  try {
    auditAdminOverride(req.user!, req.job!, 'collected observations for');
    const set = await collectObservations(String(req.params.id));
    return res.json({ success: true, data: { collected: set, ...evaluateJob(String(req.params.id)) } });
  } catch (error: any) {
    return sendError(res, error);
  }
};

export const getJobObservations = (req: JobRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    return res.json({ success: true, data: { history: schedulingStore().observationSetsForJob(id), ...evaluateJob(id) } });
  } catch (error: any) {
    return sendError(res, error);
  }
};

const GRANULARITY_MINUTES: Record<string, number> = { hourly: 60, '15_minutes': 15, '5_minutes': 5 };

/**
 * GET /api/jobs/:id/oracle: hindsight (Oracle) evaluation of the job's latest decision on the
 * realized observations collected for it. Offline evaluation only (P1, M10.6). Usually
 * unavailable for single jobs, because observations are collected for the scheduled and
 * Immediate windows only, not for every candidate.
 */
export const getJobOracle = (req: JobRequest, res: Response) => {
  try {
    const store = schedulingStore();
    const decision = store.latestDecisionForJob(req.job!.id);
    if (!decision || decision.status !== 'RECOMMENDED') {
      return res.json({ success: true, data: { status: 'NOT_APPLICABLE', offlineOnly: true, reason: 'The job has no recommended decision to evaluate.' } });
    }
    if (decision.dataClass === 'synthetic') {
      return res.json({ success: true, data: { status: 'NOT_APPLICABLE_SYNTHETIC', offlineOnly: true, reason: 'The decision used the synthetic demo trace; there are no realized observations to compare with.' } });
    }
    const latest = new Map<string, { datetime: string; value: number; intervalMinutes: number; fetchedAt: string }>();
    for (const set of store.observationSetsForJob(req.job!.id)) {
      for (const o of [...set.observations, ...(set.immediate?.observations || [])]) {
        const prev = latest.get(o.datetime);
        if (!prev || prev.fetchedAt < o.fetchedAt) {
          latest.set(o.datetime, { datetime: o.datetime, value: o.carbonIntensity, intervalMinutes: GRANULARITY_MINUTES[o.granularity] ?? 60, fetchedAt: o.fetchedAt });
        }
      }
    }
    const realized = [...latest.values()].map(({ fetchedAt: _f, ...v }) => v);
    const result: any = decision.result || {};
    const candidates = (result.candidateWindows || [])
      .filter((c: any) => c.startUtc && c.endUtc && c.classification !== 'REJECTED_DATA_GAP')
      .map((c: any) => ({ startUtc: c.startUtc, endUtc: c.endUtc }));
    const policies = (result.evaluatedPolicies || [])
      .filter((p: any) => p.selectedStartUtc && p.selectedEndUtc)
      .map((p: any) => ({ policyId: p.policyId, window: { startUtc: p.selectedStartUtc, endUtc: p.selectedEndUtc } }));
    return res.json({ success: true, data: { decisionId: decision.id, ...evaluateOracle(candidates, realized, policies) } });
  } catch (error: any) {
    return sendError(res, error);
  }
};

/** Report as JSON (default) or a downloadable HTML file (?format=html). */
export const getJobReport = (req: JobRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const report = buildReport(id);
    if (req.query.format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="carbonroute-report-${id.replace(/[^a-zA-Z0-9-]/g, '')}.html"`);
      return res.send(renderReportHtml(report));
    }
    return res.json({ success: true, data: report });
  } catch (error: any) {
    return sendError(res, error);
  }
};

export const getJobStatus = (req: JobRequest, res: Response) => {
  const ref = req.job!;
  const jobId = ref.id;
  const execution = K8sConnector.getJobExecution(jobId);

  if (!execution) {
    return res.json({
      success: true,
      data: {
        jobId,
        status: jobStatus(ref),
        logs: ref.cancelled
          ? ['[Cancelled] This job was cancelled before it was dispatched.']
          : ['[Waiting] Workload registered. Click "Dispatch Workload" to execute.'],
      },
    });
  }

  return res.json({
    success: true,
    data: execution,
  });
};
export const getJobResults = (req: JobRequest, res: Response) => {
  const jobId = String(req.params.id);
  const execution = K8sConnector.getJobExecution(jobId);

  if (!execution) {
    return res.status(404).json({ success: false, message: 'No execution results found.' });
  }

  return res.json({
    success: true,
    data: {
      jobId: execution.jobId,
      k8sJobName: execution.k8sJobName,
      podId: execution.podId,
      podName: execution.podName,
      status: execution.status,
      scheduledStartTime: execution.scheduledStartTime,
      actualStartTime: execution.actualStartTime || 'Pending',
      completionTime: execution.completionTime || 'Pending',
      durationSeconds: execution.durationSeconds,
      exitCode: execution.exitCode ?? 'N/A',
      predictedCarbon: execution.predictedCarbon,
      realizedCarbon: execution.realizedCarbon,
      carbonError: execution.carbonError,
      clusterMode: execution.clusterMode,
      clusterNotice: execution.clusterNotice,
      logs: execution.logs,
    },
  });
};

export const getJobManifest = (req: JobRequest, res: Response) => {
  try {
    const job = jobAsWorkload(req.job!);
    const scheduledHour = Number(req.query.hour) || 0;
    const manifest = K8sConnector.generateJobManifest(job, scheduledHour);
    return res.json({ success: true, data: manifest });
  } catch (error: any) {
    if (error instanceof WorkloadSpecError) return res.status(400).json({ success: false, message: error.message });
    return internalError(res, error, 'Manifest generation failed');
  }
};

export const getCarbonForecast = async (req: Request, res: Response) => {
  try {
    const region = String(req.query.region || 'US-CAL-CISO');
    const horizon = Number(req.query.horizon) || 24;
    const mode: 'live' | 'demo' =
      req.query.mode === 'demo' || req.query.dataSource === 'demo' ? 'demo' : 'live';
    const data = await CarbonService.getForecast(region, horizon, mode);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

/**
 * Regions for the selector. Live mode lists every zone the Electricity Maps key can access
 * (with coverage and time zone); demo mode lists the built-in synthetic profiles. A provider
 * failure is reported as such, never replaced by the demo list.
 */
export const getAvailableRegions = async (req: Request, res: Response) => {
  if (req.query.mode === 'demo') {
    return res.json({ success: true, source: 'synthetic-demo-profiles', data: CarbonService.getAvailableRegions() });
  }
  try {
    const zones = await CarbonService.getLiveZones();
    return res.json({
      success: true,
      source: 'electricitymaps',
      data: zones.map((z) => ({ code: z.zone, name: z.displayName || z.zoneName, ...z })),
    });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

/** Latest carbon intensity (labelled measured or provider estimate). */
export const getCarbonLatest = async (req: Request, res: Response) => {
  try {
    const data = await electricityMaps.getLatest(String(req.query.zone || ''), {
      granularity: req.query.granularity as string | undefined,
      emissionFactorType: req.query.emissionFactorType as string | undefined,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

/** Last 24 h of realized values, each labelled measured or provider estimate. */
export const getCarbonHistory = async (req: Request, res: Response) => {
  try {
    const data = await electricityMaps.getHistory(String(req.query.zone || ''), {
      granularity: req.query.granularity as string | undefined,
      emissionFactorType: req.query.emissionFactorType as string | undefined,
    });
    return res.json({ success: true, data: { ...data, window: 'last 24 hours (provider plan limit)' } });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

/** Raw forecast snapshot at any supported horizon (6/24/48/72 h) and granularity. */
export const getCarbonForecastSnapshot = async (req: Request, res: Response) => {
  try {
    const data = await electricityMaps.getForecast(String(req.query.zone || ''), {
      horizonHours: req.query.horizon ? Number(req.query.horizon) : 24,
      granularity: req.query.granularity as string | undefined,
      emissionFactorType: req.query.emissionFactorType as string | undefined,
    });
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

export const getCarbonPowerBreakdown = async (req: Request, res: Response) => {
  try {
    const data = await electricityMaps.getPowerBreakdown(String(req.query.zone || ''));
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

/** Which carbon-data capabilities are configured and verified (no secrets). */
export const getCarbonProviderStatus = (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: {
      provider: 'electricitymaps',
      configured: electricityMaps.isConfigured(),
      forecastHorizonsHours: [6, 24, 48, 72],
      granularities: ['5_minutes', '15_minutes', 'hourly'],
      historyWindowHours: 24,
      pastRangeAvailable: false,
      verifiedOn: '2026-11-12',
      // F9: live data needs sign-in and is rate limited; this is the server-wide call budget.
      callBudget: electricityMaps.callBudget(),
      note: 'past and past-range endpoints are not included in the current API plan.',
    },
  });
};

/**
 * Public cluster status (P8): only whether a cluster is reachable. The kubectl output (which names
 * the control-plane address) is never returned to anonymous callers.
 */
export const getClusterHealth = async (_req: Request, res: Response) => {
  const health = await K8sConnector.checkClusterHealth();
  return res.json({
    success: true,
    data: {
      isAvailable: health.isAvailable,
      message: health.isAvailable
        ? 'A Kubernetes cluster is reachable; dispatched jobs are submitted to it.'
        : 'No Kubernetes cluster is reachable; dispatched jobs are simulated (no workload process is run).',
    },
  });
};

export const recordExperiment = (req: AuthRequest, res: Response) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // An experiment that names a job must name one the caller can access.
    if (body.jobId !== undefined) {
      const job = findJob(String(body.jobId));
      if (!job || !canAccessJob(req.user, job.ownerId)) return res.status(404).json(JOB_NOT_FOUND);
    }
    // Server-controlled fields come last so a client cannot set them.
    const exp = {
      ...body,
      id: `exp-${Date.now()}-${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      ownerId: req.user!.id,
    };
    experimentRecords.unshift(exp);
    return res.status(201).json({ success: true, data: exp });
  } catch (error: any) {
    return internalError(res, error, 'Recording experiment failed');
  }
};
/** Experiments recorded by the caller (administrators see all). */
export const getExperiments = (req: AuthRequest, res: Response) => {
  const user = req.user!;
  return res.json({
    success: true,
    data: isAdmin(user) ? experimentRecords : experimentRecords.filter((e) => e.ownerId === user.id),
  });
};

/**
 * GET /api/jobs: the caller's jobs (administrators: every job). Filters: ?status=,
 * ?zone=, and ?owner= (administrators only; "me" is accepted for anyone).
 */
export const listJobs = (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { status, zone, owner } = req.query as Record<string, string | undefined>;
  let ownerFilter: string | undefined;
  if (owner !== undefined && owner !== '') {
    if (owner === 'me' || owner === user.id || owner.toLowerCase() === user.username.toLowerCase()) ownerFilter = user.id;
    else if (!isAdmin(user)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Only administrators can list other users\' jobs.' });
    } else {
      ownerFilter = db.getUserById(owner)?.id ?? db.getUserByUsername(owner)?.id ?? owner;
    }
  }
  const jobs = allJobs()
    .filter((j) => canAccessJob(user, j.ownerId))
    .filter((j) => (ownerFilter ? j.ownerId === ownerFilter : true))
    .map((j) => jobSummary(j, user))
    .filter((j) => (status ? j.status === status : true))
    .filter((j) => (zone ? j.zone === zone : true))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return res.json({ success: true, data: jobs });
};

/** Policy comparison rows from a stored decision (same values the decision returned). */
function storedPolicies(result: any) {
  return (result?.evaluatedPolicies || []).map((p: any) => ({
    policyId: p.policyId,
    policyName: p.policyName,
    category: p.category,
    selectedStartUtc: p.selectedStartUtc ?? null,
    selectedEndUtc: p.selectedEndUtc ?? null,
    selectedWindow: p.selectedWindow,
    forecastIntensity: p.forecastIntensityTimeWeighted ?? p.predictedCarbonIntensity ?? null,
    estimatedEmissionsAssumedEnergyGrams: p.estimatedEmissionsAssumedEnergyGrams ?? p.estimatedWorkloadEmissionsGrams ?? null,
    estimatedDeadlineRisk: p.estimatedDeadlineRisk ?? null,
    waitingTimeHours: p.waitingTimeHours ?? null,
    isFeasible: Boolean(p.isFeasible),
    equivalentTo: p.equivalentTo ?? null,
    recommended: p.policyId === result?.recommendedDecision?.policyId,
  }));
}

/** Latest observation collection for a job, summarised by data quality (never relabelled). */
function observationSummary(jobId: string) {
  const sets = schedulingStore().observationSetsForJob(jobId);
  const latest = sets[sets.length - 1];
  if (!latest) return null;
  const count = (q: string) => latest.observations.filter((o) => o.quality === q).length;
  return {
    status: latest.status,
    statusDetail: latest.statusDetail,
    collectedAt: latest.collectedAt,
    intervals: latest.intervals.length,
    measured: count('measured'),
    providerEstimate: count('provider-estimate'),
    missing: latest.missingIntervals.length,
    attempts: sets.length,
  };
}

/** GET /api/jobs/:id: job details, latest decision and latest execution record. */
export const getJobDetails = (req: JobRequest, res: Response) => {
  const ref = req.job!;
  const store = schedulingStore();
  const decision = store.latestDecisionForJob(ref.id);
  const result: any = decision?.result || null;
  return res.json({
    success: true,
    data: {
      ...jobSummary(ref, req.user!),
      job: jobAsWorkload(ref),
      decision: decision
        ? {
            id: decision.id,
            status: decision.status,
            createdAt: decision.createdAt,
            engineVersion: decision.engineVersion,
            dataMode: decision.dataMode,
            dataClass: decision.dataClass,
            snapshotId: decision.snapshotId,
            recommendedWindow: decision.recommendedWindow,
            immediateWindow: decision.immediateWindow,
            infeasibilityReason: decision.infeasibilityReason ?? null,
            riskModel: result?.riskModel ?? decision.riskModel ?? null,
            runtimeCv: result?.runtimeCv ?? 0,
            provenance: result?.provenance ?? null,
            energyAssumption: decision.energyAssumption,
            explanation: result?.explanation ?? null,
            policies: storedPolicies(result),
            unavailablePolicies: result?.unavailablePolicies ?? [],
            candidateCount: (result?.candidateWindows || []).length,
          }
        : null,
      execution: store.latestExecutionForJob(ref.id) ?? null,
      observations: observationSummary(ref.id),
    },
  });
};

/**
 * POST /api/jobs/:id/cancel: cancels a job that has not finished. A running simulated
 * execution stops; on a live cluster the Kubernetes Job is deleted. Cancelled jobs cannot be
 * scheduled or dispatched again.
 */
export const cancelJob = async (req: JobRequest, res: Response) => {
  try {
    const ref = req.job!;
    const user = req.user!;
    if (ref.cancelled) return res.status(409).json({ success: false, code: 'JOB_ALREADY_CANCELLED', message: 'This job is already cancelled.' });
    // P8: also after a restart (persisted status), a finished job cannot be cancelled.
    const finished = jobStatus(ref);
    if (finished === 'completed' || finished === 'failed') {
      return res.status(409).json({ success: false, code: 'JOB_FINISHED', message: `The job has already ${finished}; it cannot be cancelled.` });
    }
    auditAdminOverride(user, ref, 'cancelled');
    await K8sConnector.cancelExecution(ref.id, user.username);
    const registered = registeredJobs.get(ref.id);
    if (registered) registered.status = 'cancelled';
    if (ref.stored) schedulingStore().markJobCancelled(ref.id, user.username);
    const updated = findJob(ref.id)!;
    return res.json({ success: true, message: `Job ${ref.id} cancelled.`, data: jobSummary(updated, user) });
  } catch (error: any) {
    return sendError(res, error);
  }
};
