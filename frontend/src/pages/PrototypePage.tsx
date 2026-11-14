import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Zap,
  Activity,
  Play,
  Server,
  BarChart3,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Terminal,
  Globe,
  ShieldCheck,
  Flame,
  Info,
  Layers,
  ChevronRight,
  RotateCw,
  ExternalLink,
  FileCode,
  X,
  Copy,
  Check,
  TrendingDown,
  Filter,
  CheckCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import {
  WorkloadJob,
  CarbonForecastData,
  PolicyEvaluationResult,
  SchedulingDecisionResponse,
  K8sJobExecutionRecord,
  ZoneCatalogue,
  JobObservationsResult,
} from '../types';
import { FeasibilityDemoVisualizer } from '../components/FeasibilityDemoVisualizer';
import { ZoneSelector, zoneUsability } from '../components/ZoneSelector';
import { CarbonObservationPanel } from '../components/CarbonObservationPanel';
import { DecisionExplanationPanel } from '../components/DecisionExplanationPanel';

/** Formats a UTC ISO time in the viewer's local time zone. */
const formatLocal = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const PrototypePage: React.FC = () => {
  // 1. Workload Form State
  const [jobName, setJobName] = useState<string>('ResNet-50 Batch Training');
  const [commandOrImage, setCommandOrImage] = useState<string>('carbonroute/test-workload:latest');
  const [isContainerImage, setIsContainerImage] = useState<boolean>(true);
  const [durationHours, setDurationHours] = useState<number>(2);
  const [deadlineHours, setDeadlineHours] = useState<number>(12);
  const [cpu, setCpu] = useState<number>(1);
  const [memoryMb, setMemoryMb] = useState<number>(512);
  const [region, setRegion] = useState<string>('US-CAL-CISO');
  const [riskTolerance, setRiskTolerance] = useState<number>(0.05);
  // Declared runtime coefficient of variation (P6): 0 = deterministic runtime.
  const [runtimeCv, setRuntimeCv] = useState<number>(0);

  // Regions: live = every zone the backend's Electricity Maps key can access; demo = synthetic profiles.
  // P11: the global zone catalogue (every provider zone; static, no provider call).
  const [catalogue, setCatalogue] = useState<ZoneCatalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  // Infeasible decisions and post-execution observations
  const [infeasibleReason, setInfeasibleReason] = useState<string | null>(null);
  const [observations, setObservations] = useState<JobObservationsResult | null>(null);
  const [collecting, setCollecting] = useState<boolean>(false);
  const [observationError, setObservationError] = useState<string | null>(null);

  // 2. Data & Scheduling State
  const [dataSourceMode, setDataSourceMode] = useState<'live' | 'demo'>('live');
  // P9 (public staging): live data needs a signed-in user AND a provider key on the server. Otherwise
  // the page starts on the labelled synthetic demo trace instead of opening with an error, and no
  // live request is made. Nothing is loaded until this check has finished.
  const [modeReady, setModeReady] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const signedIn = api.hasSession();
      const provider = signedIn ? await api.getProviderStatus() : null;
      if (cancelled) return;
      if (!signedIn || !(provider?.success && provider.data?.configured)) {
        setDataSourceMode('demo');
        setRegion('BENCHMARK-RESEARCH');
      }
      setModeReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [forecast, setForecast] = useState<CarbonForecastData | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [decision, setDecision] = useState<SchedulingDecisionResponse | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'feasible' | 'rejected'>('all');

  // 3. Kubernetes Execution State
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [executionRecord, setExecutionRecord] = useState<K8sJobExecutionRecord | null>(null);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [clusterHealth, setClusterHealth] = useState<{ isAvailable: boolean; message: string } | null>(null);

  // 4. Kubernetes Manifest Inspector State
  const [showManifestModal, setShowManifestModal] = useState<boolean>(false);
  const [manifestData, setManifestData] = useState<any>(null);
  const [manifestLoading, setManifestLoading] = useState<boolean>(false);
  const [manifestCopied, setManifestCopied] = useState<boolean>(false);

  // Auto-scroll logs
  const terminalLogsRef = useRef<HTMLDivElement>(null);

  // Whether the selected zone can be scheduled in the selected data mode on this server.
  const usability = zoneUsability(region, dataSourceMode, catalogue, api.hasSession());

  // Load Carbon Forecast on Region or Data Source Mode change
  const loadForecast = async (targetRegion: string, mode: 'live' | 'demo' = dataSourceMode) => {
    setForecastError(null);
    try {
      const res = await api.getCarbonForecast(targetRegion, mode);
      if (res.success && res.data) {
        setForecast(res.data);
      } else {
        setForecast(null);
        setForecastError(res.message || 'Live carbon forecast unavailable.');
      }
    } catch (err: any) {
      setForecast(null);
      setForecastError(err.message || 'Live carbon forecast unavailable.');
    }
  };

  const checkCluster = async () => {
    try {
      const res = await api.getClusterHealth();
      if (res.success && res.data) {
        setClusterHealth(res.data);
      }
    } catch {
      setClusterHealth({ isAvailable: false, message: 'Cluster status check offline.' });
    }
  };

  useEffect(() => {
    if (!modeReady) return;
    checkCluster();
    // P11: no request for a zone that cannot be used in this mode; the reason is shown instead.
    if (!usability.usable) {
      setForecast(null);
      setForecastError(null);
      return;
    }
    loadForecast(region, dataSourceMode);
  }, [region, dataSourceMode, modeReady, usability.usable]);

  useEffect(() => {
    let cancelled = false;
    api.getZoneCatalogue().then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setCatalogue(res.data);
      else setCatalogueError(res.message || 'unknown error');
    });
    return () => {
      cancelled = true;
    };
  }, []);


  const handleCollectObservations = async () => {
    if (!activeJobId) return;
    setCollecting(true);
    setObservationError(null);
    const res = await api.collectObservations(activeJobId);
    if (res.success && res.data) setObservations(res.data);
    else setObservationError(res.message || 'Observation collection failed.');
    setCollecting(false);
  };

  // Execute Scheduling Evaluation
  const handleEvaluateSchedule = async (e?: React.FormEvent, overrideMode?: 'live' | 'demo') => {
    if (e) e.preventDefault();
    setEvaluatedOnce(true);
    const mode = overrideMode || dataSourceMode;
    setLoadingSchedule(true);
    setScheduleError(null);
    setInfeasibleReason(null);
    setObservations(null);
    setObservationError(null);
    setExecutionRecord(null);

    try {
      const jobData: Partial<WorkloadJob> & { deadlineAt: string } = {
        name: jobName,
        commandOrImage,
        isContainerImage,
        durationHours,
        // Absolute deadline (UTC) computed when the job is submitted.
        deadlineAt: new Date(Date.now() + deadlineHours * 3600_000).toISOString(),
        cpu,
        memoryMb,
        region,
        riskTolerance,
      };

      const res = await api.scheduleJob({ jobData, region, mode, runtimeCv });
      if (res.success && res.data && res.data.status && res.data.status !== 'RECOMMENDED') {
        setDecision(null);
        setActiveJobId(null);
        setInfeasibleReason(res.data.reason || 'No execution window meets the deadline.');
      } else if (res.success && res.data) {
        setDecision(res.data);
        setActiveJobId(res.data.job.id);
        if (!forecast || forecast.region !== region || forecast.dataMode !== mode) {
          loadForecast(region, mode);
        }
      } else {
        setScheduleError(res.message || 'Scheduling evaluation failed.');
      }
    } catch (err: any) {
      setScheduleError(err.message || 'Network error during scheduling evaluation.');
    } finally {
      setLoadingSchedule(false);
    }
  };

  // P9: scheduling runs only when the user asks. It used to run on every visit, which stored a job
  // the user never submitted and spent live provider calls each time the page was opened.
  const [evaluatedOnce, setEvaluatedOnce] = useState(false);

  // Dispatch Job to Kubernetes
  const handleDispatchJob = async () => {
    if (!activeJobId || !decision) return;
    setDispatching(true);

    try {
      const res = await api.dispatchJob(activeJobId, {
        predictedCarbon: decision.recommendedDecision.predictedCarbon,
        simulatedDurationSec: 8,
      });

      if (res.success && res.data) {
        setExecutionRecord(res.data);
      }
    } catch (err) {
      console.error('Failed to dispatch job:', err);
    } finally {
      setDispatching(false);
    }
  };

  // Convert JSON manifest object to formatted YAML string
  const toYamlString = (obj: any, indent = 0): string => {
    const pad = '  '.repeat(indent);
    if (typeof obj !== 'object' || obj === null) {
      return String(obj);
    }
    if (Array.isArray(obj)) {
      return obj
        .map((item) => {
          if (typeof item === 'object' && item !== null) {
            const inner = toYamlString(item, indent + 1).trimStart();
            return `${pad}- ${inner}`;
          }
          return `${pad}- ${item}`;
        })
        .join('\n');
    }
    return Object.entries(obj)
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
          return `${pad}${key}:\n${toYamlString(val, indent + 1)}`;
        }
        return `${pad}${key}: ${val}`;
      })
      .join('\n');
  };

  // Open Kubernetes Manifest modal
  const handleOpenManifest = async () => {
    setShowManifestModal(true);
    setManifestLoading(true);
    setManifestCopied(false);
    try {
      const hour = decision?.recommendedDecision.selectedStartHour ?? 0;
      if (activeJobId) {
        const res = await api.getJobManifest(activeJobId, hour);
        if (res.success && res.data) {
          setManifestData(res.data);
          return;
        }
      }

      // In-client manifest constructor
      const cleanId = (jobName || 'batch-job').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
      setManifestData({
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: `carbonroute-${cleanId}`,
          namespace: 'carbonroute-jobs',
          labels: {
            app: 'carbonroute-workload',
            'carbonroute.io/job-id': activeJobId || 'job-preview',
            'carbonroute.io/scheduled-hour': `T+${hour}`,
            'carbonroute.io/managed-by': 'carbonroute-scheduler',
          },
        },
        spec: {
          backoffLimit: 2,
          ttlSecondsAfterFinished: 3600,
          template: {
            metadata: {
              labels: {
                app: 'carbonroute-workload',
                'carbonroute.io/job-id': activeJobId || 'job-preview',
              },
            },
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'workload-runner',
                  image: commandOrImage.startsWith('python') || commandOrImage.startsWith('tar')
                    ? 'ghcr.io/carbonroute/workload-synthetic:latest'
                    : commandOrImage,
                  command: commandOrImage.startsWith('python')
                    ? ['python', '/app/workload.py', '--epochs', '5']
                    : ['sh', '-c', commandOrImage],
                  resources: {
                    requests: { cpu: `${cpu}`, memory: `${memoryMb}Mi` },
                    limits: { cpu: `${cpu}`, memory: `${memoryMb}Mi` },
                  },
                  env: [
                    { name: 'CARBONROUTE_JOB_ID', value: activeJobId || 'job-preview' },
                    { name: 'CARBONROUTE_SCHEDULED_HOUR', value: String(hour) },
                    { name: 'CARBONROUTE_REGION', value: region },
                  ],
                },
              ],
            },
          },
        },
      });
    } catch (err) {
      console.error('Failed to load manifest:', err);
    } finally {
      setManifestLoading(false);
    }
  };

  // Poll Execution Status if Running
  useEffect(() => {
    if (!activeJobId || !executionRecord) return;
    if (executionRecord.status === 'completed' || executionRecord.status === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const res = await api.getJobStatus(activeJobId);
        if (res.success && res.data) {
          // Keep the stored execution details (scheduled window) from the dispatch response.
          setExecutionRecord((prev) => ({ ...res.data!, execution: res.data!.execution ?? prev?.execution ?? null }));
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeJobId, executionRecord?.status]);

  // Auto-scroll logs
  useEffect(() => {
    if (terminalLogsRef.current) {
      terminalLogsRef.current.scrollTop = terminalLogsRef.current.scrollHeight;
    }
  }, [executionRecord?.logs]);

  // Preset Handlers
  const applyPreset = (
    name: string,
    cmdOrImg: string,
    dur: number,
    ddl: number,
    cpuCount: number,
    ram: number,
    tau: number,
    reg: string
  ) => {
    setJobName(name);
    setCommandOrImage(cmdOrImg);
    setIsContainerImage(!cmdOrImg.startsWith('python') && !cmdOrImg.startsWith('tar'));
    setDurationHours(dur);
    setDeadlineHours(ddl);
    setCpu(cpuCount);
    setMemoryMb(ram);
    setRiskTolerance(tau);
    setRegion(reg);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* 1. Header & Milestone Context */}
      <div className="space-y-4 pb-6 border-b border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold">PROTOTYPE MILESTONE VERTICAL SLICE</span>
            <span className="text-slate-500">&bull;</span>
            <span>Team TriFlux</span>
          </div>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
              API: <strong className="text-emerald-400">Online</strong>
            </span>
            <span
              className={`px-2.5 py-1 rounded border ${
                clusterHealth?.isAvailable
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                  : 'bg-amber-950/40 text-amber-300 border-amber-800/60'
              }`}
            >
              K8s Cluster:{' '}
              <strong>{clusterHealth?.isAvailable ? 'Minikube Live' : 'Sandbox Fallback'}</strong>
            </span>
          </div>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          CarbonRoute End-to-End Scheduling Prototype
        </h1>
        <p className="text-sm text-slate-400 max-w-4xl leading-relaxed">
          Demonstrates one complete software vertical slice: from job submission through Electricity Maps carbon
          forecasting, horizon uncertainty modeling, evaluation of 5 scheduling policies, CarbonRoute
          deadline-risk decision, to containerized Kubernetes dispatch and results collection.
        </p>
      </div>

      {/* 2. SECTION A: JOB SUBMISSION */}
      <section className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                STEP 1 &bull; INPUT
              </span>
              <h2 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                <span>Submit Flexible Batch Workload</span>
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Provide workload parameters and acceptable deadline risk tolerance $\tau$.
            </p>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <span className="text-slate-500">Presets:</span>
            <button
              type="button"
              onClick={() => {
                setDataSourceMode('demo');
                applyPreset('ResNet-50 ML Training', 'carbonroute/test-workload:latest', 2, 12, 1, 512, 0.05, 'BENCHMARK-RESEARCH');
              }}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/40"
            >
              1. Controlled Benchmark Demo
            </button>
            <button
              type="button"
              onClick={() =>
                applyPreset('Batch Data Transformation', 'python workload.py', 1, 6, 2, 1024, 0.10, 'US-TEX-ERCO')
              }
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/40"
            >
              2. Data Pipeline
            </button>
            <button
              type="button"
              onClick={() =>
                applyPreset('DB Backup & Compression', 'tar -czf backup.tar.gz /data', 3, 9, 1, 256, 0.02, 'DE')
              }
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/40"
            >
              3. Nightly Backup
            </button>
          </div>
        </div>

        <form onSubmit={handleEvaluateSchedule} className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs font-mono">
          {/* Workload Name */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">Workload Name</label>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
              required
            />
            <span className="text-[10px] text-slate-500 block">Identifier for telemetry &amp; logs</span>
          </div>

          {/* Container Image or Command */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">Container Image or Command</label>
            <input
              type="text"
              value={commandOrImage}
              onChange={(e) => setCommandOrImage(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400 focus:outline-none focus:border-emerald-500"
              required
            />
            <span className="text-[10px] text-slate-500 block">e.g. carbonroute/test-workload:latest or python workload.py</span>
          </div>

          {/* Grid Region (P11: the complete global catalogue) */}
          <ZoneSelector value={region} onChange={setRegion} mode={dataSourceMode} catalogue={catalogue} error={catalogueError} signedIn={api.hasSession()} />

          {/* Carbon Data Source Mode */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-slate-300 font-semibold">Carbon Data Source</label>
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase font-bold ${
                  dataSourceMode === 'live'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}
              >
                {dataSourceMode === 'live' ? 'DEFAULT: LIVE' : 'DEMO BENCHMARK'}
              </span>
            </div>
            <select
              aria-label="Carbon data source"
              value={dataSourceMode}
              onChange={(e) => {
                const newMode = e.target.value as 'live' | 'demo';
                // P11: the selected zone is kept; if it cannot be used in the new mode the panel says
                // why (no silent replacement by another region).
                setDataSourceMode(newMode);
              }}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="live">Live Electricity Maps API (Production)</option>
              <option value="demo">Controlled Research Benchmark / Demo Trace</option>
            </select>
            <span className="text-[10px] text-slate-500 block">
              {dataSourceMode === 'live'
                ? 'Queries live forecast from Electricity Maps API v3'
                : 'Uses the synthetic demo trace (labelled synthetic, not real data)'}
            </span>
          </div>

          {/* Runtime Duration */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="text-slate-300 font-semibold">Expected Runtime Duration</label>
              <span className="text-emerald-400 font-bold">{durationHours} Hours</span>
            </div>
            <input
              type="range"
              min="1"
              max="6"
              step="1"
              value={durationHours}
              onChange={(e) => setDurationHours(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <span className="text-[10px] text-slate-500 block">Continuous execution duration</span>
          </div>

          {/* Completion Deadline */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="text-slate-300 font-semibold">Completion Deadline</label>
              <span className="text-emerald-400 font-bold">in {deadlineHours} h</span>
            </div>
            <input
              type="range"
              min={durationHours}
              max="71"
              step="1"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(parseInt(e.target.value, 10))}
              aria-label="Deadline in hours from now"
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <span className="text-[10px] text-slate-500 block">
              Must finish by {formatLocal(new Date(Date.now() + deadlineHours * 3600_000).toISOString())} (your time) ·{' '}
              {new Date(Date.now() + deadlineHours * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} UTC
            </span>
          </div>

          {/* Risk Tolerance tau */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="text-slate-300 font-semibold">Deadline Risk Tolerance (&tau;)</label>
              <span className="text-emerald-400 font-bold">{(riskTolerance * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.01"
              max="0.25"
              step="0.01"
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <span className="text-[10px] text-slate-500 block">Max acceptable P(deadline violation) threshold (&tau;)</span>
          </div>

          {/* Declared runtime variability (P6) */}
          <div className="space-y-1.5">
            <label htmlFor="runtime-cv" className="text-slate-300 font-semibold block">
              Runtime variability (CV)
            </label>
            <select
              id="runtime-cv"
              value={runtimeCv}
              onChange={(e) => setRuntimeCv(parseFloat(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
            >
              <option value={0}>0: runtime is exact (deterministic)</option>
              <option value={0.1}>0.1</option>
              <option value={0.2}>0.2</option>
              <option value={0.3}>0.3</option>
            </select>
            <span className="text-[10px] text-slate-500 block">Declared by you, not learned: runtime ~ Normal(d, (CV&middot;d)&sup2;)</span>
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={loadingSchedule || !usability.usable}
              className="px-6 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-all font-mono flex items-center space-x-2 shadow-lg shadow-emerald-950/50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingSchedule ? 'animate-spin' : ''}`} />
              <span>Evaluate 5 Schedulers</span>
            </button>
          </div>
        </form>

        {!usability.usable && (
          <p className="mt-4 text-xs text-amber-300 font-mono" role="status" data-testid="zone-unusable">
            Evaluation is disabled for {region}: {usability.reason}
          </p>
        )}

        {!evaluatedOnce && (
          <p className="mt-4 text-xs text-slate-400 font-mono" data-testid="evaluate-hint">
            Set the workload and press <strong className="text-slate-200">Evaluate 5 Schedulers</strong>. Each evaluation is saved as a
            job in My jobs{dataSourceMode === "live" ? " and uses one live Electricity Maps request" : ""}; nothing is scheduled until you press it.
          </p>
        )}

        {/* Live Error Banner with One-Click Demo Mode Fallback Option */}
        {(scheduleError || forecastError) && (
          <div className="mt-4 p-4 rounded-xl bg-rose-950/50 border border-rose-800/70 space-y-2 text-rose-200 font-mono text-xs">
            <div className="flex items-start space-x-2 font-bold text-rose-400">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>
                {scheduleError || forecastError}
                {(scheduleError || forecastError) && !api.hasSession() && (
                  <>
                    {' '}
                    <Link to="/admin" className="underline font-bold">
                      Sign in
                    </Link>
                  </>
                )}
              </span>
            </div>
            {dataSourceMode === 'live' && (
              <div className="pt-2 border-t border-rose-900/50 flex flex-wrap items-center justify-between gap-3">
                <span className="text-slate-300 text-[11px]">
                  Electricity Maps live API requires <code className="text-emerald-300">ELECTRICITY_MAPS_API_KEY</code> on the backend. To try the schedulers without it, switch to the synthetic demo trace:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDataSourceMode('demo');
                    handleEvaluateSchedule(undefined, 'demo');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-all text-xs"
                >
                  Switch to Prepared Benchmark Trace (Demo)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Explicit infeasibility: no recommendation is invented */}
        {infeasibleReason && (
          <div role="alert" className="mt-4 p-4 rounded-xl bg-amber-950/50 border border-amber-700/70 text-amber-100 font-mono text-xs space-y-1">
            <div className="flex items-center space-x-2 font-bold text-amber-300">
              <AlertCircle className="w-4 h-4" />
              <span>No feasible execution window</span>
            </div>
            <p>{infeasibleReason}</p>
            <p className="text-amber-300/80">Extend the deadline or shorten the job, then evaluate again.</p>
          </div>
        )}
      </section>

      {/* 3. SECTION B: CARBON INTENSITY FORECAST DATA */}
      {forecast && (
        <section className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  STEP 2 &bull; DATA
                </span>
                <h2 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Carbon Intensity Forecast: {forecast.regionName}</span>
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                Hourly <strong className="text-slate-200">forecast</strong> intensity (gCO2eq/kWh), starting{' '}
                {formatLocal(forecast.hourlyProfile[0]?.timestamp)} (your time).{' '}
                {forecast.uncertaintySource === 'unavailable'
                  ? 'The provider gives no forecast uncertainty, so none is shown.'
                  : 'Uncertainty (σ) comes from the synthetic demo model.'}
              </p>
              {forecast.snapshot && (
                <p className="text-[10px] text-slate-500 font-mono">
                  Issued {forecast.snapshot.issuedAt ? `${forecast.snapshot.issuedAt} UTC` : 'time not given'} · fetched{' '}
                  {forecast.snapshot.fetchedAt} UTC · {forecast.snapshot.emissionFactorType} emission factors
                  {forecast.timezone ? ` · zone time zone ${forecast.timezone}` : ''}
                </p>
              )}
            </div>

            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${forecast.dataMode === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-slate-400">Source:</span>
              <strong className="text-white">{forecast.source}</strong>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                forecast.dataMode === 'live'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-950 text-amber-300 border border-amber-500/40'
              }`}>
                {forecast.dataMode === 'live' ? 'REAL FORECAST · ELECTRICITY MAPS' : 'SYNTHETIC DEMO DATA (NOT REAL)'}
              </span>
            </div>
          </div>

          {/* 24-Hour Horizon Bar Chart Visualization */}
          <div className="space-y-3">
            <div className="grid grid-cols-12 sm:grid-cols-24 gap-1 items-end h-40 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
              {forecast.hourlyProfile.map((point) => {
                const maxVal = forecast.maxCarbon || 500;
                const heightPercent = Math.max(15, Math.round((point.predictedCarbon / maxVal) * 100));
                const isOptimal = point.predictedCarbon === forecast.minCarbon;
                const isSelected = decision?.recommendedDecision.selectedStartHour === point.hour;

                return (
                  <div
                    key={point.hour}
                    className="flex flex-col items-center justify-end h-full group relative cursor-pointer"
                    title={`${formatLocal(point.timestamp)}: forecast ${point.predictedCarbon} gCO2eq/kWh${point.stdDev === null ? '' : ` (±${point.stdDev}, synthetic)`}`}
                  >
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t transition-all ${
                        isSelected
                          ? 'bg-emerald-400 shadow-md shadow-emerald-500/50'
                          : isOptimal
                          ? 'bg-teal-400/80'
                          : 'bg-slate-700/60 hover:bg-slate-600'
                      }`}
                    />
                    <span className="text-[9px] text-slate-500 font-mono mt-1 hidden sm:block">
                      {point.hour}
                    </span>

                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:block z-30 w-36 p-2 bg-slate-900 text-[10px] font-mono text-slate-200 rounded border border-slate-700 shadow-xl pointer-events-none">
                      <div className="text-emerald-400 font-bold">{formatLocal(point.timestamp)}</div>
                      <div>Forecast: {point.predictedCarbon} gCO2eq/kWh</div>
                      <div className="text-slate-400">
                        {point.stdDev === null ? 'Uncertainty: not provided' : <>&sigma; (synthetic): &plusmn;{point.stdDev}</>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 px-1">
              <div className="flex items-center space-x-4">
                <span className="flex items-center space-x-1.5">
                  <span className="w-3 h-3 rounded bg-emerald-400" />
                  <span>CarbonRoute Selected Start</span>
                </span>
                <span className="flex items-center space-x-1.5">
                  <span className="w-3 h-3 rounded bg-teal-400/80" />
                  <span>Global Carbon Minimum</span>
                </span>
              </div>
              <div>
                Min: <strong className="text-emerald-400">{forecast.minCarbon}</strong> &bull; Avg:{' '}
                <strong className="text-slate-200">{forecast.averageCarbon}</strong> &bull; Max:{' '}
                <strong className="text-rose-400">{forecast.maxCarbon}</strong> gCO2eq/kWh
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. SECTION C & D: SCHEDULING DECISION & POLICY COMPARISON */}
      {decision && (
        <section className="space-y-6">
          {/* SECTION D: ALL SCHEDULING OPTIONS (All Candidate Scheduling Windows) */}
          {decision.candidateWindows && decision.candidateWindows.length > 0 && (
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300">
                      STEP 3A &bull; CANDIDATE ENUMERATION
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white font-mono flex items-center space-x-2 mt-1">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    <span>All Candidate Scheduling Windows</span>
                  </h3>
                  <p className="text-xs font-mono text-slate-400 mt-1">
                    Exhaustively evaluating every possible execution window fitting before deadline (T+0 to T+{deadlineHours})
                  </p>
                </div>

                {/* Filter Controls */}
                <div className="flex items-center space-x-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setCandidateFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center space-x-1.5 ${
                      candidateFilter === 'all'
                        ? 'bg-slate-800 text-white font-bold shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>All Windows</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-700/60 text-slate-300">
                      {decision.candidateWindows.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCandidateFilter('feasible')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center space-x-1.5 ${
                      candidateFilter === 'feasible'
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 font-bold shadow'
                        : 'text-slate-400 hover:text-emerald-300'
                    }`}
                  >
                    <span>Feasible</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-900/60 text-emerald-300">
                      {decision.candidateWindows.filter((w) => w.isFeasible).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCandidateFilter('rejected')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center space-x-1.5 ${
                      candidateFilter === 'rejected'
                        ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40 font-bold shadow'
                        : 'text-slate-400 hover:text-rose-300'
                    }`}
                  >
                    <span>Rejected</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-900/60 text-rose-300">
                      {decision.candidateWindows.filter((w) => !w.isFeasible).length}
                    </span>
                  </button>
                </div>
              </div>

              {/* Candidate Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400 text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">Execution Window</th>
                      <th className="p-3">Wait Delay</th>
                      <th className="p-3">Grid Intensity (gCO2eq/kWh)</th>
                      <th className="p-3">Est. Emissions (gCO2eq)</th>
                      <th className="p-3">Forecast Uncertainty</th>
                      <th className="p-3">Deadline Risk</th>
                      <th className="p-3">Slack Time</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 min-w-[220px]">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {decision.candidateWindows
                      .filter((win) => {
                        if (candidateFilter === 'feasible') return win.isFeasible;
                        if (candidateFilter === 'rejected') return !win.isFeasible;
                        return true;
                      })
                      .map((win) => {
                        const isRec = win.classification === 'RECOMMENDED';
                        const isRiskBreach = win.classification === 'REJECTED_HIGH_RISK';
                        const isDeadlineBreach = win.classification === 'REJECTED_DEADLINE_BREACH';

                        return (
                          <tr
                            key={win.slotIndex}
                            className={`transition-colors ${
                              isRec
                                ? 'bg-emerald-950/30 font-semibold border-l-2 border-l-emerald-500'
                                : 'hover:bg-slate-900/50'
                            }`}
                          >
                            <td className="p-3 whitespace-nowrap">
                              <div className="flex items-center space-x-2">
                                <span className="text-white font-bold">{win.windowLabel}</span>
                                {isRec && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                                    OPTIMUM
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 whitespace-nowrap text-slate-300">
                              +{win.waitingTimeHours}h
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span className="text-emerald-400 font-bold">
                                {win.predictedCarbonIntensity.toFixed(1)}
                              </span>{' '}
                              <span className="text-slate-500 text-[10px]">gCO2eq/kWh</span>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span className="text-white font-bold">
                                {win.predictedCarbonImpactGrams.toFixed(1)}
                              </span>{' '}
                              <span className="text-slate-500 text-[10px]">gCO2eq</span>
                            </td>
                            <td className="p-3 whitespace-nowrap text-slate-300">
                              <span className="text-slate-400">{win.uncertaintyRange}</span>{' '}
                              {win.stdDev !== null && (
                                <span className="text-[10px] text-slate-500">(σ={win.stdDev.toFixed(1)}, synthetic)</span>
                              )}
                              {win.startUtc && (
                                <span className="block text-[10px] text-slate-500">{formatLocal(win.startUtc)}</span>
                              )}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span
                                className={`font-bold ${
                                  win.deadlineRisk > riskTolerance
                                    ? 'text-rose-400'
                                    : win.deadlineRisk > 0
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                                }`}
                              >
                                {win.deadlineRiskPct}
                              </span>
                            </td>
                            <td className="p-3 whitespace-nowrap text-slate-400">
                              {win.slackHours >= 0 ? `${win.slackHours}h remaining` : `${win.slackHours}h overrun`}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              {isRec ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/50">
                                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                                  <span>RECOMMENDED</span>
                                </span>
                              ) : win.isFeasible ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-300 text-[11px] border border-sky-500/30">
                                  <span>FEASIBLE</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-300 text-[11px] border border-rose-500/40">
                                  <AlertCircle className="w-3 h-3 text-rose-400" />
                                  <span>REJECTED</span>
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-slate-400 text-[11px] leading-relaxed">
                              {win.reason}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CarbonRoute Highlight Card (CARBONROUTE RECOMMENDATION) */}
          <div className="glass-card rounded-2xl p-6 sm:p-8 border-2 border-emerald-500/50 bg-gradient-to-b from-emerald-950/20 to-slate-900/80 shadow-2xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-emerald-500/30 gap-3">
              <div className="space-y-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500 text-slate-950">
                  STEP 3B &bull; CARBONROUTE RECOMMENDATION
                </span>
                <h3 className="text-xl font-extrabold text-white font-mono">
                  CarbonRoute Recommendation
                </h3>
              </div>

              <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-xs font-mono text-emerald-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>
                  {decision.riskModel === 'declared-runtime-cv'
                    ? `Deadline risk from declared runtime variability (CV ${decision.runtimeCv}): P(miss) ≤ ${(riskTolerance * 100).toFixed(0)}%`
                    : 'Deadline check: window finishes before the deadline (deterministic runtime)'}
                </span>
              </div>
            </div>

            {decision.explanation && (
              <DecisionExplanationPanel
                explanation={decision.explanation}
                policyNames={Object.fromEntries(decision.evaluatedPolicies.map((p) => [p.policyId, p.policyName]))}
              />
            )}
            {activeJobId && (
              <p className="text-xs text-slate-400">
                This job is saved. See it any time, with its report, in{' '}
                <Link to="/jobs" className="underline font-bold">
                  My jobs
                </Link>
                .
              </p>
            )}

            {decision.recommendedWindow && decision.timeline && (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-xs font-mono text-slate-300 space-y-1">
                <div>
                  <span className="text-emerald-400 font-bold">Run from </span>
                  {formatLocal(decision.recommendedWindow.startUtc)} <span className="text-emerald-400 font-bold">to </span>
                  {formatLocal(decision.recommendedWindow.endUtc)} (your time)
                </div>
                <div className="text-slate-500 text-[10px]">
                  UTC {decision.recommendedWindow.startUtc} → {decision.recommendedWindow.endUtc} · deadline{' '}
                  {decision.timeline.deadlineAt} ·{' '}
                  <span className="text-emerald-400">meets deadline</span>
                  {decision.timeline.deadlineBeyondForecast &&
                    ` · forecast ends ${decision.timeline.forecastCoverageEndUtc}; later windows not evaluated`}
                </div>
                {decision.provenance && (
                  <div className="text-slate-500 text-[10px]">
                    Decision {decision.decisionId} · forecast snapshot {decision.snapshotId} ({decision.provenance.provider},{' '}
                    {decision.provenance.dataClass === 'real' ? 'real data' : 'SYNTHETIC data'})
                  </div>
                )}
              </div>
            )}

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs font-mono">
              <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/40 space-y-1">
                <span className="text-slate-400 block text-[11px]">Recommended</span>
                <div className="text-lg font-extrabold text-white">
                  {decision.recommendedDecision.selectedWindow}
                </div>
                <span className="text-slate-500 text-[10px]">Hours after forecast start</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/30 space-y-1">
                <span className="text-emerald-400 block text-[11px]">Expected Grid Intensity</span>
                <div className="text-lg font-extrabold text-emerald-300">
                  {decision.timeWeightedForecast?.recommendedIntensity ??
                    decision.recommendedDecision.predictedCarbonIntensity ??
                    decision.recommendedDecision.predictedCarbon}{' '}
                  <span className="text-xs text-slate-400">gCO2eq/kWh</span>
                </div>
                <span className="text-emerald-400/80 text-[10px]">
                  {decision.timeWeightedForecast
                    ? `Forecast: ${decision.timeWeightedForecast.savingsVsImmediatePct ?? 'n/a'}% vs Immediate (time-weighted; predicted, not observed)`
                    : `Forecast: ${decision.comparisonSummary.carbonSavingsVsImmediatePct}% vs Immediate (predicted, not observed)`}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 block text-[11px]">Deadline Risk</span>
                <div className="text-lg font-extrabold text-amber-300">
                  {(decision.recommendedDecision.estimatedDeadlineRisk * 100).toFixed(1)}%
                </div>
                <span className="text-slate-500 text-[10px]">
                  Within &le; {(riskTolerance * 100).toFixed(0)}% tolerance
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 block text-[11px]">Waiting Delay</span>
                <div className="text-lg font-extrabold text-white">
                  +{decision.recommendedDecision.waitingTimeHours} Hours
                </div>
                <span className="text-slate-500 text-[10px]">Intentional shift delay</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 block text-[11px]">Risk Tolerance</span>
                <div className="text-lg font-extrabold text-teal-300">
                  {(riskTolerance * 100).toFixed(0)}%
                </div>
                <span className="text-slate-500 text-[10px]">User threshold &tau;</span>
              </div>
            </div>

            {/* Rationale Explanation */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1 font-mono text-xs">
              <span className="text-emerald-400 font-bold block flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5" />
                <span>Reason:</span>
              </span>
              <p className="text-slate-300 leading-relaxed">
                {decision.recommendedDecision.rationale}
              </p>
            </div>

            {/* Dispatch Action */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-xs font-mono text-slate-400">
                Ready to dispatch workload to Kubernetes Job connector.
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenManifest}
                  className="px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 font-bold hover:text-emerald-300 hover:border-emerald-500/50 transition-all font-mono flex items-center space-x-2"
                >
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span>Inspect K8s Manifest</span>
                </button>

                <button
                  type="button"
                  onClick={handleDispatchJob}
                  disabled={dispatching || executionRecord?.status === 'running'}
                  className="px-6 py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition-all font-mono flex items-center space-x-2 shadow-lg shadow-emerald-950/50 disabled:opacity-50"
                >
                  <Server className={`w-4 h-4 ${dispatching ? 'animate-spin' : ''}`} />
                  <span>
                    {executionRecord?.status === 'running'
                      ? 'Workload Executing...'
                      : 'Dispatch to Kubernetes & Execute'}
                  </span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          </div>

          {/* SECTION E: SCHEDULING TRADE-OFF VISUALIZER */}
          {(() => {
            const immPol = decision.evaluatedPolicies.find((p) => p.policyId === 'immediate');
            const detPol = decision.evaluatedPolicies.find((p) => p.policyId === 'deterministic_carbon');
            const recPol = decision.recommendedDecision;
            const immCarbon = immPol?.predictedCarbon ?? 0;
            const detCarbon = detPol?.predictedCarbon ?? 0;
            const recCarbon = recPol?.predictedCarbon ?? 0;

            return (
              <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-base font-bold text-white font-mono flex items-center space-x-2">
                      <TrendingDown className="w-4 h-4 text-emerald-400" />
                      <span>Scheduling Trade-Off Visualizer (Carbon vs. Risk)</span>
                    </h3>
                    <p className="text-xs font-mono text-slate-400 mt-1">
                      Direct trade-off breakdown between immediate dispatch, greedy delay, and CarbonRoute's risk-bounded optimum
                    </p>
                  </div>
                  <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-300">
                    Risk Limit: {(riskTolerance * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 font-mono">
                  {/* Option 1: Immediate Execution */}
                  <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Option 1: Immediate
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                          T+0:00
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="text-2xl font-extrabold text-white">
                          {immCarbon} <span className="text-xs font-normal text-slate-400">gCO2eq/kWh</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Wait Delay:</span>
                          <span className="text-white font-bold">0 Hours</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Deadline Risk:</span>
                          <span className="text-emerald-400 font-bold">0.0% (Zero Risk)</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Slack Remaining:</span>
                          <span className="text-slate-300 font-bold">{deadlineHours - durationHours}h</span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                      Safe on-time completion, but pays maximum carbon penalty because work is executed immediately regardless of grid carbon intensity.
                    </div>
                  </div>

                  {/* Option 2: Deterministic / Greedy Carbon */}
                  <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                          Option 2: Greedy Delay
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300">
                          T+{detPol?.waitingTimeHours || 0}:00
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="text-2xl font-extrabold text-amber-300">
                          {detCarbon} <span className="text-xs font-normal text-slate-400">gCO2eq/kWh</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Wait Delay:</span>
                          <span className="text-white font-bold">+{detPol?.waitingTimeHours || 0} Hours</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Deadline Risk:</span>
                          <span
                            className={`font-bold ${
                              (detPol?.estimatedDeadlineRisk || 0) > riskTolerance
                                ? 'text-rose-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {(((detPol?.estimatedDeadlineRisk || 0) * 100)).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Slack Remaining:</span>
                          <span className="text-slate-300 font-bold">
                            {Math.max(0, deadlineHours - (detPol?.waitingTimeHours || 0) - durationHours)}h
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                      {(detPol?.estimatedDeadlineRisk || 0) > riskTolerance
                        ? `Greedily chases lowest point forecast, but uncertainty pushes risk to ${((detPol?.estimatedDeadlineRisk || 0) * 100).toFixed(1)}%, exceeding safety threshold.`
                        : 'Selects the lowest point forecast window without accounting for forecast uncertainty variance.'}
                    </div>
                  </div>

                  {/* Option 3: CarbonRoute Optimum */}
                  <div className="p-5 rounded-xl bg-emerald-950/20 border-2 border-emerald-500/60 space-y-4 flex flex-col justify-between shadow-lg shadow-emerald-950/40 relative">
                    <div className="absolute -top-3 right-4 px-2 py-0.5 bg-emerald-500 text-slate-950 text-[10px] font-extrabold rounded-full uppercase tracking-wider">
                      Optimal Balance
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          Option 3: CarbonRoute
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-500/40 text-emerald-300">
                          T+{recPol.waitingTimeHours}:00
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="text-2xl font-extrabold text-emerald-300">
                          {recCarbon} <span className="text-xs font-normal text-slate-400">gCO2eq/kWh</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Wait Delay:</span>
                          <span className="text-white font-bold">+{recPol.waitingTimeHours} Hours</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Deadline Risk:</span>
                          <span className="text-emerald-400 font-bold">
                            {((recPol.estimatedDeadlineRisk || 0) * 100).toFixed(1)}% &le; {(riskTolerance * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-slate-400">Carbon Savings:</span>
                          <span className="text-emerald-300 font-bold">
                            -{decision.timeWeightedForecast?.savingsVsImmediatePct ?? decision.comparisonSummary.carbonSavingsVsImmediatePct}% vs Immediate (forecast)
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-emerald-500/20 text-[11px] text-emerald-200/90 leading-relaxed">
                      Mathematically bounds risk below user tolerance &tau; while maximizing emissions reduction. The provable sweet spot.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* RESEARCH INSIGHT: LOWEST PREDICTED CARBON IS NOT ALWAYS THE SAFEST SCHEDULING DECISION */}
          {decision.researchInsight && (
            <div className="glass-card rounded-2xl p-6 sm:p-8 border-2 border-indigo-500/40 bg-gradient-to-b from-indigo-950/20 to-slate-900/80 shadow-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-indigo-500/30 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500 text-slate-950 uppercase tracking-wider">
                      RESEARCH INSIGHT
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-500/30">
                      Carbon vs. Operational Safety
                    </span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-extrabold text-white font-mono">
                    Lowest Predicted Carbon is Not Always the Safest Scheduling Decision
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Why greedy delay fails in real-world grid operations: comparing the unconstrained carbon minimum against CarbonRoute's risk-bounded dispatch.
                  </p>
                </div>
                <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-xs font-mono text-indigo-300 shrink-0">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Max Risk Bound &tau; = {(riskTolerance * 100).toFixed(0)}%</span>
                </div>
              </div>

              {(() => {
                const ri = decision.researchInsight;
                const lowWin = ri.lowestCarbonWindow;
                const recWin = ri.recommendedWindow;
                const carbonDeltaGrams = Math.max(
                  0,
                  Math.round((recWin.predictedCarbonImpactGrams - lowWin.predictedCarbonImpactGrams) * 10) / 10
                );

                return (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 font-mono">
                      {/* Candidate 1: Absolute Lowest Predicted Carbon */}
                      <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4 flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                              Unconstrained Carbon Minimum
                            </span>
                            {ri.isLowestCarbonSafe ? (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-bold uppercase">
                                Feasible &amp; Safe
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 border border-rose-500/40 text-rose-300 font-bold uppercase flex items-center space-x-1">
                                <AlertCircle className="w-3 h-3 text-rose-400" />
                                <span>Rejected by CarbonRoute</span>
                              </span>
                            )}
                          </div>
                          <div className="text-xl font-extrabold text-white">
                            Window {lowWin.windowLabel}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Grid Intensity:</span>
                              <span className="text-white font-bold text-sm">
                                {lowWin.predictedCarbonIntensity}{' '}
                                <span className="text-[10px] font-normal text-slate-400">gCO2eq/kWh</span>
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Est. Workload Emissions:</span>
                              <span className="text-white font-bold text-sm">
                                {lowWin.predictedCarbonImpactGrams}{' '}
                                <span className="text-[10px] font-normal text-slate-400">gCO2eq</span>
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Forecast Uncertainty:</span>
                              <span className="text-slate-300 font-bold text-sm">
                                {lowWin.stdDev === null ? (
                                  'not provided'
                                ) : (
                                  <>
                                    &plusmn;{lowWin.stdDev.toFixed(1)}{' '}
                                    <span className="text-[10px] font-normal text-slate-500">(&sigma;, synthetic)</span>
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Deadline Risk P(viol):</span>
                              <span
                                className={`font-bold text-sm ${
                                  lowWin.deadlineRisk > riskTolerance
                                    ? 'text-rose-400'
                                    : 'text-emerald-400'
                                }`}
                              >
                                {lowWin.deadlineRiskPct}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                          {ri.isLowestCarbonSafe
                            ? 'This window is both the lowest predicted carbon window and complies with the deadline risk constraint.'
                            : `Greedy deterministic schedulers pick this window because ${lowWin.predictedCarbonIntensity} gCO2eq/kWh looks cheapest, but waiting until ${lowWin.windowLabel} leaves near-zero slack margin and escalates deadline failure probability to ${lowWin.deadlineRiskPct}.`}
                        </div>
                      </div>

                      {/* Candidate 2: CarbonRoute Risk-Bounded Selection */}
                      <div className="p-5 rounded-xl bg-slate-950/80 border-2 border-emerald-500/50 space-y-4 flex flex-col justify-between shadow-lg shadow-emerald-950/40 relative">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                              CarbonRoute Safe Dispatch
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold uppercase flex items-center space-x-1">
                              <CheckCircle className="w-3 h-3 text-slate-950" />
                              <span>Recommended Choice</span>
                            </span>
                          </div>
                          <div className="text-xl font-extrabold text-emerald-300">
                            Window {recWin.windowLabel}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-emerald-500/30">
                              <span className="text-slate-500 block text-[10px]">Selected Intensity:</span>
                              <span className="text-emerald-300 font-bold text-sm">
                                {recWin.predictedCarbonIntensity}{' '}
                                <span className="text-[10px] font-normal text-slate-400">gCO2eq/kWh</span>
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-emerald-500/30">
                              <span className="text-slate-500 block text-[10px]">Est. Workload Emissions:</span>
                              <span className="text-white font-bold text-sm">
                                {recWin.predictedCarbonImpactGrams}{' '}
                                <span className="text-[10px] font-normal text-slate-400">gCO2eq</span>
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Deadline Risk P(viol):</span>
                              <span className="text-emerald-400 font-bold text-sm">
                                {recWin.deadlineRiskPct} &le; {(riskTolerance * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800/80">
                              <span className="text-slate-500 block text-[10px]">Carbon Insurance Delta:</span>
                              <span className="text-indigo-300 font-bold text-sm">
                                +{ri.carbonInsurancePenaltyGramsPerKwh}{' '}
                                <span className="text-[10px] font-normal text-slate-400">g/kWh</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-emerald-500/20 text-[11px] text-emerald-200/90 leading-relaxed">
                          {ri.isLowestCarbonSafe
                            ? 'Selected as the mathematically optimal and safe window without requiring any carbon insurance trade-off.'
                            : `CarbonRoute pays an intentional "carbon insurance" premium of +${ri.carbonInsurancePenaltyGramsPerKwh} gCO2eq/kWh (+${carbonDeltaGrams} gCO2eq total) to keep the modelled deadline-miss risk within your tolerance.`}
                        </div>
                      </div>
                    </div>

                    {/* Scientific Takeaway Banner */}
                    <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start space-x-3 text-xs font-mono">
                      <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-slate-200">
                        <span className="font-bold text-indigo-300 block">Scientific Takeaway:</span>
                        <p className="leading-relaxed text-slate-300">
                          {ri.explanation}
                        </p>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* 5 Schedulers Policy Comparison Table */}
          <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white font-mono flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>5-Policy Scheduling Comparison Matrix</span>
              </h3>
              <span className="text-xs font-mono text-slate-500">
                Live evaluation against identical forecast trace
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Policy Name</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Selected Start</th>
                    <th className="p-3">Grid Intensity (gCO2eq/kWh)</th>
                    <th className="p-3">Est. Emissions (gCO2eq)</th>
                    <th className="p-3">Deadline Risk</th>
                    <th className="p-3">Wait Time</th>
                    <th className="p-3">Feasibility</th>
                    <th className="p-3">Overhead</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {decision.evaluatedPolicies.map((pol) => {
                    const isRecommended = pol.policyId === 'carbonroute_uncertainty';
                    return (
                      <tr
                        key={pol.policyId}
                        className={`hover:bg-slate-900/40 transition-colors ${
                          isRecommended ? 'bg-emerald-950/30 font-semibold' : ''
                        }`}
                      >
                        <td className="p-3 text-white flex items-center space-x-2">
                          {isRecommended && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          <span>{pol.policyName}</span>
                        </td>
                        <td className="p-3 text-slate-400">{pol.category}</td>
                        <td className="p-3 text-slate-200">T+{pol.selectedStartHour}:00</td>
                        <td className="p-3 text-emerald-400 font-bold">{pol.predictedCarbonIntensity ?? pol.predictedCarbon} gCO2eq/kWh</td>
                        <td className="p-3 text-slate-300">{pol.estimatedWorkloadEmissionsGrams !== undefined ? `${pol.estimatedWorkloadEmissionsGrams} gCO2eq` : '-'}</td>
                        <td className="p-3">
                          <span
                            className={
                              pol.estimatedDeadlineRisk > riskTolerance
                                ? 'text-rose-400'
                                : 'text-emerald-400'
                            }
                          >
                            {(pol.estimatedDeadlineRisk * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="p-3 text-slate-300">+{pol.waitingTimeHours}h</td>
                        <td className="p-3">
                          {pol.isFeasible ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                              Feasible
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-400 border border-rose-800 font-bold">
                              Rejected
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400">{pol.schedulerOverheadMs} ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* 5. SECTION E: KUBERNETES EXECUTION MONITOR & CONTAINER LOGS */}
      {executionRecord && (
        <section className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  STEP 4 &bull; EXECUTION
                </span>
                <h3 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <span>Kubernetes Workload Execution Monitor</span>
                </h3>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Job ID: <strong className="text-white">{executionRecord.jobId}</strong> &bull; Pod:{' '}
                <strong className="text-slate-300">{executionRecord.podName}</strong>
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider ${
                  executionRecord.status === 'completed'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : executionRecord.status === 'running'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Status: {executionRecord.status}
              </span>
            </div>
          </div>

          {/* Mode Notice Banner */}
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono flex items-start space-x-2.5 text-slate-300">
            <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-white font-bold block">Execution Connector Environment:</span>
              <span className="text-slate-400">{executionRecord.clusterNotice}</span>
            </div>
          </div>

          {/* Lifecycle Stepper */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div
              className={`p-4 rounded-xl border ${
                executionRecord.status === 'scheduled' ||
                executionRecord.status === 'running' ||
                executionRecord.status === 'completed'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-bold mb-1">1. Staged &amp; Scheduled</div>
              <div className="text-[11px] text-slate-400">
                Scheduled Start: {new Date(executionRecord.scheduledStartTime).toLocaleTimeString()}
              </div>
            </div>

            <div
              className={`p-4 rounded-xl border ${
                executionRecord.status === 'running' || executionRecord.status === 'completed'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-bold mb-1">2. Pod Spawned &amp; Running</div>
              <div className="text-[11px] text-slate-400">
                Actual Start:{' '}
                {executionRecord.actualStartTime
                  ? new Date(executionRecord.actualStartTime).toLocaleTimeString()
                  : 'Awaiting container'}
              </div>
            </div>

            <div
              className={`p-4 rounded-xl border ${
                executionRecord.status === 'completed'
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-bold mb-1">3. Workload Completed</div>
              <div className="text-[11px] text-slate-400">
                Exit Code: {executionRecord.exitCode ?? 'Pending'} &bull; Finished:{' '}
                {executionRecord.completionTime
                  ? new Date(executionRecord.completionTime).toLocaleTimeString()
                  : 'In progress'}
              </div>
            </div>
          </div>

          {/* Live Terminal Log Viewer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Container stdout / stderr Logs</span>
              </span>
              <span className="text-[10px] text-slate-500">Live stream</span>
            </div>

            <div
              ref={terminalLogsRef}
              className="w-full h-52 bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-y-auto font-mono text-xs text-emerald-300 space-y-1 select-text"
            >
              {executionRecord.logs.map((line, i) => (
                <div key={i} className="leading-relaxed">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 6. SECTION F: RESULTS DASHBOARD */}
      {executionRecord && executionRecord.status === 'completed' && (
        <section className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
          <div className="pb-4 border-b border-slate-800 space-y-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              STEP 5 &bull; RESULTS
            </span>
            <h3 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <span>Execution, Observed Carbon &amp; Report</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[11px] block">Forecast window intensity</span>
              <div className="text-xl font-bold text-white">{executionRecord.predictedCarbon} gCO2eq/kWh</div>
              <span className="text-[10px] text-slate-500">Forecast at scheduling time (not an observation)</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[11px] block">Execution</span>
              <div className="text-xl font-bold text-white">
                {executionRecord.clusterMode === 'minikube' ? 'Kubernetes' : 'Simulated'}
              </div>
              <span className="text-[10px] text-slate-500">
                {executionRecord.execution?.note || executionRecord.clusterNotice}
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[11px] block">Scheduled window</span>
              <div className="text-sm font-bold text-white">
                {executionRecord.execution
                  ? `${formatLocal(executionRecord.execution.scheduledStartUtc)} → ${formatLocal(executionRecord.execution.scheduledEndUtc)}`
                  : '—'}
              </div>
              <span className="text-[10px] text-slate-500">Carbon is accounted for this window</span>
            </div>
          </div>

          {activeJobId && (
            <CarbonObservationPanel
              jobId={activeJobId}
              forecastPoints={[]}
              result={observations}
              collecting={collecting}
              error={observationError}
              onCollect={handleCollectObservations}
              onDownloadReport={async (format) => {
                const res = await api.downloadReport(activeJobId, format);
                if (!res.success) setObservationError(res.message || 'Report download failed.');
              }}
            />
          )}

          {/* Measurement disclaimer */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 font-mono">
            <span className="text-slate-300 font-semibold">Note on Metrics:</span> Grid carbon intensity is tracked in <code className="text-emerald-400">gCO2eq/kWh</code>. Workload carbon emissions in <code className="text-emerald-400">gCO2eq</code> are modeled estimates derived from scheduled execution duration and estimated hardware power draw; direct physical energy consumption is not claimed as measured unless hardware power meters are instrumented.
          </div>
        </section>
      )}

      {/* 7. SECTION G: KEY FEASIBILITY DEMO (SAME FORECAST, DIFFERENT UNCERTAINTY) */}
      <section className="space-y-4">
        <div className="pb-2 border-b border-slate-800 space-y-1">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-teal-500/10 border border-teal-500/30 text-teal-300 text-xs font-mono">
            <Flame className="w-3.5 h-3.5" />
            <span>Key Research Question Demonstration</span>
          </div>
          <h2 className="text-2xl font-bold text-white font-mono">
            Same Forecast, Different Uncertainty Demonstration
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed font-mono">
            Proves that CarbonRoute does not simply select the lowest predicted carbon window. When forecast uncertainty
            rises, CarbonRoute adapts by choosing an earlier, risk-calibrated start window even when the predicted carbon
            intensity curve is 100% identical.
          </p>
        </div>

        <FeasibilityDemoVisualizer />
      </section>

      {/* 8. Kubernetes Manifest Inspector Modal */}
      {showManifestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-card w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileCode className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white font-mono">
                  Kubernetes batch/v1 Job Manifest
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Ready to Apply
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowManifestModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto font-mono text-xs text-slate-300 space-y-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  Specification: <code>apiVersion: batch/v1</code> &bull; <code>kind: Job</code>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const yamlStr = toYamlString(manifestData);
                    navigator.clipboard.writeText(yamlStr);
                    setManifestCopied(true);
                    setTimeout(() => setManifestCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 flex items-center space-x-1.5"
                >
                  {manifestCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied YAML</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy YAML</span>
                    </>
                  )}
                </button>
              </div>

              {manifestLoading ? (
                <div className="flex items-center justify-center h-48 space-x-2 text-slate-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Generating Kubernetes Manifest...</span>
                </div>
              ) : (
                <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300 text-xs overflow-x-auto leading-relaxed select-text font-mono">
                  {toYamlString(manifestData)}
                </pre>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs font-mono text-slate-400">
              <span>
                Execute with: <code>kubectl apply -f manifest.yaml</code>
              </span>
              <button
                type="button"
                onClick={() => setShowManifestModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
