import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { adminPasswordProblem, ConfigError, MIN_ADMIN_PASSWORD_LENGTH } from '../config/secrets';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  /**
   * Tokens issued before this time are rejected (M1.2). Set when the password changes, so
   * a rotation also ends every existing session.
   */
  tokensValidAfter?: string;
}

export type UserRole = 'admin' | 'student' | 'evaluator';
export const USER_ROLES: readonly UserRole[] = ['admin', 'student', 'evaluator'];

/** A token revoked before its expiry (logout). Kept until the token would have expired. */
export interface RevokedToken {
  jti: string;
  userId: string;
  expiresAt: string;
}

export type DeliverableType = 'software_grid' | 'planning' | 'midterm' | 'final' | 'other';
export type PresentationStatus = 'published' | 'draft' | 'archived';

export interface PresentationItem {
  id: string;
  title: string;
  deliverableType: DeliverableType;
  versionTag: string; // 'v1', 'v2', 'midterm', 'final'
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
}

export interface Resource {
  id: string;
  title: string;
  category: string;
  description: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  isPublished: boolean;
  createdAt: string;
  authors?: string;
  version?: string;
  date?: string;
  type?: string;
  format?: string;
  badge?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatarUrl: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface RoadmapMilestone {
  id: string;
  phaseName?: string;
  weekRange: string; // e.g. 'Weeks 1-2'
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'planned';
  deliverables: string[];
  tasks: RoadmapTask[];
  displayOrder: number;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: 'presentation' | 'resource' | 'team' | 'auth';
  entityId: string;
  details: string;
  timestamp: string;
}

export interface DatabaseSchema {
  users: User[];
  presentations: PresentationItem[];
  resources: Resource[];
  teamMembers: TeamMember[];
  roadmapMilestones: RoadmapMilestone[];
  activityLogs: ActivityLog[];
  /** Only written once a token has been revoked, so older files are left as they were. */
  revokedTokens?: RevokedToken[];
}

class JsonDatabase {
  private dbPath: string;
  private data: DatabaseSchema;

  constructor() {
    // CARBONROUTE_DB_FILE lets the test suite use an isolated temporary database file.
    // When unset, the original location is used unchanged.
    const overridePath = process.env.CARBONROUTE_DB_FILE;
    const dataDir = overridePath
      ? path.dirname(path.resolve(overridePath))
      : path.resolve(__dirname, '../../../database');
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = overridePath ? path.resolve(overridePath) : path.join(dataDir, 'carbonroute.db.json');
    this.data = this.loadDatabase();
    this.seedDefaultsIfEmpty();
  }

