export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'student' | 'evaluator';
}

export type DeliverableType = 'software_grid' | 'planning' | 'midterm' | 'final' | 'other';
export type PresentationStatus = 'published' | 'draft' | 'archived';

export interface PresentationItem {
  id: string;
  title: string;
  deliverableType: DeliverableType;
  versionTag: string; // 'v1', 'v2', etc.
  description: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  authors: string[];
  uploaderName: string;
  status: PresentationStatus;
  presentationDate: string;
  sha256Checksum: string;
  changeSummary: string;
  previousVersionId?: string;
  createdAt: string;
  publishedAt?: string;
  allVersions?: {
    id: string;
    versionTag: string;
    title: string;
    presentationDate: string;
    changeSummary: string;
    status: PresentationStatus;
    createdAt: string;
  }[];
}

// Aliases for compatibility
export type Presentation = PresentationItem;
export type PresentationVersion = PresentationItem;

export interface Resource {
  id: string;
  title: string;
  category: string;
  description: string;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  fileUrl?: string;
  isPublished?: boolean;
  createdAt?: string;
  type?: string;
  format?: string;
  date?: string;
  version?: string;
  actionType?: 'view' | 'download' | 'external';
  isExternal?: boolean;
  badge?: string;
  authors?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatarUrl: string;
  githubUrl?: string;
  linkedinUrl?: string;
  displayOrder: number;
}

export type TaskStatus = 'planned' | 'in-progress' | 'completed' | 'blocked';

