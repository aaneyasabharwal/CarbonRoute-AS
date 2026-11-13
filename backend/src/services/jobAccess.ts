/**
 * Job ownership and access control (M1.2, audit C4).
 *
 * Rules:
 *  - Every job route requires a valid access token (401 otherwise).
 *  - A job belongs to the user who created it (ownerId). Only its owner can see or change it.
 *  - Administrators can see and change every job, including jobs stored before M1.2 that
 *    have no owner. Admin actions on another user's job are written to the audit log.
 *  - A job that does not exist and a job the caller may not access both return the same
 *    404, so job ids cannot be probed (no IDOR, no existence leak).
 */
import { Response, NextFunction } from 'express';
import type { WorkloadJob } from './schedulerService';
import { K8sConnector } from './k8sConnector';
import { schedulingStore, StoredJob } from '../models/schedulingStore';
import { AuthRequest, isAdmin } from '../middleware/auth';
import { db, User } from '../models/db';

/** Jobs registered through POST /api/jobs (in memory, as before M1.2). */
export const registeredJobs = new Map<string, WorkloadJob>();

export interface JobRef {
  id: string;
  ownerId?: string;
  registered?: WorkloadJob;
  stored?: StoredJob;
  cancelled: boolean;
}

export interface JobRequest extends AuthRequest {
  job?: JobRef;
}

export const JOB_NOT_FOUND = { success: false, code: 'JOB_NOT_FOUND', message: 'Job not found.' } as const;

/** Finds a job in the registry or the persistent store. */
export function findJob(id: string): JobRef | null {
  const registered = registeredJobs.get(id);
  const stored = schedulingStore().getJob(id);
  if (!registered && !stored) return null;
  return {
    id,
    ownerId: registered?.ownerId ?? stored?.ownerId,
    registered,
    stored,
    cancelled: registered?.status === 'cancelled' || Boolean(stored?.cancelledAt),
  };
}

/** Owner or administrator. Jobs without an owner (stored before M1.2) are admin-only. */
export function canAccessJob(user: User | undefined, ownerId: string | undefined): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return Boolean(ownerId) && ownerId === user.id;
}

/**
 * Route guard for /jobs/:id/*. Must run after authenticateToken. Responds 404 both for an
 * unknown id and for a job owned by someone else.
 */
export const requireJobAccess = (req: JobRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', message: 'Authentication required.' });
  const job = findJob(String(req.params.id));
  if (!job || !canAccessJob(req.user, job.ownerId)) return res.status(404).json(JOB_NOT_FOUND);
  req.job = job;
  next();
};

/** Records an administrator acting on a job they do not own. */
export function auditAdminOverride(user: User, job: JobRef, action: string): void {
  if (isAdmin(user) && job.ownerId !== user.id) {
    const owner = job.ownerId ? db.getUserById(job.ownerId)?.username ?? job.ownerId : 'no owner (pre-M1.2 record)';
    db.addAuditLog('ADMIN_JOB_ACCESS', 'Job', job.id, `Admin ${user.username} ${action} job owned by ${owner}`, user.username);
  }
}

/** Every known job (registry and store), one entry per id. */
export function allJobs(): JobRef[] {
  const ids = new Set<string>([...schedulingStore().listJobs().map((j) => j.id), ...registeredJobs.keys()]);
  return [...ids].map((id) => findJob(id)).filter((j): j is JobRef => j !== null);
}

export type JobStatus = 'pending' | 'scheduled' | 'infeasible' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Current status: cancelled, else the execution status, else the latest decision. */
export function jobStatus(job: JobRef): JobStatus {
  if (job.cancelled) return 'cancelled';
  const execution = K8sConnector.getJobExecution(job.id);
  if (execution) return execution.status === 'pending' ? 'scheduled' : (execution.status as JobStatus);
  const decision = schedulingStore().latestDecisionForJob(job.id);
  if (decision) return decision.status === 'RECOMMENDED' ? 'scheduled' : 'infeasible';
  return (job.registered?.status as JobStatus) || 'pending';
}

/** Summary used by GET /api/jobs and GET /api/jobs/:id. Owner names are shown to admins only. */
export function jobSummary(job: JobRef, viewer: User) {
  const r = job.registered;
  const s = job.stored;
  const decision = schedulingStore().latestDecisionForJob(job.id);
  return {
    id: job.id,
    name: r?.name ?? s?.name ?? null,
    zone: s?.zone ?? r?.region ?? null,
    createdAt: r?.createdAt ?? s?.createdAt ?? null,
    status: jobStatus(job),
    ownerId: job.ownerId ?? null,
    ...(isAdmin(viewer)
      ? { owner: job.ownerId ? db.getUserById(job.ownerId)?.username ?? null : null }
      : {}),
    latestDecision: decision
      ? {
          id: decision.id,
          status: decision.status,
          createdAt: decision.createdAt,
          dataMode: decision.dataMode,
          recommendedWindow: decision.recommendedWindow,
        }
      : null,
    cancelledAt: s?.cancelledAt ?? null,
  };
}