  private loadDatabase(): DatabaseSchema {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          users: parsed.users || [],
          presentations: parsed.presentations || [],
          resources: parsed.resources || [],
          teamMembers: parsed.teamMembers || [],
          roadmapMilestones: parsed.roadmapMilestones || [],
          activityLogs: parsed.activityLogs || parsed.auditLogs || [],
          ...(Array.isArray(parsed.revokedTokens) ? { revokedTokens: parsed.revokedTokens } : {}),
        };
      } catch (err) {
        console.error('Failed to parse database file, initializing default schema:', err);
      }
    }
    return {
      users: [],
      presentations: [],
      resources: [],
      teamMembers: [],
      roadmapMilestones: [],
      activityLogs: [],
    };
  }

  private saveDatabase(): void {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  private seedDefaultsIfEmpty(): void {
    let changed = false;

    // Seed the initial admin from configuration (M1.1): there is no default password.
    // Production refuses to start without a strong ADMIN_PASSWORD when no user exists;
    // elsewhere the account is not created and a warning explains how to create it.
    if (this.data.users.length === 0) {
      const { username, email, password } = config.initialAdmin;
      const problem = adminPasswordProblem(password);
      if (problem) {
        if (config.env === 'production') {
          throw new ConfigError(`${problem} It is required to create the initial admin account. Refusing to start in production.`);
        }
        console.warn(`[db] ${problem} No admin account was created. Set ADMIN_PASSWORD (at least ${MIN_ADMIN_PASSWORD_LENGTH} characters) and restart to create "${username}".`);
      } else {
        this.data.users.push({
          id: uuidv4(),
          username,
          email,
          passwordHash: bcrypt.hashSync(password as string, bcrypt.genSaltSync(10)),
          role: 'admin',
          createdAt: new Date().toISOString(),
        });
        changed = true;
      }
    }

    // Seed Team Members strictly matching prompt:
    // Yuvika Nagpal: Simulation / Data / Workload Modelling
    // Kumkum Gupta: Scheduling Algorithms / Uncertainty / Risk Calibration
    // Aaneya Sabharwal: Backend / Dashboard / Deployment / Integration
    if (!this.data.teamMembers || this.data.teamMembers.length === 0 || this.data.teamMembers[0].name === 'Yuvika') {
      this.data.teamMembers = [
        {
          id: 'team-1',
          name: 'Yuvika Nagpal',
          role: 'Simulation / Data / Workload Modelling',
          bio: 'Focuses on discrete-event cloud region simulation, carbon-intensity trace ingestion & standardization, and synthetic batch workload models.',
          avatarUrl: '',
          displayOrder: 1,
        },
        {
          id: 'team-2',
          name: 'Kumkum Gupta',
          role: 'Scheduling Algorithms / Uncertainty / Risk Calibration',
          bio: 'Focuses on baseline schedulers (Immediate, EDF, Cost-Aware), carbon-aware optimization, forecast error distribution modeling, and deadline-risk calibration (Brier score & ECE).',
          avatarUrl: '',
          displayOrder: 2,
        },
        {
          id: 'team-3',
          name: 'Aaneya Sabharwal',
          role: 'Backend / Dashboard / Deployment / Integration',
          bio: 'Focuses on the FastAPI scheduling backend, containerized Kubernetes batch execution connectors, interactive experiment dashboard, and deployment architecture.',
          avatarUrl: '',
          displayOrder: 3,
        },
      ];
      changed = true;
    }

    // Seed Presentations strictly adhering to prompt:
    // Software Grid (Status: Published)
    // Planning Presentation V1 (Status: Published, Date: 17 August 2026)
    // Planning Presentation V2 (Status: Not Published / Draft)
    // Mid-Sem Presentation (Status: Not Published)
    // Final Presentation (Status: Not Published)
    if (!this.data.presentations || this.data.presentations.length === 0 || !this.data.presentations.find(p => p.versionTag === 'v1')) {
      this.data.presentations = [
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
          fileUrl: '/api/storage/presentations/CarbonRoute_Software_Grid.pdf',
          authors: ['Yuvika Nagpal', 'Kumkum Gupta', 'Aaneya Sabharwal'],
          uploaderName: 'CarbonRoute Team',
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
          fileUrl: '/api/storage/presentations/CarbonRoute_Planning_Presentation_V1.pdf',
          authors: [
            'Yuvika Nagpal (1024030141)',
            'Kumkum Gupta (1024030144)',
            'Aaneya Sabharwal (1024030147)'
          ],
          uploaderName: 'Team TriFlux (Batch: 3C15)',
          status: 'published',
          presentationDate: '2026-08-17',
          sha256Checksum: '8e4f1a239c8914bca99281a8f94d0752119ef58a2d12e9b01c34a17d8900bb21',
          changeSummary: 'Official 25-slide Planning Presentation V1 submitted to instructor Sukhpal Singh.',
          createdAt: '2026-08-17T10:00:00.000Z',
          publishedAt: '2026-08-17T10:00:00.000Z',
        },
        {
          id: 'pres-planning-v2',
          title: 'CarbonRoute Planning Presentation V2',
          deliverableType: 'planning',
          versionTag: 'v2',
          description: 'Iterative revision of the planning presentation incorporating instructor feedback and preliminary trace modeling results.',
          fileName: 'CarbonRoute_Planning_Presentation_V2_Draft.pdf',
          filePath: 'uploads/presentations/CarbonRoute_Planning_Presentation_V2_Draft.pdf',
          fileSize: 124000,
          mimeType: 'application/pdf',
          fileUrl: '/api/storage/presentations/CarbonRoute_Planning_Presentation_V2_Draft.pdf',
          authors: ['Yuvika Nagpal', 'Kumkum Gupta', 'Aaneya Sabharwal'],
          uploaderName: 'CarbonRoute Team',
          status: 'draft',
          presentationDate: '2026-08-24',
          sha256Checksum: 'b7c2d9e1f3a5b4c6e8d0f2a4b6c8e0d2f4a6b8c0e2d4f6a8b0c2d4e6f8a0b2c4',
          changeSummary: 'Draft revision V2 with updated trace schemas and calibration protocols.',
          previousVersionId: 'pres-planning-v1',
          createdAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'pres-midterm-v1',
          title: 'Mid-Sem Presentation',
          deliverableType: 'midterm',
          versionTag: 'midterm-v1',
          description: 'Mid-semester milestone presentation reviewing discrete-event simulator implementation, baseline benchmarks, and empirical forecast error curves.',
          fileName: '',
          filePath: '',
          fileSize: 0,
          mimeType: 'application/pdf',
          fileUrl: '',
          authors: ['Yuvika Nagpal', 'Kumkum Gupta', 'Aaneya Sabharwal'],
          uploaderName: 'CarbonRoute Team',
          status: 'draft',
          presentationDate: '2026-10-12',
          sha256Checksum: '',
          changeSummary: 'Scheduled mid-semester deliverable placeholder.',
          createdAt: '2026-08-18T00:00:00.000Z',
        },
        {
          id: 'pres-final-v1',
          title: 'Final Presentation',
          deliverableType: 'final',
          versionTag: 'final-v1',
          description: 'Comprehensive final project demonstration, statistical benchmark results, live Kubernetes container connector demo, and semester defense.',
          fileName: '',
          filePath: '',
          fileSize: 0,
          mimeType: 'application/pdf',
          fileUrl: '',
          authors: ['Yuvika Nagpal', 'Kumkum Gupta', 'Aaneya Sabharwal'],
          uploaderName: 'CarbonRoute Team',
          status: 'draft',
          presentationDate: '2026-12-21',
          sha256Checksum: '',
          changeSummary: 'Scheduled final presentation deliverable placeholder.',
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      ];
      changed = true;
    }

    // Seed 17-Week Roadmap strictly matching prompt:
    if (!this.data.roadmapMilestones || this.data.roadmapMilestones.length === 0 || this.data.roadmapMilestones.length !== 11) {
      this.data.roadmapMilestones = [
        {
          id: 'w1-2',
          weekRange: 'WEEKS 1–2',
          title: 'Requirements, research and initial simulator',
          description: 'Problem formulation, literature review, carbon intensity data ingestion specification, baseline simulator architecture, and website deployment.',
          status: 'in-progress',
          deliverables: ['Planning Presentation V1', 'Project Portal Deployment', 'Initial Simulator Spec'],
          tasks: this.getDefaultTasksForMilestone('w1-2'),
          displayOrder: 1,
        },
        {
          id: 'w3-4',
          weekRange: 'WEEKS 3–4',
          title: 'Simulator models and workload generation',
          description: 'Development of discrete-event simulator core, multi-region cloud capacity and pricing models, and synthetic batch workload generators (short, medium, long jobs).',
          status: 'planned',
          deliverables: ['Discrete-Event Simulator Core', 'Workload Generator Trace Engine'],
          tasks: this.getDefaultTasksForMilestone('w3-4'),
          displayOrder: 2,
        },
        {
          id: 'w5-6',
          weekRange: 'WEEKS 5–6',
          title: 'Baseline scheduling policies',
          description: 'Implementation of reference scheduling policies: Immediate Execution, Earliest Deadline First (EDF), Cost-Aware Scheduler, and Realized-Data Oracle solver.',
          status: 'planned',
          deliverables: ['Baseline Suite', 'Oracle Upper-Bound Reference Solver'],
          tasks: this.getDefaultTasksForMilestone('w5-6'),
          displayOrder: 3,
        },
        {
          id: 'w7-8',
          weekRange: 'WEEKS 7–8',
          title: 'Carbon-aware scheduler',
          description: 'Implementation of deterministic carbon-aware scheduling algorithms and heuristic multi-region workload shifting strategies.',
          status: 'planned',
          deliverables: ['Deterministic Carbon Scheduler', 'Trace Alignment Module'],
          tasks: this.getDefaultTasksForMilestone('w7-8'),
          displayOrder: 4,
        },
        {
          id: 'w9-10',
          weekRange: 'WEEKS 9–10',
          title: 'Forecast uncertainty and error modelling',
          description: 'Parametric and empirical forecast error distribution modeling across 1h to 48h look-ahead horizons to model variance growth over time.',
          status: 'planned',
          deliverables: ['Forecast Error Engine', 'Multi-Horizon Error Distribution Models'],
          tasks: this.getDefaultTasksForMilestone('w9-10'),
          displayOrder: 5,
        },
        {
          id: 'w11-12',
          weekRange: 'WEEKS 11–12',
          title: 'Uncertainty-aware scheduler and deadline-risk calibration',
          description: 'Core CarbonRoute scheduling algorithm enforcing P(deadline violation | decision) <= tau, combined with Brier score calibration and Reliability Diagrams.',
          status: 'planned',
          deliverables: ['CarbonRoute Uncertainty Scheduler', 'Risk Calibration Module (Brier/ECE)'],
          tasks: this.getDefaultTasksForMilestone('w11-12'),
          displayOrder: 6,
        },
        {
          id: 'w13',
          weekRange: 'WEEK 13',
          title: 'Stress testing',
          description: 'Systematic stress testing against sudden renewable drop-offs, cloud capacity contention, flash price spikes, and severe forecast skew.',
          status: 'planned',
          deliverables: ['Stress-Testing Matrix', 'Degradation & Robustness Analysis'],
          tasks: this.getDefaultTasksForMilestone('w13'),
          displayOrder: 7,
        },
        {
          id: 'w14',
          weekRange: 'WEEK 14',
          title: 'API and dashboard integration',
          description: 'FastAPI REST endpoint exposure for scheduling decisions and interactive web dashboard integration for visualizing schedules and risk curves.',
          status: 'planned',
          deliverables: ['FastAPI Endpoints', 'Interactive Scheduling Dashboard'],
          tasks: this.getDefaultTasksForMilestone('w14'),
          displayOrder: 8,
        },
        {
          id: 'w15',
          weekRange: 'WEEK 15',
          title: 'Large-scale repeated experiments and benchmark',
          description: 'Execution of multi-seed, multi-region reproducible benchmark suite across varying forecast error levels, producing paired statistical evaluations.',
          status: 'planned',
          deliverables: ['Reproducible Benchmark Bundle', 'Statistical Significance Tests'],
          tasks: this.getDefaultTasksForMilestone('w15'),
          displayOrder: 9,
        },
        {
          id: 'w16',
          weekRange: 'WEEK 16',
          title: 'Containerized workload connector, testing and deployment',
          description: 'Integration of container execution connector dispatching scheduled batch jobs to Kubernetes Jobs with explanation summaries.',
          status: 'planned',
          deliverables: ['Kubernetes Workload Connector', 'End-to-End Container Runner'],
          tasks: this.getDefaultTasksForMilestone('w16'),
          displayOrder: 10,
        },
        {
          id: 'w17',
          weekRange: 'WEEK 17',
          title: 'Final integration, evaluation, documentation and presentation',
          description: 'Comprehensive project evaluation, final documentation, open-source repository packaging, and university semester defense presentation.',
          status: 'planned',
          deliverables: ['Final Project Thesis / Report', 'Final Presentation V1', 'Release Artifact'],
          tasks: this.getDefaultTasksForMilestone('w17'),
          displayOrder: 11,
        },
      ];
      changed = true;
    } else {
      // Migrate existing milestones if tasks are missing
      for (const m of this.data.roadmapMilestones) {
        if (!m.tasks || m.tasks.length === 0) {
          m.tasks = this.getDefaultTasksForMilestone(m.id);
          changed = true;
        }
      }
    }

    if (this.data.activityLogs.length === 0) {
      this.data.activityLogs.push({
        id: uuidv4(),
        userId: 'system',
        userName: 'System Init',
        action: 'PUBLISH',
        entityType: 'presentation',
        entityId: 'pres-planning-v1',
        details: 'Planning Presentation V1 published to public repository.',
        timestamp: '2026-08-17T10:00:00.000Z',
      });
      changed = true;
    }

    if (changed) {
      this.saveDatabase();
    }
  }

  // User Operations
  getUsers(): User[] {
    return this.data.users;
  }

  getUserById(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  getUserByUsername(username: string): User | undefined {
    return this.data.users.find((u) => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase());
  }

  /**
   * Replaces a user's password (used to rotate credentials, e.g. the formerly published
   * default admin password). The new password must pass the same checks as ADMIN_PASSWORD.
   * The password itself is never logged.
   */
  setUserPassword(username: string, newPassword: string, performedBy = 'System'): User {
    const problem = adminPasswordProblem(newPassword);
    if (problem) throw new ConfigError(problem.replace('ADMIN_PASSWORD', 'The new password'));
    const user = this.getUserByUsername(username);
    if (!user) throw new ConfigError(`User "${username}" does not exist.`);
    user.passwordHash = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(10));
    // Every token issued before the change stops working (M1.2).
    user.tokensValidAfter = new Date().toISOString();
    this.addAuditLog('PASSWORD_CHANGED', 'User', user.id, `Password changed for ${user.username}`, performedBy);
    this.saveDatabase();
    return user;
  }

  /**
   * Creates a user account (M1.2: jobs are owned by users, so non-admin accounts must exist).
   * The password must meet the same strength rules as ADMIN_PASSWORD and is never logged.
   */
  createUser(input: { username: string; email: string; password: string; role: UserRole }, performedBy = 'System'): User {
    const username = String(input.username || '').trim();
    const email = String(input.email || '').trim();
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
      throw new ConfigError('Username must be 3-40 characters: letters, digits, ".", "_" or "-".');
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new ConfigError('A valid email address is required.');
    if (!USER_ROLES.includes(input.role)) throw new ConfigError(`Role must be one of: ${USER_ROLES.join(', ')}.`);
    const problem = adminPasswordProblem(input.password);
    if (problem) throw new ConfigError(problem.replace('ADMIN_PASSWORD', 'The password'));
    if (this.getUserByUsername(username) || this.getUserByUsername(email)) {
      throw new ConfigError('A user with that username or email already exists.');
    }
    const user: User = {
      id: uuidv4(),
      username,
      email,
      passwordHash: bcrypt.hashSync(input.password, bcrypt.genSaltSync(10)),
      role: input.role,
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this.addAuditLog('USER_CREATED', 'User', user.id, `User ${username} created with role ${input.role}`, performedBy);
    return user;
  }

  // Token revocation (M1.2)
  revokeToken(jti: string, userId: string, expiresAtMs: number): void {
    const now = Date.now();
    const kept = (this.data.revokedTokens || []).filter((t) => Date.parse(t.expiresAt) > now && t.jti !== jti);
    kept.push({ jti, userId, expiresAt: new Date(expiresAtMs).toISOString() });
    this.data.revokedTokens = kept;
    this.saveDatabase();
  }

  isTokenRevoked(jti: string): boolean {
    return (this.data.revokedTokens || []).some((t) => t.jti === jti);
  }

  // Presentation Operations
  getPresentations(includeDrafts = false): PresentationItem[] {
    if (includeDrafts) {
      return this.data.presentations;
    }
    return this.data.presentations.filter((p) => p.status === 'published');
  }

  getPresentationById(id: string): PresentationItem | undefined {
    return this.data.presentations.find((p) => p.id === id || p.versionTag.toLowerCase() === id.toLowerCase());
  }

  getPresentationByVersion(versionTag: string): PresentationItem | undefined {
    const norm = versionTag.toLowerCase().trim();
    if (norm === 'v1' || norm === 'planning-v1' || norm === 'planning') {
      const planning = this.data.presentations.find(
        (p) => p.deliverableType === 'planning' && p.versionTag === 'v1'
      );
      if (planning) return planning;
    }
    return this.data.presentations.find(
      (p) => p.versionTag.toLowerCase() === norm || p.id.toLowerCase() === norm
    );
  }

  addPresentation(item: Omit<PresentationItem, 'id' | 'createdAt'>): PresentationItem {
    const newItem: PresentationItem = {
      ...item,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.data.presentations.unshift(newItem);

    this.addActivityLog(
      'admin',
      item.uploaderName || 'Admin',
      'UPLOAD_PRESENTATION',
      'presentation',
      newItem.id,
      `Uploaded presentation ${newItem.title} (${newItem.versionTag})`
    );

    this.saveDatabase();
    return newItem;
  }

  updatePresentation(id: string, updates: Partial<PresentationItem>): PresentationItem | null {
    const idx = this.data.presentations.findIndex((p) => p.id === id || p.versionTag.toLowerCase() === id.toLowerCase());
    if (idx === -1) return null;

    const old = this.data.presentations[idx];
    const updated: PresentationItem = {
      ...old,
      ...updates,
    };

    if (updates.status === 'published' && old.status !== 'published') {
      updated.publishedAt = new Date().toISOString();
    }

    this.data.presentations[idx] = updated;

    this.addActivityLog(
      'admin',
      'Admin',
      'UPDATE_PRESENTATION',
      'presentation',
      updated.id,
      `Updated presentation ${updated.title} (${updated.versionTag}) - Status: ${updated.status}`
    );

    this.saveDatabase();
    return updated;
  }

  deletePresentation(id: string): boolean {
    const target = this.data.presentations.find((p) => p.id === id || p.versionTag.toLowerCase() === id.toLowerCase());
    if (!target) return false;

    // Never delete baseline v1
    if (target.versionTag.toLowerCase() === 'v1' && target.deliverableType === 'planning') {
      return false;
    }

    this.data.presentations = this.data.presentations.filter((p) => p.id !== target.id);

    this.addActivityLog(
      'admin',
      'Admin',
      'DELETE_PRESENTATION',
      'presentation',
      target.id,
      `Deleted presentation ${target.title} (${target.versionTag})`
    );

    this.saveDatabase();
    return true;
  }

  // Resources Operations
  getResources(category?: string): Resource[] {
    if (category && category !== 'all') {
      const norm = category.toLowerCase().replace(/[^a-z0-9]/g, '');
      return this.data.resources.filter(
        (r) =>
          r.isPublished &&
          (r.category.toLowerCase().replace(/[^a-z0-9]/g, '') === norm ||
            (r.type && r.type.toLowerCase().replace(/[^a-z0-9]/g, '') === norm))
      );
    }
    return this.data.resources.filter((r) => r.isPublished);
  }

  getAllResourcesAdmin(): Resource[] {
    return this.data.resources;
  }

  addResource(resource: Omit<Resource, 'id' | 'createdAt'>): Resource {
    const newResource: Resource = {
      ...resource,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.data.resources.unshift(newResource);
    this.saveDatabase();
    return newResource;
  }

  updateResource(id: string, updates: Partial<Resource>): Resource | null {
    const idx = this.data.resources.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.data.resources[idx] = {
      ...this.data.resources[idx],
      ...updates,
    };
    this.saveDatabase();
    return this.data.resources[idx];
  }

  deleteResource(id: string): boolean {
    const initialLen = this.data.resources.length;
    this.data.resources = this.data.resources.filter((r) => r.id !== id);
    if (this.data.resources.length !== initialLen) {
      this.saveDatabase();
      return true;
    }
    return false;
  }

  // Team Members
  getTeamMembers(): TeamMember[] {
    return [...this.data.teamMembers].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  updateTeamMember(id: string, updates: Partial<TeamMember>): TeamMember | null {
    const idx = this.data.teamMembers.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.data.teamMembers[idx] = {
      ...this.data.teamMembers[idx],
      ...updates,
    };
    this.saveDatabase();
    return this.data.teamMembers[idx];
  }

  // Roadmap Milestones & Tasks
  private getDefaultTasksForMilestone(milestoneId: string): RoadmapTask[] {
    const now = '2026-08-18T00:00:00.000Z';
    switch (milestoneId) {
      case 'w1-2':
        return [
          {
            id: 'task-w1-2-1',
            phaseId: 'w1-2',
            title: 'Problem formulation and mathematical carbon intensity model',
            description: 'Literature review, mathematical model of carbon intensity and forecast error variance growth over time.',
            status: 'completed',
            completedAt: '2026-08-15',
            completedBy: 'Yuvika Nagpal',
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
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
            createdAt: now,
            updatedAt: now,
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
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w1-2-4',
            phaseId: 'w1-2',
            title: 'Initial simulator architecture specification',
            description: 'Draft mathematical formulation, discrete-event queue architecture, and trace interface spec.',
            status: 'in-progress',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w3-4':
        return [
          {
            id: 'task-w3-4-1',
            phaseId: 'w3-4',
            title: 'Discrete-event simulator core event loop',
            description: 'Build discrete-event simulation engine with job queues, regional clocks, and execution events.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w3-4-2',
            phaseId: 'w3-4',
            title: 'Multi-region cloud capacity and pricing models',
            description: 'Model spot and on-demand regional capacity constraints with dynamic pricing curves.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w3-4-3',
            phaseId: 'w3-4',
            title: 'Synthetic batch workload generators (short, medium, long jobs)',
            description: 'Generate synthetic batch workload traces with variable arrival rates, execution times, and resource profiles.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w5-6':
        return [
          {
            id: 'task-w5-6-1',
            phaseId: 'w5-6',
            title: 'Immediate Execution baseline scheduler',
            description: 'Implement baseline heuristic executing arriving batch jobs immediately without temporal shifting.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w5-6-2',
            phaseId: 'w5-6',
            title: 'Earliest Deadline First (EDF) scheduler',
            description: 'Implement priority-queue reference policy sorting workloads strictly by deadline urgency.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w5-6-3',
            phaseId: 'w5-6',
            title: 'Cost-Aware scheduling algorithm',
            description: 'Implement price-minimizing reference scheduler exploiting diurnal spot price arbitrage.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w5-6-4',
            phaseId: 'w5-6',
            title: 'Realized-Data Oracle upper-bound solver',
            description: 'Reference mathematical benchmark with omniscient knowledge of ground-truth future carbon realizations.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w7-8':
        return [
          {
            id: 'task-w7-8-1',
            phaseId: 'w7-8',
            title: 'Deterministic carbon-aware scheduling algorithm',
            description: 'Implement carbon intensity window optimizer minimizing total gCO2 under deterministic point forecasts.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w7-8-2',
            phaseId: 'w7-8',
            title: 'Multi-region spatial workload shifting strategies',
            description: 'Heuristic cross-region migration module shifting jobs to cleaner geographic grid zones.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w7-8-3',
            phaseId: 'w7-8',
            title: 'Trace alignment and grid intensity ingestion parser',
            description: 'Ingest and standardize 5-minute carbon intensity traces across multiple grid operators.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w9-10':
        return [
          {
            id: 'task-w9-10-1',
            phaseId: 'w9-10',
            title: 'Forecast uncertainty and error modelling engine',
            description: 'Model forecast error distributions across 1h to 48h look-ahead horizons capturing variance growth.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w9-10-2',
            phaseId: 'w9-10',
            title: 'Empirical multi-horizon error distribution models',
            description: 'Fit parametric and empirical error distributions against historical day-ahead forecast vs actuals.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w11-12':
        return [
          {
            id: 'task-w11-12-1',
            phaseId: 'w11-12',
            title: 'Uncertainty-aware scheduler enforcing P(violation) <= tau',
            description: 'Core CarbonRoute scheduling algorithm optimizing carbon while bounding deadline violation risk.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w11-12-2',
            phaseId: 'w11-12',
            title: 'Deadline-risk calibration module (Brier Score & Reliability Diagrams)',
            description: 'Probability calibration measuring Brier score and Reliability Diagrams to ensure sharpness.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w11-12-3',
            phaseId: 'w11-12',
            title: 'Expected Calibration Error (ECE) metric calculator',
            description: 'Quantify miscalibration across probability bins to prevent overconfident delay decisions.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w13':
        return [
          {
            id: 'task-w13-1',
            phaseId: 'w13',
            title: 'Renewable drop-off stress testing scenarios',
            description: 'Subject scheduling policies to severe solar/wind drop-offs and test fallback behaviors.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w13-2',
            phaseId: 'w13',
            title: 'Cloud capacity contention and spot preemption tests',
            description: 'Simulate regional compute saturation and evaluate deadline recovery effectiveness.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w14':
        return [
          {
            id: 'task-w14-1',
            phaseId: 'w14',
            title: 'FastAPI REST decision endpoints exposure',
            description: 'Expose REST endpoints for submitting batch workloads and retrieving scheduling decisions.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Aaneya Sabharwal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w14-2',
            phaseId: 'w14',
            title: 'Interactive scheduling dashboard and risk curve visualizer',
            description: 'Web dashboard integration for visualizing schedules, tail risk bounds, and regional curves.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Aaneya Sabharwal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w15':
        return [
          {
            id: 'task-w15-1',
            phaseId: 'w15',
            title: 'Large-scale repeated benchmark suite execution',
            description: 'Run automated repeated multi-seed evaluations across multiple grid regions and error profiles.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w15-2',
            phaseId: 'w15',
            title: 'Paired statistical significance tests',
            description: 'Compute Student t-tests and Wilcoxon signed-rank tests confirming CarbonRoute advantages.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w16':
        return [
          {
            id: 'task-w16-1',
            phaseId: 'w16',
            title: 'Containerized Kubernetes Job workload connector',
            description: 'Integrate connector dispatching scheduled batch jobs to Kubernetes Jobs with telemetry.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Aaneya Sabharwal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w16-2',
            phaseId: 'w16',
            title: 'End-to-end containerized runner verification',
            description: 'Smoke test end-to-end container execution, completion polling, and emission accounting.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Aaneya Sabharwal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      case 'w17':
        return [
          {
            id: 'task-w17-1',
            phaseId: 'w17',
            title: 'Final project thesis and comprehensive technical documentation',
            description: 'Complete final project report, architectural diagrams, empirical analysis, and defense thesis.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Yuvika Nagpal',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w17-2',
            phaseId: 'w17',
            title: 'University semester defense presentation and demo',
            description: 'Deliver final semester viva defense presentation with live interactive demonstration.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Kumkum Gupta',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-w17-3',
            phaseId: 'w17',
            title: 'Release artifact packaging and open-source publication',
            description: 'Publish final GitHub repository with documentation, reproduction scripts, and MIT license.',
            status: 'planned',
            completedAt: null,
            completedBy: null,
            assignedTo: 'Aaneya Sabharwal',
            createdAt: now,
            updatedAt: now,
          },
        ];
      default:
        return [];
    }
  }

  getRoadmapMilestones(): RoadmapMilestone[] {
    return [...this.data.roadmapMilestones].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  getRoadmapMilestoneById(id: string): RoadmapMilestone | undefined {
    return this.data.roadmapMilestones.find((m) => m.id === id);
  }

  updateRoadmapMilestone(id: string, updates: Partial<RoadmapMilestone>): RoadmapMilestone | null {
    const idx = this.data.roadmapMilestones.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    this.data.roadmapMilestones[idx] = {
      ...this.data.roadmapMilestones[idx],
      ...updates,
    };
    this.saveDatabase();
    return this.data.roadmapMilestones[idx];
  }

  getTaskById(taskId: string): { task: RoadmapTask; milestone: RoadmapMilestone } | null {
    for (const milestone of this.data.roadmapMilestones) {
      if (!milestone.tasks) continue;
      const task = milestone.tasks.find((t) => t.id === taskId);
      if (task) {
        return { task, milestone };
      }
    }
    return null;
  }

  updateRoadmapTask(
    taskId: string,
    updates: Partial<RoadmapTask>,
    performedBy: string = 'System'
  ): { task: RoadmapTask; milestone: RoadmapMilestone } | null {
    for (let mIdx = 0; mIdx < this.data.roadmapMilestones.length; mIdx++) {
      const milestone = this.data.roadmapMilestones[mIdx];
      if (!milestone.tasks) continue;

      const tIdx = milestone.tasks.findIndex((t) => t.id === taskId);
      if (tIdx !== -1) {
        const existingTask = milestone.tasks[tIdx];
        const now = new Date().toISOString();

        const updatedTask: RoadmapTask = {
          ...existingTask,
          ...updates,
          updatedAt: now,
        };

        // If marked completed and completedAt is not set, set it to today (YYYY-MM-DD)
        if (updatedTask.status === 'completed' && !updatedTask.completedAt) {
          updatedTask.completedAt = now.split('T')[0];
        }

        // If marked completed and completedBy is not set, use performedBy if not System
        if (updatedTask.status === 'completed' && !updatedTask.completedBy) {
          updatedTask.completedBy = performedBy !== 'System' ? performedBy : 'Team Member';
        }

        // If moved away from completed, clear completion details unless explicitly provided
        if (existingTask.status === 'completed' && updatedTask.status !== 'completed' && updates.completedAt === undefined) {
          updatedTask.completedAt = null;
        }

        milestone.tasks[tIdx] = updatedTask;

        // Auto-update parent milestone status based on task completion
        const allCompleted = milestone.tasks.every((t) => t.status === 'completed');
        const anyActive = milestone.tasks.some((t) => t.status === 'completed' || t.status === 'in-progress');

        if (allCompleted && milestone.tasks.length > 0) {
          milestone.status = 'completed';
        } else if (anyActive) {
          milestone.status = 'in-progress';
        } else {
          milestone.status = 'planned';
        }

        this.addAuditLog(
          'UPDATE_ROADMAP_TASK',
          'RoadmapTask',
          taskId,
          `Task "${updatedTask.title}" in ${milestone.weekRange} updated to ${updatedTask.status}`,
          performedBy
        );

        this.saveDatabase();
        return { task: updatedTask, milestone };
      }
    }
    return null;
  }

  addTask(
    phaseId: string,
    taskData: Omit<RoadmapTask, 'id' | 'phaseId' | 'createdAt' | 'updatedAt'>,
    performedBy: string = 'System'
  ): { task: RoadmapTask; milestone: RoadmapMilestone } | null {
    const milestone = this.data.roadmapMilestones.find((m) => m.id === phaseId);
    if (!milestone) return null;

    if (!milestone.tasks) {
      milestone.tasks = [];
    }

    const now = new Date().toISOString();
    const newTask: RoadmapTask = {
      id: `task-${phaseId}-${uuidv4().substring(0, 8)}`,
      phaseId,
      title: taskData.title,
      description: taskData.description || '',
      status: taskData.status || 'planned',
      completedAt: taskData.completedAt || (taskData.status === 'completed' ? now.split('T')[0] : null),
      completedBy: taskData.completedBy || (taskData.status === 'completed' ? performedBy : null),
      assignedTo: taskData.assignedTo || null,
      createdAt: now,
      updatedAt: now,
    };

    milestone.tasks.push(newTask);

    this.addAuditLog(
      'CREATE_ROADMAP_TASK',
      'RoadmapTask',
      newTask.id,
      `Task "${newTask.title}" added to ${milestone.weekRange}`,
      performedBy
    );

    this.saveDatabase();
    return { task: newTask, milestone };
  }

  deleteTask(taskId: string, performedBy: string = 'System'): boolean {
    for (const milestone of this.data.roadmapMilestones) {
      if (!milestone.tasks) continue;
      const tIdx = milestone.tasks.findIndex((t) => t.id === taskId);
      if (tIdx !== -1) {
        const [deleted] = milestone.tasks.splice(tIdx, 1);
        this.addAuditLog(
          'DELETE_ROADMAP_TASK',
          'RoadmapTask',
          taskId,
          `Task "${deleted.title}" deleted from ${milestone.weekRange}`,
          performedBy
        );
        this.saveDatabase();
        return true;
      }
    }
    return false;
  }

  // Activity Log
  addActivityLog(
    userId: string,
    userName: string,
    action: string,
    entityType: ActivityLog['entityType'],
    entityId: string,
    details: string
  ): void {
    this.data.activityLogs.unshift({
      id: uuidv4(),
      userId,
      userName,
      action,
      entityType,
      entityId,
      details,
      timestamp: new Date().toISOString(),
    });
    this.saveDatabase();
  }

  addAuditLog(
    action: string,
    entityType: string,
    entityId: string,
    details: string,
    performedBy: string = 'System'
  ): void {
    this.data.activityLogs.unshift({
      id: uuidv4(),
      userId: performedBy,
      userName: performedBy,
      action,
      entityType: entityType as any,
      entityId,
      details,
      timestamp: new Date().toISOString(),
    });
    this.saveDatabase();
  }

  getActivityLogs(): ActivityLog[] {
    return this.data.activityLogs.slice(0, 50);
  }

  getAuditLogs(): ActivityLog[] {
    return this.data.activityLogs.slice(0, 50);
  }
}

export const db = new JsonDatabase();