export interface RoadmapTask {
  id: string;
  phaseId: string;
  title: string;
  description: string;
  status: TaskStatus;
  completedAt?: string | null;
  completedBy?: string | null;
  assignedTo?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface RoadmapMilestone {
  id: string;
  phaseNumber?: number;
  phaseName?: string;
  weekRange?: string;
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'planned';
  dependencies?: string[];
  deliverables: string[];
  tasks?: RoadmapTask[];
  startDate?: string;
  targetDate?: string;
  displayOrder: number;
}

export interface TimeSlotCarbon {
  hour: number;
  predictedCarbon: number;
  uncertaintyLow: { stdDev: number; violationRisk: number };
  uncertaintyHigh: { stdDev: number; violationRisk: number };
}

export interface FeasibilityScenario {
  name: string;
  predictedCarbonCurve: string;
  uncertaintyLevel: string;
  selectedStartHour: number;
  selectedWindow: string;
  /** null when the scenario has no feasible window (no fallback is invented). */
  predictedCarbonAtStart: number | null;
  estimatedViolationRisk: number | null;
  riskToleranceSatisfied: boolean;
  decisionRationale: string;
}

export interface FeasibilityResult {
  input: {
    durationHours: number;
    deadlineHours: number;
    riskTolerance: number;
    region?: string;
  };
  timeSlots: TimeSlotCarbon[];
  scenarios: {
    scenarioA: FeasibilityScenario;
    scenarioB: FeasibilityScenario;
  };
  feasibilityConclusion: string;
}

// ==========================================
// Prototype & Scheduling Types
// ==========================================
export interface WorkloadJob {
  id: string;
  name: string;
  commandOrImage: string;
  isContainerImage: boolean;
  durationHours: number;
  deadlineHours: number;
  arrivalHour: number;
  cpu: number;
  memoryMb: number;
  region: string;
  riskTolerance: number; // tau
  status?: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';
  createdAt: string;
}

export interface HourlyCarbonPoint {
  hour: number;
  timestamp: string;
  predictedCarbon: number;
  /** Forecast uncertainty; null when the provider supplies none (Electricity Maps). */
  stdDev: number | null;
}

export interface ForecastSnapshot {
  provider: string;
  dataClass: 'real' | 'synthetic';
  zone: string;
  issuedAt: string | null;
  fetchedAt: string;
  horizonHours: number;
  granularity: string;
  emissionFactorType: string;
  unit: string;
  points: { datetime: string; carbonIntensity: number }[];
  endpoint: string;
  rawSha256: string | null;
}

export interface ZoneOption {
  code: string;
  name: string;
  countryName?: string;
  countryCode?: string;
  timezone?: string | null;
  capabilities?: { latest: boolean; history: boolean; forecast: boolean; pastRange: boolean; powerBreakdown: boolean } | null;
}

export type ObservationQuality = 'measured' | 'provider-estimate';

export interface ObservationPoint {
  datetime: string;
  carbonIntensity: number;
  isEstimated: boolean;
  estimationMethod: string | null;
  quality: ObservationQuality;
}

export interface ErrorMetrics {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  unit: string;
}

export interface JobObservationsResult {
  collected?: ObservationSetRecord;
  observationSet: ObservationSetRecord | null;
  evaluation: {
    pairs: { datetime: string; forecast: number; observed: number; error: number; quality: ObservationQuality; estimationMethod: string | null }[];
    unmatchedIntervals: string[];
    measured: ErrorMetrics | null;
    providerEstimate: ErrorMetrics | null;
  } | null;
  /** Time-weighted forecast and observed intensity for the recommended window. */
  intensity: {
    window: { startUtc: string; endUtc: string };
    emissionFactorType: string;
    forecast: TimeWeightedValue & { reason: string };
    observed: TimeWeightedValue & { quality: IntensityQuality | null; excludedForEmissionFactor: string[]; reason: string };
  } | null;
  emissions: EmissionsAssessment | null;
  windowComparison: WindowComparison | null;
}

export type IntensityQuality = 'measured' | 'provider-estimate' | 'mixed';

export interface TimeWeightedValue {
  value: number | null;
  complete: boolean;
  windowMinutes: number;
  coveredMinutes: number;
  segments: { intervalStart: string; overlapStart: string; overlapEnd: string; overlapMinutes: number; value: number }[];
  missing: { start: string; end: string }[];
}

export interface EmissionsAssessment {
  realized:
    | { available: true; grams: number; energyKwh: number; energySource: 'recorded'; intensityQuality: IntensityQuality }
    | { available: false; label: string; reason: string };
  estimated: {
    label: string;
    grams: number | null;
    energyKwh: number;
    energyBasis: string;
    intensityQuality: IntensityQuality | null;
    reason: string;
  };
}

export interface WindowComparison {
  available: boolean;
  emissionFactorType: string;
  recommended: { window: { startUtc: string; endUtc: string }; forecastIntensity: number | null; observedIntensity: number | null; observedQuality: IntensityQuality | null };
  immediate: { window: { startUtc: string; endUtc: string }; forecastIntensity: number | null; observedIntensity: number | null; observedQuality: IntensityQuality | null };
  forecastDifference: number | null;
  observedDifference: number | null;
  observedDifferencePct: number | null;
  estimatedEmissions: { label: string; recommendedGrams: number | null; immediateGrams: number | null; basis: string };
  realizedEmissions: string;
  unit: string;
  basis: string;
}

export interface ObservationSetRecord {
  id: string;
  status:
    | 'COMPLETE'
    | 'PARTIAL'
    | 'PENDING_WINDOW_NOT_FINISHED'
    | 'UNAVAILABLE_WINDOW_MISSED'
    | 'UNAVAILABLE_PROVIDER_ERROR'
    | 'NOT_APPLICABLE_SYNTHETIC';
  statusDetail: string;
  collectedAt: string;
  window: { startUtc: string; endUtc: string };
  intervals: string[];
  observations: ObservationPoint[];
  missingIntervals: string[];
}

export interface CarbonForecastData {
  source: string;
  region: string;
  regionName: string;
  timestamp: string;
  dataMode: 'live' | 'demo';
  dataClass?: 'real' | 'synthetic';
  uncertaintySource?: 'synthetic-demo-model' | 'unavailable';
  timezone?: string | null;
  snapshot?: ForecastSnapshot;
  traceVersion: string;
  forecastHorizonHours: number;
  timeResolution: string;
  hourlyProfile: HourlyCarbonPoint[];
  averageCarbon: number;
  minCarbon: number;
  maxCarbon: number;
}

export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  category: 'Baseline' | 'Deterministic' | 'Uncertainty-Aware';
  selectedStartHour: number;
  selectedWindow: string;
  predictedCarbon: number; // legacy alias for grid intensity
  predictedCarbonIntensity?: number; // gCO2eq/kWh
  estimatedWorkloadEmissionsGrams?: number; // gCO2eq
  carbonIntensityUnit?: string; // 'gCO2eq/kWh'
  workloadEmissionsUnit?: string; // 'gCO2eq'
  estimatedDeadlineRisk: number;
  waitingTimeHours: number;
  isFeasible: boolean;
  schedulerOverheadMs: number;
  rationale: string;
  /** Wall-clock window (UTC) and real-deadline check, added by the M5 workflow. */
  selectedStartUtc?: string;
  selectedEndUtc?: string;
  meetsDeadline?: boolean;
}

