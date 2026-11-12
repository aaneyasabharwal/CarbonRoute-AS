/**
 * Persistent store for the scheduling workflow: jobs, forecast snapshots, decisions,
 * executions and observation collections.
 *
 * It is a JSON file next to the main JSON database (same directory, so tests that point
 * CARBONROUTE_DB_FILE at a temporary folder are isolated automatically). Writes go to a
 * temporary file that is then renamed, so a crash cannot leave half-written JSON.
 * A relational database is planned (remediation milestone M4); this keeps the same records.
 */
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ForecastSnapshot, Observation } from '../carbon/types';

export interface StoredJob {
  id: string;
  name: string;
  commandOrImage: string;
  isContainerImage: boolean;
  zone: string;
  durationHours: number;
  cpu: number;
  memoryMb: number;
  riskTolerance: number;
  /** When the job became available to run (UTC). */
  arrivalAt: string;
  /** Latest allowed completion time (UTC). */
  deadlineAt: string;
  createdAt: string;
}

export interface StoredSnapshot extends ForecastSnapshot {
  id: string;
}

export interface WindowTimes {
  startUtc: string;
  endUtc: string;
}

export interface StoredDecision {
  id: string;
  jobId: string;
  /** Forecast snapshot the decision used (null when the job was infeasible before any data was fetched). */
  snapshotId: string | null;
  createdAt: string;
  engineVersion: string;
  status: 'RECOMMENDED' | 'INFEASIBLE';
  dataMode: 'live' | 'demo';
  dataClass: 'real' | 'synthetic';
  riskModel: string | null;
  /** Window the recommended policy selected (null when infeasible). */
  recommendedWindow: WindowTimes | null;
  /** Window "Immediate execution" would have used (for observed comparisons). */
  immediateWindow: WindowTimes | null;
  energyAssumption: { powerKw: number; energyKwh: number; basis: string };
  infeasibilityReason?: string;
  /** Full response returned to the client (policies, candidate windows, explanations). */
  result: any;
}

export interface StoredExecution {
  id: string;
  jobId: string;
  decisionId: string;
  executionMode: 'simulated-no-workload' | 'kubernetes';
  scheduledStartUtc: string;
  scheduledEndUtc: string;
  dispatchedAt: string;
  note: string;
  /**
   * Energy actually consumed, when a real execution recorded it (kWh). Absent for simulated
   * executions; realized emissions are only calculated when this is present.
   */
  measuredEnergyKwh?: number;
}

export type ObservationStatus =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'PENDING_WINDOW_NOT_FINISHED'
  | 'UNAVAILABLE_WINDOW_MISSED'
  | 'UNAVAILABLE_PROVIDER_ERROR'
  | 'NOT_APPLICABLE_SYNTHETIC';

export interface StoredObservationSet {
  id: string;
  jobId: string;
  decisionId: string;
  window: WindowTimes;
  /** Hourly interval starts the window covers (UTC). */
  intervals: string[];
  collectedAt: string;
  status: ObservationStatus;
  statusDetail: string;
  observations: Observation[];
  missingIntervals: string[];
  /** Same for the Immediate window, used only for an observed comparison. */
  immediate?: { window: WindowTimes; intervals: string[]; observations: Observation[]; missingIntervals: string[] };
  provider: 'electricitymaps' | null;
  endpoint: string | null;
  rawSha256: string | null;
  errorCode?: string;
}

interface StoreData {
  jobs: StoredJob[];
  forecastSnapshots: StoredSnapshot[];
  decisions: StoredDecision[];
  executions: StoredExecution[];
  observationSets: StoredObservationSet[];
}

const EMPTY: StoreData = { jobs: [], forecastSnapshots: [], decisions: [], executions: [], observationSets: [] };

export class SchedulingStore {
  private data: StoreData;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  static defaultPath(): string {
    const mainDb = process.env.CARBONROUTE_DB_FILE
      ? path.resolve(process.env.CARBONROUTE_DB_FILE)
      : path.resolve(__dirname, '../../../database/carbonroute.db.json');
    return path.join(path.dirname(mainDb), 'carbonroute.scheduling.db.json');
  }

  get path(): string {
    return this.filePath;
  }

  private load(): StoreData {
    if (!fs.existsSync(this.filePath)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return { ...structuredClone(EMPTY), ...parsed };
    } catch (err) {
      // Never silently discard stored records: keep the unreadable file aside for inspection.
      const aside = `${this.filePath}.unreadable-${Date.now()}`;
      fs.renameSync(this.filePath, aside);
      console.error(`Scheduling store could not be parsed; moved to ${aside}`);
      return structuredClone(EMPTY);
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  // Jobs
  addJob(job: Omit<StoredJob, 'id' | 'createdAt'> & { id?: string }): StoredJob {
    const stored: StoredJob = { ...job, id: job.id || `job-${uuidv4().slice(0, 8)}`, createdAt: new Date().toISOString() };
    this.data.jobs.push(stored);
    this.save();
    return stored;
  }
  getJob(id: string): StoredJob | undefined {
    return this.data.jobs.find((j) => j.id === id);
  }

  // Forecast snapshots
  addSnapshot(snapshot: ForecastSnapshot): StoredSnapshot {
    const stored: StoredSnapshot = { ...snapshot, id: `snap-${uuidv4()}` };
    this.data.forecastSnapshots.push(stored);
    this.save();
    return stored;
  }
  getSnapshot(id: string): StoredSnapshot | undefined {
    return this.data.forecastSnapshots.find((s) => s.id === id);
  }

  // Decisions
  addDecision(decision: Omit<StoredDecision, 'id' | 'createdAt'>): StoredDecision {
    const stored: StoredDecision = { ...decision, id: `dec-${uuidv4()}`, createdAt: new Date().toISOString() };
    this.data.decisions.push(stored);
    this.save();
    return stored;
  }
  getDecision(id: string): StoredDecision | undefined {
    return this.data.decisions.find((d) => d.id === id);
  }
  latestDecisionForJob(jobId: string): StoredDecision | undefined {
    return [...this.data.decisions].reverse().find((d) => d.jobId === jobId);
  }

  // Executions
  addExecution(execution: Omit<StoredExecution, 'id'>): StoredExecution {
    const stored: StoredExecution = { ...execution, id: `exe-${uuidv4()}` };
    this.data.executions.push(stored);
    this.save();
    return stored;
  }
  latestExecutionForJob(jobId: string): StoredExecution | undefined {
    return [...this.data.executions].reverse().find((e) => e.jobId === jobId);
  }

  // Observation collections (every attempt is kept; the latest is used)
  addObservationSet(set: Omit<StoredObservationSet, 'id'>): StoredObservationSet {
    const stored: StoredObservationSet = { ...set, id: `obs-${uuidv4()}` };
    this.data.observationSets.push(stored);
    this.save();
    return stored;
  }
  observationSetsForJob(jobId: string): StoredObservationSet[] {
    return this.data.observationSets.filter((o) => o.jobId === jobId);
  }
}

let shared: SchedulingStore | null = null;
/** Store shared by the API (created on first use so tests can set paths first). */
export function schedulingStore(): SchedulingStore {
  if (!shared) shared = new SchedulingStore(SchedulingStore.defaultPath());
  return shared;
}
