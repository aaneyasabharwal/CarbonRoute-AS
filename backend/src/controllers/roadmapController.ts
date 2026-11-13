import { internalError } from '../utils/httpErrors';
import { Request, Response } from 'express';
import { db, TaskStatus } from '../models/db';
import { AuthRequest } from '../middleware/auth';

const VALID_STATUSES: TaskStatus[] = ['planned', 'in-progress', 'completed', 'blocked'];

export const getRoadmap = (_req: Request, res: Response) => {
  try {
    const milestones = db.getRoadmapMilestones();
    return res.json({
      success: true,
      data: milestones,
    });
  } catch (err: any) {
    return internalError(res, err, 'Error reading roadmap', 'Failed to retrieve the roadmap.');
  }
};

export const getRoadmapTask = (req: Request, res: Response) => {
  const taskId = String(req.params.id).trim();
  if (!taskId) {
    return res.status(400).json({
      success: false,
      message: 'Task ID is required.',
    });
  }

  const result = db.getTaskById(taskId);
  if (!result) {
    return res.status(404).json({
      success: false,
      message: `Roadmap task with ID "${taskId}" not found.`,
    });
  }

  return res.json({
    success: true,
    data: result,
  });
};

export const updateRoadmapTask = (req: AuthRequest, res: Response) => {
  const taskId = String(req.params.id).trim();
  if (!taskId) {
    return res.status(400).json({
      success: false,
      message: 'Task ID is required.',
    });
  }

  const { status, title, description, completedAt, completedBy, assignedTo } = req.body;

  // Validate status if provided
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status "${status}". Allowed values: ${VALID_STATUSES.join(', ')}.`,
    });
  }

  const performedBy = req.user ? req.user.username : 'Team Member';

  const updates: Record<string, any> = {};
  if (status !== undefined) updates.status = status;
  if (title !== undefined) updates.title = String(title).trim();
  if (description !== undefined) updates.description = String(description).trim();
  if (completedAt !== undefined) updates.completedAt = completedAt ? String(completedAt).trim() : null;
  if (completedBy !== undefined) updates.completedBy = completedBy ? String(completedBy).trim() : null;
  if (assignedTo !== undefined) updates.assignedTo = assignedTo ? String(assignedTo).trim() : null;

  const result = db.updateRoadmapTask(taskId, updates, performedBy);
  if (!result) {
    return res.status(404).json({
      success: false,
      message: `Roadmap task with ID "${taskId}" not found.`,
    });
  }

  return res.json({
    success: true,
    message: `Task "${result.task.title}" updated successfully.`,
    data: result,
  });
};

export const markTaskCompleted = (req: AuthRequest, res: Response) => {
  const taskId = String(req.params.id).trim();
  if (!taskId) {
    return res.status(400).json({
      success: false,
      message: 'Task ID is required.',
    });
  }

  const existing = db.getTaskById(taskId);
  if (!existing) {
    return res.status(404).json({
      success: false,
      message: `Roadmap task with ID "${taskId}" not found.`,
    });
  }

  const { completedBy, completionDate } = req.body;
  const performedBy = req.user ? req.user.username : 'Team Member';
  const resolvedDate = completionDate ? String(completionDate).trim() : new Date().toISOString().split('T')[0];
  const resolvedContributor = completedBy ? String(completedBy).trim() : (req.user ? req.user.username : 'Team Member');

  const result = db.updateRoadmapTask(
    taskId,
    {
      status: 'completed',
      completedAt: resolvedDate,
      completedBy: resolvedContributor,
    },
    performedBy
  );

  if (!result) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update task completion.',
    });
  }

  return res.json({
    success: true,
    message: `Task "${result.task.title}" marked as Completed.`,
    data: result,
  });
};

export const createRoadmapTask = (req: AuthRequest, res: Response) => {
  const phaseId = String(req.params.phaseId).trim();
  const { title, description, status, assignedTo, completedAt, completedBy } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({
      success: false,
      message: 'Task title is required.',
    });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status "${status}". Allowed values: ${VALID_STATUSES.join(', ')}.`,
    });
  }

  const performedBy = req.user ? req.user.username : 'Team Member';
  const result = db.addTask(
    phaseId,
    {
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      status: status || 'planned',
      assignedTo: assignedTo ? String(assignedTo).trim() : null,
      completedAt: completedAt ? String(completedAt).trim() : null,
      completedBy: completedBy ? String(completedBy).trim() : null,
    },
    performedBy
  );

  if (!result) {
    return res.status(404).json({
      success: false,
      message: `Roadmap phase with ID "${phaseId}" not found.`,
    });
  }

  return res.status(201).json({
    success: true,
    message: `Task "${result.task.title}" created successfully.`,
    data: result,
  });
};

export const deleteRoadmapTask = (req: AuthRequest, res: Response) => {
  const taskId = String(req.params.id).trim();
  if (!taskId) {
    return res.status(400).json({
      success: false,
      message: 'Task ID is required.',
    });
  }

  const performedBy = req.user ? req.user.username : 'Team Member';
  const deleted = db.deleteTask(taskId, performedBy);
  if (!deleted) {
    return res.status(404).json({
      success: false,
      message: `Roadmap task with ID "${taskId}" not found.`,
    });
  }

  return res.json({
    success: true,
    message: 'Roadmap task deleted successfully.',
  });
};

export const updateRoadmapMilestone = (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const { status, title, description, startDate, targetDate, deliverables, dependencies } = req.body;

  const updated = db.updateRoadmapMilestone(id, {
    ...(status !== undefined && { status }),
    ...(title !== undefined && { title: String(title) }),
    ...(description !== undefined && { description: String(description) }),
    ...(startDate !== undefined && { startDate: String(startDate) }),
    ...(targetDate !== undefined && { targetDate: String(targetDate) }),
    ...(deliverables !== undefined && { deliverables }),
    ...(dependencies !== undefined && { dependencies }),
  });

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: 'Roadmap milestone not found.',
    });
  }

  db.addAuditLog(
    'UPDATE_ROADMAP_MILESTONE',
    'RoadmapMilestone',
    id,
    `Updated ${updated.phaseName || updated.weekRange}: status set to ${updated.status}`,
    req.user ? req.user.username : 'System'
  );

  return res.json({
    success: true,
    message: `Milestone ${updated.phaseName || updated.weekRange} updated successfully.`,
    data: updated,
  });
};
