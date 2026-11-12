import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CarbonService } from '../services/carbonService';
import { WorkloadJob } from '../services/schedulerService';
import { scheduleWorkflow, collectObservations, evaluateJob, WorkflowError } from '../services/schedulingWorkflow';
import { buildReport, renderReportHtml } from '../services/reportService';
import { schedulingStore } from '../models/schedulingStore';
import { electricityMaps } from '../carbon/electricityMaps';
import { ProviderError } from '../carbon/types';
import { K8sConnector } from '../services/k8sConnector';

// In-memory store for registered jobs & experiments
const registeredJobs = new Map<string, WorkloadJob>();
// Experiment records submitted through the API (in memory). The two pre-filled
// "Completed" records with invented realized-carbon values were removed (audit C2, task M2.2).
const experimentRecords: any[] = [];

export const submitJob = (req: Request, res: Response) => {
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
    };

    registeredJobs.set(job.id, job);

    return res.status(201).json({
      success: true,
      message: `Workload "${job.name}" registered successfully.`,
      data: job,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/** Maps a thrown error to an HTTP status and message without exposing internals. */
function sendError(res: Response, error: any, fallbackStatus = 500) {
  const status =
    error instanceof WorkflowError
      ? error.status
      : error instanceof ProviderError
        ? error.apiStatus
        : typeof error?.apiStatus === 'number'
          ? error.apiStatus
          : fallbackStatus;
  return res.status(status).json({ success: false, message: error?.message || 'Request failed.', code: error?.code });
}

/**
 * Evaluates every scheduling policy for a job on the same forecast snapshot, returns a
 * recommendation that meets the deadline (or an explicit INFEASIBLE result), and stores
 * the job, the exact forecast snapshot and the decision.
 */
export const scheduleJob = async (req: Request, res: Response) => {
  const { jobId, jobData, region = 'US-CAL-CISO', uncertaintyMultiplier = 1.0 } = req.body || {};
  let source: any;
  if (jobId && registeredJobs.has(jobId)) {
    source = registeredJobs.get(jobId);
  } else if (jobData) {
    source = { ...jobData, id: jobData.id || `job-${uuidv4().substring(0, 8)}` };
  } else {
    return res.status(400).json({ success: false, message: 'Either jobId or jobData is required for scheduling.' });
  }
  const mode: 'live' | 'demo' = req.body.mode === 'demo' || req.body.dataSource === 'demo' ? 'demo' : 'live';

  try {
    const data = await scheduleWorkflow({
      jobId: source.id,
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
      uncertaintyMultiplier: Number(uncertaintyMultiplier),
      mode,
    });
    const registered: WorkloadJob = {
      ...(registeredJobs.get(source.id) || source),
      id: source.id,
      status: 'scheduled',
    };
    registeredJobs.set(source.id, registered);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, 503);
  }
};

export const dispatchJobToExecution = async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = registeredJobs.get(jobId);
    const decision = schedulingStore().latestDecisionForJob(jobId);
    const recommended = decision?.status === 'RECOMMENDED' ? decision.result?.recommendedDecision : null;
    const { simulatedDurationSec = 6 } = req.body || {};
    const predictedCarbon = Number(recommended?.predictedCarbonIntensity ?? req.body?.predictedCarbon ?? 0);

    const command = job?.commandOrImage || 'python workload.py';
    const executionRecord = await K8sConnector.dispatchJob(
      job || jobId,
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
  }
};

/** Collects Electricity Maps observations for the job's scheduled window. */
export const collectJobObservations = async (req: Request, res: Response) => {
  try {
    const set = await collectObservations(String(req.params.id));
    return res.json({ success: true, data: { collected: set, ...evaluateJob(String(req.params.id)) } });
  } catch (error: any) {
    return sendError(res, error);
  }
};

export const getJobObservations = (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    return res.json({ success: true, data: { history: schedulingStore().observationSetsForJob(id), ...evaluateJob(id) } });
  } catch (error: any) {
    return sendError(res, error);
  }
};

/** Report as JSON (default) or a downloadable HTML file (?format=html). */
export const getJobReport = (req: Request, res: Response) => {
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

export const getJobStatus = (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  const execution = K8sConnector.getJobExecution(jobId);

  if (!execution) {
    const registered = registeredJobs.get(jobId);
    if (registered) {
      return res.json({
        success: true,
        data: {
          jobId,
          status: registered.status,
          logs: ['[Waiting] Workload registered. Click "Dispatch Workload" to execute.'],
        },
      });
    }
    return res.status(404).json({ success: false, message: 'Job execution not found.' });
  }

  return res.json({
    success: true,
    data: execution,
  });
};

export const getJobResults = (req: Request, res: Response) => {
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

export const getJobManifest = (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = registeredJobs.get(jobId) || { id: jobId, cpu: 1, memoryMb: 512, region: 'US-CAL-CISO' };
    const scheduledHour = Number(req.query.hour) || 0;
    const manifest = K8sConnector.generateJobManifest(job, scheduledHour);
    return res.json({ success: true, data: manifest });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
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
      note: 'past and past-range endpoints are not included in the current API plan.',
    },
  });
};

export const getClusterHealth = async (_req: Request, res: Response) => {
  const health = await K8sConnector.checkClusterHealth();
  return res.json({ success: true, data: health });
};

export const recordExperiment = (req: Request, res: Response) => {
  try {
    const exp = {
      id: `exp-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...req.body,
    };
    experimentRecords.unshift(exp);
    return res.status(201).json({ success: true, data: exp });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getExperiments = (_req: Request, res: Response) => {
  return res.json({
    success: true,
    data: experimentRecords,
  });
};
