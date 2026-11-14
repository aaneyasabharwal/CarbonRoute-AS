import {
  ApiResponse,
  Presentation,
  PresentationVersion,
  Resource,
  TeamMember,
  RoadmapMilestone,
  RoadmapTask,
  TaskStatus,
  FeasibilityResult,
  TimeSlotCarbon,
  User,
  WorkloadJob,
  CarbonForecastData,
  SchedulingDecisionResponse,
  K8sJobExecutionRecord,
  ExperimentRecord,
  JobSummary,
  JobDetails,
  OracleEvaluation,
  BenchmarkListItem,
  BenchmarkResultDetail,
  MlEvaluationListItem,
  MlEvaluation,
  ZoneOption,
  ZoneCatalogue,
  JobObservationsResult,
} from '../types';
import { resolveBackendUrl } from '../config/apiUrl';

// P8 (B7): no hard-coded remote backend; see src/config/apiUrl.ts.
export const BACKEND_URL = resolveBackendUrl(
  (import.meta as any).env?.VITE_API_URL as string | undefined,
  typeof window !== 'undefined' ? window.location.hostname : undefined
);
export const API_BASE = `${BACKEND_URL}/api`;

/**
 * Resolves presentation and resource file paths/URLs against the production backend.
 * Ensures consistent handling of relative fileUrl, filePath (e.g. uploads/presentations/...),
 * and standalone fileNames on both Vercel and local environments.
 */