export interface CandidateWindowEvaluation {
  slotIndex: number;
  startHour: number;
  endHour: number;
  windowLabel: string;
  predictedCarbonIntensity: number; // gCO2eq/kWh
  predictedCarbonImpactGrams: number; // estimated total grams CO2
  stdDev: number | null; // forecast uncertainty sigma (null when unavailable)
  uncertaintyRange: string;
  startUtc?: string;
  endUtc?: string;
  deadlineRisk: number; // decimal probability
  deadlineRiskPct: string; // e.g. "4.0%"
  slackHours: number;
  waitingTimeHours: number;
  isFeasible: boolean;
  meetsDeadline: boolean;
  classification:
    | 'RECOMMENDED'
    | 'FEASIBLE'
    | 'REJECTED_HIGH_RISK'
    | 'REJECTED_DEADLINE_BREACH';
  classificationLabel: string; // "RECOMMENDED" | "FEASIBLE BUT NOT OPTIMAL" | "REJECTED — HIGH DEADLINE RISK" | "REJECTED — MISSES DEADLINE"
  reason: string;
}

export interface ResearchInsightLowestVsSafest {
  lowestCarbonWindow: CandidateWindowEvaluation;
  recommendedWindow: CandidateWindowEvaluation;
  isLowestCarbonSafe: boolean;
  carbonInsurancePenaltyGramsPerKwh: number;
  explanation: string;
}

export interface SchedulingDecisionResponse {
  job: WorkloadJob;
  carbonSource: string;
  dataMode: 'live' | 'demo';
  region: string;
  candidateWindows?: CandidateWindowEvaluation[];
  evaluatedPolicies: PolicyEvaluationResult[];
  recommendedDecision: PolicyEvaluationResult;
  comparisonSummary: {
    carbonSavingsVsImmediatePct: number;
    delayPenaltyHours: number;
    riskDifferenceVsDeterministic: number;
  };
  researchInsight?: ResearchInsightLowestVsSafest;
  status?: 'RECOMMENDED' | 'INFEASIBLE' | 'INSUFFICIENT_FORECAST_COVERAGE';
  reason?: string;
  decisionId?: string;
  snapshotId?: string | null;
  /** P1: deadline risk from declared runtime variability only (none declared = deterministic). */
  riskModel?: 'deterministic' | 'declared-runtime-cv';
  runtimeCv?: number;
  unavailablePolicies?: { policyId: string; policyName: string; reason: string }[];
  /** P4: structured explanation stored with the decision. */
  explanation?: DecisionExplanation;
  recommendedWindow?: { startUtc: string; endUtc: string };
  timeline?: {
    arrivalAt: string;
    deadlineAt: string;
    forecastStartUtc: string;
    forecastCoverageEndUtc: string;
    deadlineBeyondForecast: boolean;
    timezone: string | null;
    note: string;
  };
  provenance?: {
    provider: string;
    dataClass: 'real' | 'synthetic';
    zone: string;
    issuedAt: string | null;
    fetchedAt: string;
    horizonHours: number;
    granularity: string;
    emissionFactorType: string;
    endpoint: string;
    rawSha256: string | null;
    uncertaintySource: string;
  };
  energyAssumption?: { powerKw: number; energyKwh: number; basis: string };
  /** Forecast intensity weighted by the minutes each interval overlaps the window. */
  timeWeightedForecast?: {
    recommendedIntensity: number | null;
    immediateIntensity: number | null;
    savingsVsImmediatePct: number | null;
    basis: string;
  };
}

