import { Request, Response } from 'express';
import { storageProvider, safeStorageRef } from '../storage/storageProvider';
import mime from 'mime-types';

export const serveFile = async (req: Request, res: Response) => {
  try {
    const category = String(req.params.category || '');
    const fileName = String(req.params.fileName || '');

    if (!category || !fileName) {
      return res.status(400).send('Category and fileName are required.');
    }
    // S1 / M1.5: reject unknown categories and any path-like file name before touching storage.
    // Answered like a missing file so storage layout is not revealed.
    try {
      safeStorageRef(category, fileName);
    } catch {
      return res.status(404).json({
        success: false,
        message: 'The requested file does not exist or has been removed from storage.',
      });
    }
    // Header-safe copy of the name for Content-Disposition.
    const headerName = fileName.replace(/["\\\r\n]/g, '_');

    const { stream, fileSize } = await storageProvider.getFileStream(category, fileName);

    const lookupMime = mime.lookup(fileName) || 'application/octet-stream';
    res.setHeader('Content-Type', lookupMime);
    if (fileSize) {
      res.setHeader('Content-Length', fileSize.toString());
    }

    // Explicitly allow cross-origin embedding for PDF previews in iframes
    res.removeHeader('X-Frame-Options');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${headerName}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${headerName}"`);
    }

    return stream.pipe(res);
  } catch (error: any) {
    if (error?.name !== 'StorageAccessError') console.error('File serve error:', error?.message || error);
    return res.status(404).json({
      success: false,
      message: 'The requested file does not exist or has been removed from storage.',
    });
  }
};