export const resolveFileUrl = (
  fileUrl?: string,
  filePath?: string,
  fileName?: string
): string => {
  const url = (fileUrl || '').trim();
  const path = (filePath || '').trim();
  const name = (fileName || '').trim();

  // If no file reference exists at all
  if (!url && !path && !name) {
    return '';
  }

  // If already an absolute HTTP/HTTPS URL
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  // If fileUrl starts with /api/storage/
  if (url.startsWith('/api/storage/')) {
    return `${BACKEND_URL}${url}`;
  }

  // If filePath starts with uploads/ (standard backend storage relative path)
  if (path.startsWith('uploads/')) {
    const relative = path.replace(/^uploads\//, '');
    return `${BACKEND_URL}/api/storage/${relative}`;
  }

  // If filePath starts with /uploads/
  if (path.startsWith('/uploads/')) {
    const relative = path.replace(/^\/uploads\//, '');
    return `${BACKEND_URL}/api/storage/${relative}`;
  }

  // If fileName is provided (e.g. CarbonRoute_Planning_Presentation_V1.pdf)
  if (name) {
    const cleanName = name.replace(/^(\/|uploads\/presentations\/|uploads\/)/, '');
    return `${BACKEND_URL}/api/storage/presentations/${cleanName}`;
  }

  // If fileUrl is like /CarbonRoute_Planning_Presentation_V1.pdf
  if (url) {
    const cleanUrl = url.replace(/^\//, '');
    return `${BACKEND_URL}/api/storage/presentations/${cleanUrl}`;
  }

  return '';
};

// Helper to normalize presentation version URLs
export const normalizePresentation = (p: PresentationVersion): PresentationVersion => {
  const resolvedUrl = resolveFileUrl(p.fileUrl, p.filePath, p.fileName);
  return {
    ...p,
    fileUrl: resolvedUrl,
  };
};

const DEFAULT_PRESENTATIONS: PresentationVersion[] = [
  {
    id: 'pres-grid-v1',
    title: 'Software Engineering Course Grid & Deliverables Specification',
    deliverableType: 'software_grid',
    versionTag: 'v1',
    description: 'Official Software Engineering UCS503 curriculum project grid and milestone roadmap overview.',
    fileName: 'CarbonRoute_Software_Grid.pdf',
    filePath: 'uploads/presentations/CarbonRoute_Software_Grid.pdf',
    fileSize: 45200,
    mimeType: 'application/pdf',
    fileUrl: `${BACKEND_URL}/api/storage/presentations/CarbonRoute_Software_Grid.pdf`,
    authors: ['Yuvika Nagpal (1024030141)', 'Kumkum Gupta (1024030144)', 'Aaneya Sabharwal (1024030147)'],
    uploaderName: 'Team TriFlux (Batch: 3C15)',
    status: 'published',
    presentationDate: '2026-08-10',
    sha256Checksum: '9a3b1c4e7f8293a01b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a',
    changeSummary: 'Initial course software grid and project proposal scope submission.',
    createdAt: '2026-08-10T10:00:00.000Z',
    publishedAt: '2026-08-10T10:00:00.000Z',
  },
  {
    id: 'pres-planning-v1',
    title: 'CarbonRoute Planning Presentation V1',
    deliverableType: 'planning',
    versionTag: 'v1',
    description: 'UCS503: CarbonRoute — Uncertainty-Aware Carbon-Aware Batch Scheduling. Official 25-slide presentation by Team TriFlux submitted to Sukhpal Singh. Covers problem statement, research gap, scope, target users, system architecture, uncertainty modelling, deadline risk calibration, benchmark scale, Gantt chart milestones and team responsibilities.',
    fileName: 'CarbonRoute_Planning_Presentation_V1.pdf',
    filePath: 'uploads/presentations/CarbonRoute_Planning_Presentation_V1.pdf',
    fileSize: 28033,
    mimeType: 'application/pdf',
    fileUrl: `${BACKEND_URL}/api/storage/presentations/CarbonRoute_Planning_Presentation_V1.pdf`,
    authors: ['Yuvika Nagpal (1024030141)', 'Kumkum Gupta (1024030144)', 'Aaneya Sabharwal (1024030147)'],
    uploaderName: 'Team TriFlux (Batch: 3C15)',
    status: 'published',
    presentationDate: '17 August 2026',
    sha256Checksum: '8e4f1a239c8914bca99281a8f94d0752119ef58a2d12e9b01c34a17d8900bb21',
    changeSummary: 'Official 25-slide Planning Presentation V1 submitted to instructor Sukhpal Singh.',
    createdAt: '2026-08-17T10:00:00.000Z',
    publishedAt: '2026-08-17T10:00:00.000Z',
  },
];

const DEFAULT_TEAM: TeamMember[] = [
  {
    id: 'team-1',
    name: 'Yuvika Nagpal',
    role: 'Backend & System Integration',
    bio: 'Worked on backend development, live Electricity Maps API integration, carbon-data flow, frontend-backend integration, and integration of the major system components.',
    avatarUrl: '',
    displayOrder: 1,
  },
  {
    id: 'team-2',
    name: 'Aaneya Sabharwal',
    role: 'Frontend & User Interface',
    bio: 'Worked on frontend development, workload input interface, and carbon forecast and scheduling result visualization.',
    avatarUrl: '',
    displayOrder: 2,
  },
  {
    id: 'team-3',
    name: 'Kumkum Gupta',
    role: 'Scheduling & Uncertainty Analysis',
    bio: 'Worked on scheduling policies, candidate execution-window evaluation, uncertainty analysis, deadline-violation risk, and policy comparison.',
    avatarUrl: '',
    displayOrder: 3,
  },
];

const DEFAULT_ROADMAP: RoadmapMilestone[] = [
  {
    id: 'w1-2',
    displayOrder: 1,
    phaseNumber: 1,
    weekRange: 'WEEKS 1–2',
    title: 'Requirements, research and initial simulator prototype',
    description: 'Problem formulation, literature review, carbon intensity data ingestion specification, baseline simulator architecture, and website deployment.',
    deliverables: ['Planning Presentation V1', 'Project Portal Deployment', 'Initial Simulator Spec'],
    status: 'in-progress',
    tasks: [
      {
        id: 'task-w1-2-1',
        phaseId: 'w1-2',
        title: 'Problem formulation and mathematical carbon intensity model',
        description: 'Literature review, mathematical model of carbon intensity and forecast error variance growth over time.',
        status: 'completed',
        completedAt: '2026-08-15',
        completedBy: 'Yuvika Nagpal',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w1-2-2',
        phaseId: 'w1-2',
        title: 'Literature review on forecast uncertainty and workload shifting',
        description: 'Evaluate reference scheduling policies and document academic gap for deadline risk calibration.',
        status: 'completed',
        completedAt: '2026-08-16',
        completedBy: 'Kumkum Gupta',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w1-2-3',
        phaseId: 'w1-2',
        title: 'Project portal and continuous deployment setup',
        description: 'Deploy responsive CarbonRoute web portal for continuous semester tracking across devices.',
        status: 'completed',
        completedAt: '2026-08-17',
        completedBy: 'Aaneya Sabharwal',
        assignedTo: 'Aaneya Sabharwal',
      },
      {
        id: 'task-w1-2-4',
        phaseId: 'w1-2',
        title: 'Initial simulator prototype architecture specification',
        description: 'Draft mathematical formulation, discrete-event queue architecture, and trace interface spec.',
        status: 'in-progress',
        completedAt: null,
        completedBy: null,
        assignedTo: 'Yuvika Nagpal',
      },
    ],
  },
  {
    id: 'w3-4',
    displayOrder: 2,
    phaseNumber: 2,
    weekRange: 'WEEKS 3–4',
    title: 'Simulator models and workload generation',
    description: 'Development of discrete-event simulator core, multi-region cloud capacity and pricing models, and synthetic batch workload generators (short, medium, long jobs).',
    deliverables: ['Discrete-Event Simulator Core', 'Workload Generator Trace Engine'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w3-4-1',
        phaseId: 'w3-4',
        title: 'Discrete-event simulator core event loop',
        description: 'Build discrete-event simulation engine with job queues, regional clocks, and execution events.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w3-4-2',
        phaseId: 'w3-4',
        title: 'Multi-region cloud capacity and pricing models',
        description: 'Model spot and on-demand regional capacity constraints with dynamic pricing curves.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w3-4-3',
        phaseId: 'w3-4',
        title: 'Synthetic batch workload generators (short, medium, long jobs)',
        description: 'Generate synthetic batch workload traces with variable arrival rates, execution times, and resource profiles.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
    ],
  },
  {
    id: 'w5-6',
    displayOrder: 3,
    phaseNumber: 3,
    weekRange: 'WEEKS 5–6',
    title: 'Baseline scheduling policies',
    description: 'Implementation of reference scheduling policies: Immediate Execution, Earliest Deadline First (EDF), Cost-Aware Scheduler, and Realized-Data Oracle reference solver.',
    deliverables: ['Baseline Suite', 'Oracle Upper-Bound Reference Solver'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w5-6-1',
        phaseId: 'w5-6',
        title: 'Immediate Execution baseline scheduler',
        description: 'Implement baseline heuristic executing arriving batch jobs immediately without temporal shifting.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w5-6-2',
        phaseId: 'w5-6',
        title: 'Earliest Deadline First (EDF) scheduler',
        description: 'Implement priority-queue reference policy sorting workloads strictly by deadline urgency.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w5-6-3',
        phaseId: 'w5-6',
        title: 'Cost-Aware scheduling algorithm',
        description: 'Implement price-minimizing reference scheduler exploiting diurnal spot price arbitrage.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w5-6-4',
        phaseId: 'w5-6',
        title: 'Realized-Data Oracle upper-bound solver',
        description: 'Reference mathematical benchmark with omniscient knowledge of ground-truth future carbon realizations.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
    ],
  },
  {
    id: 'w7-8',
    displayOrder: 4,
    phaseNumber: 4,
    weekRange: 'WEEKS 7–8',
    title: 'Carbon-aware scheduler',
    description: 'Implementation of deterministic carbon-aware scheduling algorithms and heuristic multi-region workload shifting strategies.',
    deliverables: ['Deterministic Carbon Scheduler', 'Trace Alignment Module'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w7-8-1',
        phaseId: 'w7-8',
        title: 'Deterministic carbon-aware scheduling algorithm',
        description: 'Implement carbon intensity window optimizer minimizing total gCO2 under deterministic point forecasts.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w7-8-2',
        phaseId: 'w7-8',
        title: 'Multi-region spatial workload shifting strategies',
        description: 'Heuristic cross-region migration module shifting jobs to cleaner geographic grid zones.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w7-8-3',
        phaseId: 'w7-8',
        title: 'Trace alignment and grid intensity ingestion parser',
        description: 'Ingest and standardize 5-minute carbon intensity traces across multiple grid operators.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
    ],
  },
  {
    id: 'w9-10',
    displayOrder: 5,
    phaseNumber: 5,
    weekRange: 'WEEKS 9–10',
    title: 'Forecast uncertainty and error modelling',
    description: 'Parametric and empirical forecast error distribution modeling across 1h to 48h look-ahead horizons to capture variance growth over time.',
    deliverables: ['Forecast Error Engine', 'Multi-Horizon Error Distribution Models'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w9-10-1',
        phaseId: 'w9-10',
        title: 'Forecast uncertainty and error modelling engine',
        description: 'Model forecast error distributions across 1h to 48h look-ahead horizons capturing variance growth.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w9-10-2',
        phaseId: 'w9-10',
        title: 'Empirical multi-horizon error distribution models',
        description: 'Fit parametric and empirical error distributions against historical day-ahead forecast vs actuals.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
    ],
  },
  {
    id: 'w11-12',
    displayOrder: 6,
    phaseNumber: 6,
    weekRange: 'WEEKS 11–12',
    title: 'Uncertainty-aware scheduler and deadline-risk calibration',
    description: 'Core CarbonRoute scheduling algorithm enforcing P(deadline violation | decision) <= tau, combined with Brier score calibration and Reliability Diagrams.',
    deliverables: ['CarbonRoute Uncertainty Scheduler', 'Risk Calibration Module (Brier/ECE)'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w11-12-1',
        phaseId: 'w11-12',
        title: 'Uncertainty-aware scheduler enforcing P(violation) <= tau',
        description: 'Core CarbonRoute scheduling algorithm optimizing carbon while bounding deadline violation risk.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w11-12-2',
        phaseId: 'w11-12',
        title: 'Deadline-risk calibration module (Brier Score & Reliability Diagrams)',
        description: 'Probability calibration measuring Brier score and Reliability Diagrams to ensure sharpness.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w11-12-3',
        phaseId: 'w11-12',
        title: 'Expected Calibration Error (ECE) metric calculator',
        description: 'Quantify miscalibration across probability bins to prevent overconfident delay decisions.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
    ],
  },
  {
    id: 'w13',
    displayOrder: 7,
    phaseNumber: 7,
    weekRange: 'WEEK 13',
    title: 'Stress testing',
    description: 'Systematic stress testing against sudden renewable drop-offs, cloud capacity contention, flash price spikes, and severe forecast skew.',
    deliverables: ['Stress-Testing Matrix', 'Degradation & Robustness Analysis'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w13-1',
        phaseId: 'w13',
        title: 'Renewable drop-off stress testing scenarios',
        description: 'Subject scheduling policies to severe solar/wind drop-offs and test fallback behaviors.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w13-2',
        phaseId: 'w13',
        title: 'Cloud capacity contention and spot preemption tests',
        description: 'Simulate regional compute saturation and evaluate deadline recovery effectiveness.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
    ],
  },
  {
    id: 'w14',
    displayOrder: 8,
    phaseNumber: 8,
    weekRange: 'WEEK 14',
    title: 'API and dashboard integration',
    description: 'FastAPI REST endpoint exposure for scheduling decisions and interactive web dashboard integration for visualizing schedules and risk curves.',
    deliverables: ['FastAPI Endpoints', 'Interactive Scheduling Dashboard'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w14-1',
        phaseId: 'w14',
        title: 'FastAPI REST decision endpoints exposure',
        description: 'Expose REST endpoints for submitting batch workloads and retrieving scheduling decisions.',
        status: 'planned',
        assignedTo: 'Aaneya Sabharwal',
      },
      {
        id: 'task-w14-2',
        phaseId: 'w14',
        title: 'Interactive scheduling dashboard and risk curve visualizer',
        description: 'Web dashboard integration for visualizing schedules, tail risk bounds, and regional curves.',
        status: 'planned',
        assignedTo: 'Aaneya Sabharwal',
      },
    ],
  },
  {
    id: 'w15',
    displayOrder: 9,
    phaseNumber: 9,
    weekRange: 'WEEK 15',
    title: 'Large-scale repeated experiments and benchmark',
    description: 'Execution of multi-seed, multi-region reproducible benchmark suite across varying forecast error levels, producing paired statistical evaluations.',
    deliverables: ['Reproducible Benchmark Bundle', 'Statistical Significance Tests'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w15-1',
        phaseId: 'w15',
        title: 'Large-scale repeated benchmark suite execution',
        description: 'Run automated repeated multi-seed evaluations across multiple grid regions and error profiles.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w15-2',
        phaseId: 'w15',
        title: 'Paired statistical significance tests',
        description: 'Compute Student t-tests and Wilcoxon signed-rank tests confirming CarbonRoute advantages.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
    ],
  },
  {
    id: 'w16',
    displayOrder: 10,
    phaseNumber: 10,
    weekRange: 'WEEK 16',
    title: 'Containerized workload connector, testing and deployment',
    description: 'Integration of container execution connector dispatching scheduled batch jobs to Kubernetes Jobs with explanation summaries.',
    deliverables: ['Kubernetes Workload Connector', 'End-to-End Container Runner'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w16-1',
        phaseId: 'w16',
        title: 'Containerized Kubernetes Job workload connector',
        description: 'Integrate connector dispatching scheduled batch jobs to Kubernetes Jobs with telemetry.',
        status: 'planned',
        assignedTo: 'Aaneya Sabharwal',
      },
      {
        id: 'task-w16-2',
        phaseId: 'w16',
        title: 'End-to-end containerized runner verification',
        description: 'Smoke test end-to-end container execution, completion polling, and emission accounting.',
        status: 'planned',
        assignedTo: 'Aaneya Sabharwal',
      },
    ],
  },
  {
    id: 'w17',
    displayOrder: 11,
    phaseNumber: 11,
    weekRange: 'WEEK 17',
    title: 'Final integration, evaluation, documentation and presentation',
    description: 'Comprehensive project evaluation, final documentation, open-source repository packaging, and university semester defense presentation.',
    deliverables: ['Final Project Thesis / Report', 'Final Presentation V1', 'Release Artifact'],
    status: 'planned',
    tasks: [
      {
        id: 'task-w17-1',
        phaseId: 'w17',
        title: 'Final project thesis and comprehensive technical documentation',
        description: 'Complete final project report, architectural diagrams, empirical analysis, and defense thesis.',
        status: 'planned',
        assignedTo: 'Yuvika Nagpal',
      },
      {
        id: 'task-w17-2',
        phaseId: 'w17',
        title: 'University semester defense presentation and demo',
        description: 'Deliver final semester viva defense presentation with live interactive demonstration.',
        status: 'planned',
        assignedTo: 'Kumkum Gupta',
      },
      {
        id: 'task-w17-3',
        phaseId: 'w17',
        title: 'Release artifact packaging and open-source publication',
        description: 'Publish final GitHub repository with documentation, reproduction scripts, and MIT license.',
        status: 'planned',
        assignedTo: 'Aaneya Sabharwal',
      },
    ],
  },
];

const getHeaders = (isFormData: boolean = false): HeadersInit => {
  const token = localStorage.getItem('carbonroute_token');
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/** Message shown when a job request is not authenticated (M1.2). */
export const SIGN_IN_REQUIRED_MESSAGE =
  'Sign in to schedule and inspect jobs: jobs belong to the account that created them.';

/**
 * Handles a 401 from a protected route: a stored token that the backend rejected (expired,
 * revoked or signed with an old secret) is removed, and the caller is told to sign in.
 */
/** Message when live (Electricity Maps) data is requested without signing in (P0/F9). */
export const LIVE_DATA_SIGN_IN_MESSAGE =
  'Sign in to use live Electricity Maps data (it uses a limited API quota). Demo mode works without signing in.';

function authFailure(
  res: Response,
  json: any,
  fallbackMessage: string = SIGN_IN_REQUIRED_MESSAGE
): { success: false; message: string; authRequired: true } {
  if (localStorage.getItem('carbonroute_token')) localStorage.removeItem('carbonroute_token');
  return {
    success: false,
    authRequired: true,
    message: res.status === 401 && json?.message && json?.code === 'UNAUTHENTICATED' && !/^Authentication required/.test(json.message)
      ? json.message
      : fallbackMessage,
  };
}

/** GET with the sign-in token; 401 becomes a sign-in prompt; failures are returned, never replaced. */
async function authedGet<T>(url: string, failText: string): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, { headers: getHeaders() });
    const json = await res.json().catch(() => null);
    if (res.status === 401) return authFailure(res, json);
    if (res.ok && json?.success) return json;
    return { success: false, message: json?.message || `${failText} (${res.status})` };
  } catch (err: any) {
    return { success: false, message: err?.message || `${failText}: the backend is not reachable.` };
  }
}

