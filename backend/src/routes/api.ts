import { Router } from 'express';
import { login, getMe, logout } from '../controllers/authController';
import {
  getPresentations,
  getAllVersions,
  getPresentationByVersion,
  createPresentationVersion,
  updatePresentationVersion,
  deletePresentationVersion,
} from '../controllers/presentationController';
import {
  getResources,
  getAllResourcesAdmin,
  createResource,
  updateResource,
  deleteResource,
} from '../controllers/resourceController';
import { getTeam, updateTeamMember } from '../controllers/teamController';
import {
  getRoadmap,
  getRoadmapTask,
  updateRoadmapTask,
  markTaskCompleted,
  createRoadmapTask,
  deleteRoadmapTask,
  updateRoadmapMilestone,
} from '../controllers/roadmapController';
import { serveFile } from '../controllers/storageController';
import { simulateFeasibilityDecision } from '../controllers/schedulerController';
import {
  submitJob,
  scheduleJob,
  getJobStatus,
  getJobResults,
  getJobManifest,
  dispatchJobToExecution,
  getCarbonForecast,
  getAvailableRegions,
  getClusterHealth,
  recordExperiment,
  getExperiments,
  collectJobObservations,
  getJobObservations,
  getJobReport,
  getCarbonLatest,
  getCarbonHistory,
  getCarbonForecastSnapshot,
  getCarbonPowerBreakdown,
  getCarbonProviderStatus,
  listJobs,
  getJobDetails,
  cancelJob,
} from '../controllers/prototypeController';
import { requireJobAccess } from '../services/jobAccess';
import { authenticateToken, requireAdmin, requireTeamMemberOrAdmin, optionalAuth } from '../middleware/auth';
import { uploadMiddleware } from '../middleware/upload';
import { db } from '../models/db';

const router = Router();

// Health Check
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'CarbonRoute Platform Backend',
  });
});

// Storage File Serving / Download
router.get('/storage/:category/:fileName', serveFile);

// Authentication Routes
router.post('/auth/login', login);
router.post('/auth/logout', optionalAuth, logout);
router.get('/auth/me', authenticateToken, getMe);

// Presentations & Versioning Routes
router.get('/presentations', getPresentations);
router.get('/presentations/versions', optionalAuth, getAllVersions);
router.get('/presentations/v/:versionTag', getPresentationByVersion);
router.post(
  '/presentations/upload',
  authenticateToken,
  requireAdmin,
  uploadMiddleware.single('file'),
  createPresentationVersion
);
router.put('/presentations/versions/:id', authenticateToken, requireAdmin, updatePresentationVersion);
router.delete('/presentations/versions/:id', authenticateToken, requireAdmin, deletePresentationVersion);

// Resources Library Routes
router.get('/resources', getResources);
router.get('/resources/all', authenticateToken, requireAdmin, getAllResourcesAdmin);
router.post(
  '/resources/upload',
  authenticateToken,
  requireAdmin,
  uploadMiddleware.single('file'),
  createResource
);
router.put('/resources/:id', authenticateToken, requireAdmin, updateResource);
router.delete('/resources/:id', authenticateToken, requireAdmin, deleteResource);

// Team Members Routes
router.get('/team', getTeam);
router.put('/team/:id', authenticateToken, requireAdmin, updateTeamMember);

// Project Roadmap Routes
router.get('/roadmap', getRoadmap);
router.get('/roadmap/tasks/:id', getRoadmapTask);
router.put('/roadmap/tasks/:id', authenticateToken, requireTeamMemberOrAdmin, updateRoadmapTask);
router.patch('/roadmap/tasks/:id/complete', authenticateToken, requireTeamMemberOrAdmin, markTaskCompleted);
router.post('/roadmap/phases/:phaseId/tasks', authenticateToken, requireTeamMemberOrAdmin, createRoadmapTask);
router.delete('/roadmap/tasks/:id', authenticateToken, requireTeamMemberOrAdmin, deleteRoadmapTask);
router.put('/roadmap/:id', authenticateToken, requireTeamMemberOrAdmin, updateRoadmapMilestone);

// Feasibility Simulation Demonstration API
router.post('/scheduler/simulate', simulateFeasibilityDecision);

// ==========================================
// CarbonRoute Prototype Milestone API Routes
// ==========================================
//
// Job routes (M1.2): every route requires a valid access token. Routes with a job id also
// require access to that job (its owner, or an administrator); otherwise 404.
const jobAccess = [authenticateToken, requireJobAccess];
router.get('/jobs', authenticateToken, listJobs);
router.post('/jobs', authenticateToken, submitJob);
router.post('/schedule', authenticateToken, scheduleJob);
router.get('/jobs/:id', ...jobAccess, getJobDetails);
router.get('/jobs/:id/status', ...jobAccess, getJobStatus);
router.get('/jobs/:id/results', ...jobAccess, getJobResults);
router.get('/jobs/:id/manifest', ...jobAccess, getJobManifest);
router.post('/jobs/:id/dispatch', ...jobAccess, dispatchJobToExecution);
router.post('/jobs/:id/cancel', ...jobAccess, cancelJob);
router.post('/jobs/:id/observations', ...jobAccess, collectJobObservations);
router.get('/jobs/:id/observations', ...jobAccess, getJobObservations);
router.get('/jobs/:id/report', ...jobAccess, getJobReport);

router.get('/carbon/forecast', getCarbonForecast);
router.get('/carbon/forecast/snapshot', getCarbonForecastSnapshot);
router.get('/carbon/latest', getCarbonLatest);
router.get('/carbon/history', getCarbonHistory);
router.get('/carbon/power-breakdown', getCarbonPowerBreakdown);
router.get('/carbon/provider', getCarbonProviderStatus);
router.get('/carbon/regions', getAvailableRegions);
router.get('/cluster/health', getClusterHealth);

router.post('/experiments', authenticateToken, recordExperiment);
router.get('/experiments', authenticateToken, getExperiments);

// Audit Logs (Admin only)
router.get('/admin/audit-logs', authenticateToken, requireAdmin, (_req, res) => {
  res.json({
    success: true,
    data: db.getAuditLogs(),
  });
});

export default router;
