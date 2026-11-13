import { internalError } from '../utils/httpErrors';
import path from 'path';
import { Request, Response } from 'express';
import { db } from '../models/db';
import { storageProvider } from '../storage/storageProvider';
import { AuthRequest } from '../middleware/auth';

export const getResources = (req: Request, res: Response) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const resources = db.getResources(category).filter((r) => r.isPublished);

  return res.json({
    success: true,
    data: resources,
  });
};

export const getAllResourcesAdmin = (req: AuthRequest, res: Response) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const resources = db.getAllResourcesAdmin();

  return res.json({
    success: true,
    data: resources,
  });
};

export const createResource = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file was uploaded.',
      });
    }

    const { title, category, description, isPublished, authors, version, date, type, format } = req.body;

    if (!title || !category) {
      return res.status(400).json({
        success: false,
        message: 'Title and category are required.',
      });
    }

    const stored = await storageProvider.saveFile(file, 'resources');

    // Determine format from extension / mimetype if not explicitly passed
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    let resolvedFormat = format || ext;
    if (file.mimetype?.includes('pdf') || ext === 'pdf') resolvedFormat = 'pdf';
    else if (file.mimetype?.includes('word') || ext === 'docx' || ext === 'doc') resolvedFormat = 'docx';
    else if (file.mimetype?.includes('sheet') || ext === 'xlsx' || ext === 'xls') resolvedFormat = 'xlsx';
    else if (file.mimetype?.includes('presentation') || ext === 'ppt' || ext === 'pptx') resolvedFormat = 'ppt';
    else if (file.mimetype?.includes('zip') || ext === 'zip') resolvedFormat = 'zip';
    else if (file.mimetype?.includes('json') || ext === 'json') resolvedFormat = 'json';

    const newResource = db.addResource({
      title: String(title).trim(),
      category: String(category).trim(),
      description: description ? String(description).trim() : '',
      fileName: stored.fileName,
      filePath: stored.filePath,
      fileSize: stored.fileSize,
      mimeType: stored.mimeType,
      fileUrl: stored.fileUrl,
      isPublished: isPublished === undefined || isPublished === 'true' || isPublished === true,
      authors: authors ? String(authors).trim() : (req.user?.username || 'Team TriFlux'),
      version: version ? String(version).trim() : 'v1.0',
      date: date ? String(date).trim() : new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      type: type ? String(type).trim() : String(category),
      format: resolvedFormat,
    });

    db.addAuditLog(
      'CREATE_RESOURCE',
      'Resource',
      newResource.id,
      `Resource uploaded: ${title} (${category})`,
      req.user ? req.user.username : 'System'
    );

    return res.status(201).json({
      success: true,
      message: 'Resource uploaded successfully.',
      data: newResource,
    });
  } catch (error: any) {
    return internalError(res, error, 'Error creating resource', 'Failed to upload the resource.');
  }
};

export const updateResource = (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const updates = req.body;
  const updated = db.updateResource(id, updates);

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: 'Resource not found.',
    });
  }

  db.addAuditLog(
    'UPDATE_RESOURCE',
    'Resource',
    id,
    `Resource updated: ${updated.title}`,
    req.user ? req.user.username : 'System'
  );

  return res.json({
    success: true,
    message: 'Resource updated successfully.',
    data: updated,
  });
};

export const deleteResource = (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const deleted = db.deleteResource(id);

  if (!deleted) {
    return res.status(404).json({
      success: false,
      message: 'Resource not found.',
    });
  }

  db.addAuditLog(
    'DELETE_RESOURCE',
    'Resource',
    id,
    `Resource deleted: ${id}`,
    req.user ? req.user.username : 'System'
  );

  return res.json({
    success: true,
    message: 'Resource deleted successfully.',
  });
};