export const api = {
  /** True when a sign-in token is stored (it may still be rejected if it has expired). */
  hasSession(): boolean {
    return Boolean(localStorage.getItem('carbonroute_token'));
  },

  // Auth
  async login(username: string, password: string): Promise<ApiResponse<{ token: string; user: User }>> {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success && json.token) {
        localStorage.setItem('carbonroute_token', json.token);
        return json;
      }
      return {
        success: false,
        message: json?.message || `Authentication failed (HTTP ${res.status}: ${res.statusText})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Unable to connect to the backend authentication server.',
      };
    }
  },

  async getMe(): Promise<ApiResponse<User>> {
    const token = localStorage.getItem('carbonroute_token');
    if (!token) {
      return { success: false, message: 'No authentication token found.' };
    }

    try {
      const res = await fetch(`${API_BASE}/auth/me`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success && json.user) {
        return {
          success: true,
          user: json.user,
          data: json.user,
        };
      }
    } catch {}

    localStorage.removeItem('carbonroute_token');
    return { success: false, message: 'Session expired. Please log in again.' };
  },

  async logout(): Promise<ApiResponse<void>> {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: getHeaders() });
    } catch {}
    localStorage.removeItem('carbonroute_token');
    return { success: true };
  },

  // Presentations
  async getPresentations(): Promise<ApiResponse<Presentation[]>> {
    try {
      const res = await fetch(`${API_BASE}/presentations`, { headers: getHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return {
            ...json,
            data: json.data.map(normalizePresentation),
          };
        }
      }
    } catch (err) {
      console.error('Failed to fetch presentations from backend:', err);
    }
    return { success: true, data: DEFAULT_PRESENTATIONS.map(normalizePresentation) };
  },

  async getAllVersions(): Promise<ApiResponse<PresentationVersion[]>> {
    try {
      const res = await fetch(`${API_BASE}/presentations/versions`, { headers: getHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return {
            ...json,
            data: json.data.map(normalizePresentation),
          };
        }
      }
    } catch (err) {
      console.error('Failed to fetch presentation versions from backend:', err);
    }
    return { success: true, data: DEFAULT_PRESENTATIONS.map(normalizePresentation) };
  },

  async getPresentationByVersion(versionTag: string): Promise<ApiResponse<PresentationVersion>> {
    try {
      const res = await fetch(`${API_BASE}/presentations/v/${encodeURIComponent(versionTag)}`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          return {
            ...json,
            data: normalizePresentation(json.data),
          };
        }
      }
    } catch (err) {
      console.error(`Failed to fetch presentation version "${versionTag}" from backend:`, err);
    }

    const found =
      DEFAULT_PRESENTATIONS.find((p) => p.versionTag.toLowerCase() === versionTag.toLowerCase()) ||
      DEFAULT_PRESENTATIONS[1];
    return { success: true, data: normalizePresentation(found) };
  },

  async uploadPresentationVersion(formData: FormData): Promise<ApiResponse<PresentationVersion>> {
    try {
      const res = await fetch(`${API_BASE}/presentations/upload`, {
        method: 'POST',
        headers: getHeaders(true),
        body: formData,
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success && json.data) {
        return {
          ...json,
          data: normalizePresentation(json.data),
        };
      }
      return {
        success: false,
        message: json?.message || `Server upload failed (HTTP ${res.status}: ${res.statusText})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async updatePresentationVersion(
    id: string,
    updates: Partial<PresentationVersion>
  ): Promise<ApiResponse<PresentationVersion>> {
    try {
      const res = await fetch(`${API_BASE}/presentations/versions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success && json.data) {
        return {
          ...json,
          data: normalizePresentation(json.data),
        };
      }
      return {
        success: false,
        message: json?.message || `Failed to update presentation (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async deletePresentationVersion(id: string): Promise<ApiResponse<void>> {
    try {
      const res = await fetch(`${API_BASE}/presentations/versions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to delete presentation (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  // Resources
  async getResources(category?: string): Promise<ApiResponse<Resource[]>> {
    try {
      const query = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : '';
      const res = await fetch(`${API_BASE}/resources${query}`, { headers: getHeaders() });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.success && Array.isArray(json.data)) {
          const apiItems: Resource[] = json.data.map((r: Resource) => ({
            ...r,
            fileUrl: resolveFileUrl(r.fileUrl, r.filePath, r.fileName),
          }));
          return {
            success: true,
            data: apiItems,
          };
        }
      }
      return { success: true, data: [] };
    } catch (err: any) {
      console.warn('Could not fetch resources from backend:', err?.message);
      return { success: true, data: [] };
    }
  },

  async getAllResourcesAdmin(): Promise<ApiResponse<Resource[]>> {
    try {
      const res = await fetch(`${API_BASE}/resources/all`, { headers: getHeaders() });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && json.success && Array.isArray(json.data)) {
          return {
            ...json,
            data: json.data.map((r: Resource) => ({
              ...r,
              fileUrl: resolveFileUrl(r.fileUrl, r.filePath, r.fileName),
            })),
          };
        }
      }
    } catch {}
    return { success: true, data: [] };
  },

  async uploadResource(formData: FormData): Promise<ApiResponse<Resource>> {
    try {
      const res = await fetch(`${API_BASE}/resources/upload`, {
        method: 'POST',
        headers: getHeaders(true),
        body: formData,
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Upload failed (HTTP ${res.status}: ${res.statusText})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error uploading deliverable.',
      };
    }
  },

  async updateResource(id: string, updates: Partial<Resource>): Promise<ApiResponse<Resource>> {
    try {
      const res = await fetch(`${API_BASE}/resources/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to update resource (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error updating resource.',
      };
    }
  },

  async deleteResource(id: string): Promise<ApiResponse<void>> {
    try {
      const res = await fetch(`${API_BASE}/resources/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to delete resource (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error deleting deliverable.',
      };
    }
  },

  // Team
  async getTeam(): Promise<ApiResponse<TeamMember[]>> {
    try {
      const res = await fetch(`${API_BASE}/team`, { headers: getHeaders() });
      if (res.ok) return await res.json();
    } catch {}
    return { success: true, data: DEFAULT_TEAM };
  },

  async updateTeamMember(id: string, updates: Partial<TeamMember>): Promise<ApiResponse<TeamMember>> {
    return { success: true, data: { ...DEFAULT_TEAM[0], ...updates } };
  },

  // Roadmap
  async getRoadmap(): Promise<ApiResponse<RoadmapMilestone[]>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap`, { headers: getHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          return json;
        }
      }
    } catch (err: any) {
      console.warn('Could not fetch roadmap from backend, using fallback:', err?.message);
    }
    return { success: true, data: DEFAULT_ROADMAP };
  },

  async updateRoadmapTask(
    taskId: string,
    updates: Partial<RoadmapTask>
  ): Promise<ApiResponse<{ task: RoadmapTask; milestone: RoadmapMilestone }>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to update task (HTTP ${res.status}: ${res.statusText})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async markRoadmapTaskCompleted(
    taskId: string,
    payload?: { completedBy?: string; completionDate?: string }
  ): Promise<ApiResponse<{ task: RoadmapTask; milestone: RoadmapMilestone }>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to mark task as completed (HTTP ${res.status}: ${res.statusText})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async createRoadmapTask(
    phaseId: string,
    taskData: Partial<RoadmapTask>
  ): Promise<ApiResponse<{ task: RoadmapTask; milestone: RoadmapMilestone }>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap/phases/${encodeURIComponent(phaseId)}/tasks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(taskData),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to create task (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async deleteRoadmapTask(taskId: string): Promise<ApiResponse<void>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to delete task (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  async updateRoadmapMilestone(id: string, updates: Partial<RoadmapMilestone>): Promise<ApiResponse<RoadmapMilestone>> {
    try {
      const res = await fetch(`${API_BASE}/roadmap/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) {
        return json;
      }
      return {
        success: false,
        message: json?.message || `Failed to update milestone (HTTP ${res.status})`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Network error connecting to backend API.',
      };
    }
  },

  // Feasibility Simulation API
  async simulateFeasibility(
    durationHours: number,
    deadlineHours: number,
    riskTolerance: number,
    region?: string
  ): Promise<ApiResponse<FeasibilityResult>> {
    // M2.5 (audit H4): no client-side result is generated. If the backend cannot answer, the
    // demonstration reports that instead of showing numbers that were never computed.
    try {
      const res = await fetch(`${API_BASE}/scheduler/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationHours, deadlineHours, riskTolerance, region }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) return json;
      return { success: false, message: json?.message || `Feasibility demonstration failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'The feasibility demonstration needs the backend, which is not reachable.' };
    }
  },

  // Prototype & Scheduling Methods
  async submitJob(jobData: Partial<WorkloadJob>): Promise<ApiResponse<WorkloadJob>> {
    try {
      const res = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(jobData),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Job submission failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error submitting job.' };
    }
  },

  async scheduleJob(payload: {
    jobId?: string;
    jobData?: Partial<WorkloadJob>;
    region?: string;
    uncertaintyMultiplier?: number;
    /** Declared runtime coefficient of variation, 0-1 (0 = deterministic). */
    runtimeCv?: number;
    mode?: 'live' | 'demo';
    dataSource?: 'live' | 'demo';
  }): Promise<ApiResponse<SchedulingDecisionResponse>> {
    try {
      const res = await fetch(`${API_BASE}/schedule`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          ...payload,
          mode: payload.mode || payload.dataSource || 'live',
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Scheduling failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error executing scheduler.' };
    }
  },

  async dispatchJob(
    jobId: string,
    payload?: { predictedCarbon?: number; simulatedDurationSec?: number }
  ): Promise<ApiResponse<K8sJobExecutionRecord>> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/dispatch`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload || {}),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Dispatch failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error dispatching workload.' };
    }
  },

  async getJobStatus(jobId: string): Promise<ApiResponse<K8sJobExecutionRecord>> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/status`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Status check failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching job status.' };
    }
  },

  async getJobResults(jobId: string): Promise<ApiResponse<K8sJobExecutionRecord>> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/results`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Results query failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching job results.' };
    }
  },

  async getJobManifest(jobId: string, hour?: number): Promise<ApiResponse<any>> {
    try {
      const q = hour !== undefined ? `?hour=${encodeURIComponent(hour)}` : '';
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/manifest${q}`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Manifest query failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching job manifest.' };
    }
  },

  async getCarbonForecast(region?: string, mode: 'live' | 'demo' = 'live'): Promise<ApiResponse<CarbonForecastData>> {
    try {
      const params = new URLSearchParams();
      if (region) params.set('region', region);
      if (mode) params.set('mode', mode);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      // Live data needs sign-in (it spends the provider quota); demo data is public.
      const res = await fetch(`${API_BASE}/carbon/forecast${queryStr}`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json, LIVE_DATA_SIGN_IN_MESSAGE);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Carbon forecast query failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching carbon forecast.' };
    }
  },

  /**
   * Live mode: every zone the backend's Electricity Maps key can access.
   * Demo mode: the built-in synthetic profiles. A failure is returned as a failure.
   */
  /** P11: the global zone catalogue (static, public; every provider zone with availability levels). */
  async getZoneCatalogue(): Promise<ApiResponse<ZoneCatalogue>> {
    try {
      const res = await fetch(`${API_BASE}/carbon/catalogue`);
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Zone catalogue unavailable (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error loading the zone catalogue.' };
    }
  },

  async getCarbonRegions(mode: 'live' | 'demo' = 'live'): Promise<ApiResponse<ZoneOption[]> & { source?: string }> {
    try {
      const res = await fetch(`${API_BASE}/carbon/regions${mode === 'demo' ? '?mode=demo' : ''}`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json, LIVE_DATA_SIGN_IN_MESSAGE);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Regions query failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching regions.' };
    }
  },

  /** Collects provider observations for the job's scheduled window (never invented). */
  async collectObservations(jobId: string): Promise<ApiResponse<JobObservationsResult>> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/observations`, { method: 'POST', headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Observation collection failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error collecting observations.' };
    }
  },

  /**
   * Downloads the job report (self-contained HTML or JSON). Reports are only available to the
   * job's owner and administrators, so the request carries the sign-in token; a plain link
   * cannot send it (M1.2).
   */
  async downloadReport(jobId: string, format: 'json' | 'html' = 'html'): Promise<ApiResponse<void>> {
    try {
      const res = await fetch(
        `${API_BASE}/jobs/${encodeURIComponent(jobId)}/report${format === 'html' ? '?format=html' : ''}`,
        { headers: getHeaders() }
      );
      if (res.status === 401) return authFailure(res, await res.json().catch(() => null));
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        return { success: false, message: json?.message || `Report download failed (${res.status})` };
      }
      const blob = format === 'html' ? await res.blob() : new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
      const safeId = jobId.replace(/[^a-zA-Z0-9-]/g, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `carbonroute-report-${safeId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error downloading the report.' };
    }
  },

  async getClusterHealth(): Promise<ApiResponse<{ isAvailable: boolean; message: string }>> {
    try {
      const res = await fetch(`${API_BASE}/cluster/health`);
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Cluster health check failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error checking cluster health.' };
    }
  },

  /**
   * P8: change the signed-in user's password. Every older token stops working on the server; the new
   * token returned here replaces the stored one so this device stays signed in.
   * A wrong current password answers 401 but does NOT end the session (it is not an auth failure).
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<void>> {
    try {
      const res = await fetch(`${API_BASE}/auth/password`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ currentPassword, newPassword }) });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success && json.token) {
        localStorage.setItem('carbonroute_token', json.token);
        return { success: true, message: json.message };
      }
      if (res.status === 401 && json?.code === 'UNAUTHENTICATED') return authFailure(res, json, 'Your session has ended. Sign in again.');
      return { success: false, message: json?.message || `Password change failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error changing the password.' };
    }
  },

  /** P8, administrators: accounts (never password hashes). */
  async listUsers(): Promise<ApiResponse<User[]>> {
    return authedGet<User[]>(`${API_BASE}/admin/users`, 'Could not load accounts');
  },

  /** P8, administrators: create an account. Validation messages come from the backend. */
  async createUser(input: { username: string; email: string; password: string; role: string }): Promise<ApiResponse<User>> {
    try {
      const res = await fetch(`${API_BASE}/admin/users`, { method: 'POST', headers: getHeaders(), body: JSON.stringify(input) });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json?.success) return json;
      return { success: false, message: json?.message || `Could not create the account (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error creating the account.' };
    }
  },

  /** Public provider status: whether live data is configured and the server's call budget (no secrets). */
  async getProviderStatus(): Promise<ApiResponse<{ configured: boolean; historyWindowHours: number; pastRangeAvailable: boolean; callBudget?: { lastHour: number; lastDay: number; maxPerHour: number; maxPerDay: number } }>> {
    try {
      const res = await fetch(`${API_BASE}/carbon/provider`);
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Provider status failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error loading provider status.' };
    }
  },

  async recordExperiment(expData: any): Promise<ApiResponse<ExperimentRecord>> {
    try {
      const res = await fetch(`${API_BASE}/experiments`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(expData),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Failed to record experiment (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error recording experiment.' };
    }
  },

  // ---- P4: job management and results (backend data only; no fallbacks) ----

  /** Signed-in user's jobs (administrators: all). Optional status filter. */
  async listJobs(filters: { status?: string } = {}): Promise<ApiResponse<JobSummary[]>> {
    const q = filters.status ? `?status=${encodeURIComponent(filters.status)}` : '';
    return authedGet<JobSummary[]>(`${API_BASE}/jobs${q}`, 'Could not load jobs');
  },

  async getJobDetails(jobId: string): Promise<ApiResponse<JobDetails>> {
    return authedGet<JobDetails>(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, 'Could not load the job');
  },

  async cancelJob(jobId: string): Promise<ApiResponse<JobSummary>> {
    try {
      const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json?.success) return json;
      return { success: false, message: json?.message || `Cancel failed (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error cancelling the job.' };
    }
  },

  /** Hindsight (Oracle) evaluation: offline only, never a scheduling decision. */
  async getJobOracle(jobId: string): Promise<ApiResponse<OracleEvaluation>> {
    return authedGet<OracleEvaluation>(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/oracle`, 'Could not load the hindsight evaluation');
  },

  async listBenchmarks(): Promise<ApiResponse<BenchmarkListItem[]>> {
    return authedGet<BenchmarkListItem[]>(`${API_BASE}/results/benchmarks`, 'Could not load benchmark results');
  },

  async listMlEvaluations(): Promise<ApiResponse<MlEvaluationListItem[]>> {
    return authedGet<MlEvaluationListItem[]>(`${API_BASE}/results/ml`, 'Could not load model evaluations');
  },

  async getMlEvaluation(id: string): Promise<ApiResponse<MlEvaluation>> {
    return authedGet<MlEvaluation>(`${API_BASE}/results/ml/${encodeURIComponent(id)}`, 'Could not load the model evaluation');
  },

  async getBenchmark(id: string): Promise<ApiResponse<BenchmarkResultDetail>> {
    return authedGet<BenchmarkResultDetail>(`${API_BASE}/results/benchmarks/${encodeURIComponent(id)}`, 'Could not load the benchmark result');
  },

  async getExperiments(): Promise<ApiResponse<ExperimentRecord[]>> {
    try {
      const res = await fetch(`${API_BASE}/experiments`, { headers: getHeaders() });
      const json = await res.json().catch(() => null);
      if (res.status === 401) return authFailure(res, json);
      if (res.ok && json && json.success) return json;
      return { success: false, message: json?.message || `Failed to fetch experiments (${res.status})` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error fetching experiments.' };
    }
  },
};