export interface K8sJobExecutionRecord {
  jobId: string;
  k8sJobName: string;
  podName: string;
  namespace: string;
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';
  containerImage: string;
  command: string;
  scheduledStartTime: string;
  actualStartTime?: string;
  completionTime?: string;
  exitCode?: number | string;
  logs: string[];
  clusterMode: 'minikube' | 'offline_fallback';
  clusterNotice: string;
  predictedCarbon: number;
  /** Never set any more: realized carbon comes from provider observations. */
  realizedCarbon?: number;
  carbonError?: number;
  carbonObservation?: string;
  durationSeconds: number;
  execution?: { executionMode: string; scheduledStartUtc: string; scheduledEndUtc: string; note: string } | null;
}

export interface ExperimentRecord {
  id: string;
  timestamp: string;
  region: string;
  workload: string;
  durationHours: number;
  deadlineHours: number;
  riskTolerance: number;
  selectedScheduler: string;
  selectedStartHour: number;
  predictedCarbon: number;
  realizedCarbon: number | string;
  waitingTimeHours: number;
  deadlineRisk: number;
  status: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  token?: string;
  user?: User;
  /** True when the backend answered 401: the user must sign in (again). */
  authRequired?: boolean;
}

// ==========================================
// P4: job management, explanations, results
// ==========================================
export type JobStatus = 'pending' | 'scheduled' | 'infeasible' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobSummary {
  id: string;
  name: string | null;
  zone: string | null;
  createdAt: string | null;
  status: JobStatus;
  ownerId: string | null;
  owner?: string | null;
  latestDecision: { id: string; status: 'RECOMMENDED' | 'INFEASIBLE'; createdAt: string; dataMode: 'live' | 'demo'; recommendedWindow: { startUtc: string; endUtc: string } | null } | null;
  cancelledAt: string | null;
}

export interface DecisionExplanation {
  objective: string;
  constraints: { name: string; value: string }[];
  candidates: { total: number; feasible: number; rejectedHighRisk: number; rejectedDataGap: number };
  bindingConstraint: 'none' | 'risk-tolerance' | 'deadline' | 'data-gaps';
  summary: string;
  policies: { policyId: string; relation: string }[];
  unavailable: { policyId: string; policyName: string; reason: string }[];
}

export interface StoredPolicyRow {
  policyId: string;
  policyName: string;
  category: string;
  selectedStartUtc: string | null;
  selectedEndUtc: string | null;
  selectedWindow: string;
  forecastIntensity: number | null;
  estimatedEmissionsAssumedEnergyGrams: number | null;
  estimatedDeadlineRisk: number | null;
  waitingTimeHours: number | null;
  isFeasible: boolean;
  equivalentTo: string | null;
  recommended: boolean;
}

export interface ObservationSummary {
  status: string;
  statusDetail: string;
  collectedAt: string;
  intervals: number;
  measured: number;
  providerEstimate: number;
  missing: number;
  attempts: number;
}

