import { internalError } from '../utils/httpErrors';
import { Request, Response } from 'express';
import { db, DeliverableType, PresentationStatus } from '../models/db';
import { storageProvider } from '../storage/storageProvider';
import { AuthRequest } from '../middleware/auth';

export const getPresentations = (req: Request, res: Response) => {
  const includeDrafts = req.query.includeDrafts === 'true';
  const presentations = db.getPresentations(includeDrafts);

  // Group by deliverableType or return all presentation deliverables
  return res.json({
    success: true,
    data: presentations,
  });
};

export const getAllVersions = (req: AuthRequest, res: Response) => {
  const presentations = db.getPresentations(true);

  return res.json({
    success: true,
    data: presentations,
  });
};

export const getPresentationByVersion = (req: Request, res: Response) => {
  const versionTag = String(req.params.versionTag || '').toLowerCase().trim();
  if (!versionTag) {
    return res.status(400).json({
      success: false,
      message: 'Version tag is required.',
    });
  }

  const presentation = db.getPresentationByVersion(versionTag);
  if (!presentation) {
    return res.status(404).json({
      success: false,
      message: `Presentation version "${versionTag}" was not found.`,
    });
  }

  // Get all published versions of the same deliverable type
  const allVersions = db
    .getPresentations(false)
    .filter((p) => p.deliverableType === presentation.deliverableType)
    .map((p) => ({
      id: p.id,
      versionTag: p.versionTag,
      title: p.title,
      presentationDate: p.presentationDate,
      changeSummary: p.changeSummary,
      status: p.status,
      createdAt: p.createdAt,
    }));

  return res.json({
    success: true,
    data: {
      ...presentation,
      allVersions,
    },
  });
};

export const createPresentationVersion = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No presentation file was uploaded. Please attach a PDF or PPTX file.',
      });
    }

    const {
      title,
      deliverableType = 'planning',
      versionTag,
      presentationDate,
      description = '',
      changeSummary = '',
      authors = 'Yuvika Nagpal, Kumkum Gupta, Aaneya Sabharwal',
      status = 'published',
      previousVersionId,
    } = req.body;

    if (!title || !versionTag || !presentationDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: Title, Version, and Date are mandatory.',
      });
    }

    const normalizedTag = String(versionTag).trim().toLowerCase();

    // Check if duplicate version tag exists
    const existing = db.getPresentationByVersion(normalizedTag);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Version "${versionTag}" already exists. Previous versions are permanently preserved and cannot be overwritten. Please provide a distinct version tag (e.g. v2, v3, midterm).`,
      });
    }

    const stored = await storageProvider.saveFile(file, 'presentations');

    const authorsList = typeof authors === 'string'
      ? authors.split(',').map((a) => a.trim()).filter(Boolean)
      : Array.isArray(authors)
      ? authors
      : ['Yuvika Nagpal', 'Kumkum Gupta', 'Aaneya Sabharwal'];

    const presStatus: PresentationStatus =
      status === 'draft' ? 'draft' : status === 'archived' ? 'archived' : 'published';

    const newPresentation = db.addPresentation({
      title: String(title),
      deliverableType: (deliverableType as DeliverableType) || 'planning',
      versionTag: normalizedTag,
      description: String(description),
      fileName: stored.fileName,
      filePath: stored.filePath,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      fileUrl: stored.fileUrl,
      authors: authorsList,
      uploaderName: req.user ? req.user.username : 'CarbonRoute Team',
      status: presStatus,
      presentationDate: String(presentationDate),
      sha256Checksum: stored.sha256Checksum,
      changeSummary: String(changeSummary),
      previousVersionId: previousVersionId ? String(previousVersionId) : undefined,
      publishedAt: presStatus === 'published' ? new Date().toISOString() : undefined,
    });

    return res.status(201).json({
      success: true,
      message: `Presentation "${title}" (${normalizedTag.toUpperCase()}) published and permanently registered.`,
      data: newPresentation,
    });
  } catch (error: any) {
    return internalError(res, error, 'Error creating presentation version', 'Failed to upload and register the presentation version.');
  }
};

export const updatePresentationVersion = (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const { title, description, changeSummary, status, presentationDate, authors } = req.body;

  const updates: any = {};
  if (title !== undefined) updates.title = String(title);
  if (description !== undefined) updates.description = String(description);
  if (changeSummary !== undefined) updates.changeSummary = String(changeSummary);
  if (status !== undefined) updates.status = status;
  if (presentationDate !== undefined) updates.presentationDate = String(presentationDate);
  if (authors !== undefined) {
    updates.authors = typeof authors === 'string'
      ? authors.split(',').map((a) => a.trim()).filter(Boolean)
      : authors;
  }

  const updated = db.updatePresentation(id, updates);
  if (!updated) {
    return res.status(404).json({
      success: false,
      message: 'Presentation version not found.',
    });
  }

  return res.json({
    success: true,
    message: 'Presentation metadata updated successfully.',
    data: updated,
  });
};

export const deletePresentationVersion = (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const target = db.getPresentationById(id);

  if (!target) {
    return res.status(404).json({
      success: false,
      message: 'Presentation version not found.',
    });
  }

  const deleted = db.deletePresentation(id);
  if (!deleted) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete presentation version.',
    });
  }

  return res.json({
    success: true,
    message: `Presentation version ${target.versionTag.toUpperCase()} removed from active registry.`,
  });
};