export interface JobDetails extends JobSummary {
  job: Record<string, unknown>;
  decision: {
    id: string;
    status: 'RECOMMENDED' | 'INFEASIBLE';
    createdAt: string;
    engineVersion: string;
    dataMode: 'live' | 'demo';
    dataClass: 'real' | 'synthetic';
    snapshotId: string | null;
    recommendedWindow: { startUtc: string; endUtc: string } | null;
    immediateWindow: { startUtc: string; endUtc: string } | null;
    infeasibilityReason: string | null;
    riskModel: string | null;
    runtimeCv: number;
    provenance: { provider: string; dataClass: string; zone: string; fetchedAt: string; issuedAt: string | null } | null;
    energyAssumption: { powerKw: number; energyKwh: number; basis: string };
    explanation: DecisionExplanation | null;
    policies: StoredPolicyRow[];
    unavailablePolicies: { policyId: string; policyName: string; reason: string }[];
    candidateCount: number;
  } | null;
  execution: { executionMode: string; scheduledStartUtc: string; scheduledEndUtc: string; dispatchedAt: string; note: string } | null;
  observations: ObservationSummary | null;
}

export interface OracleEvaluation {
  status: string;
  offlineOnly: true;
  reason?: string;
  candidatesEvaluated?: number;
  candidatesFullyCovered?: number;
  oracleWindow?: { startUtc: string; endUtc: string; realizedIntensity: number } | null;
  policies?: { policyId: string; realizedIntensity: number | null; regretGramsPerKwh: number | null }[];
  basis?: string;
}

export interface ConfidenceIntervalResult {
  n: number;
  estimate: number | null;
  low: number | null;
  high: number | null;
  level: number;
  note?: string;
}

export interface BenchmarkPolicySummary {
  policyId: string;
  decisions: number;
  scored: number;
  meanRealizedIntensity: number | null;
  meanForecastIntensity: number | null;
  meanEstimatedEmissionsGrams: number | null;
  meanDelayHours: number | null;
  deadlineViolationRate: number | null;
  meanRegretVsOracle: number | null;
  realizedIntensityCI: ConfidenceIntervalResult;
  diffVsImmediateCI: ConfidenceIntervalResult;
}

export interface ErrorMetricsResult {
  n: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
}

export interface BenchmarkListItem {
  id: string;
  createdAt: string;
  gitCommit: string | null;
  dataClass: string;
  dataset: { zones: string[]; snapshots: number; realizedIntervals: number; measuredShare: number | null };
  seed: number;
  workloadsPerSnapshot: number;
  scenarios: { runtimeCv: number; workloads: number; pendingRealized: number }[];
}

export interface BenchmarkResultDetail extends Omit<BenchmarkListItem, 'scenarios'> {
  configSha256: string;
  dataset: BenchmarkListItem['dataset'] & { sha256: string };
  scenarios: { runtimeCv: number; workloads: number; infeasible: number; pendingRealized: number; oracleAvailable: number; policies: BenchmarkPolicySummary[] }[];
  accuracy?: {
    zones: { zone: string; snapshots: number; pairs: number; all: ErrorMetricsResult; measuredOnly: ErrorMetricsResult; estimatedOnly: ErrorMetricsResult }[];
    overall: ErrorMetricsResult;
    measuredOnly: ErrorMetricsResult;
  };
  notes: string[];
}

// P5: forecast-error model evaluations
export interface MlEvaluationListItem {
  id: string;
  createdAt: string;
  status: 'insufficient-data' | 'evaluated-not-promoted' | 'evaluated-promoted';
  dataset: { rows: number; measuredRows: number; zones: string[]; spanDays: number };
}

export interface MlEvaluation extends MlEvaluationListItem {
  statusReasons: string[];
  thresholds: { minTrainRows: number; minValidationRows: number; minTestRows: number; minSpanDays: number };
  providerErrorAllRows: { all: ErrorMetricsResult; measuredOnly: ErrorMetricsResult };
  split: { train: number; validation: number; test: number; droppedForGap: number } | null;
  testScores: { model: string; all: ErrorMetricsResult; measuredOnly: ErrorMetricsResult }[] | null;
  anomalies: { method: string; interpretation?: string; zones: { zone: string; rows: number; status: string; flagged: unknown[] }[] };
  notes: string[];
}
