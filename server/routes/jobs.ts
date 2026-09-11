import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  getAllJobs,
  getJobById,
  insertJob,
  updateJob,
  deleteJob,
  getNextToken,
  getPricingSettings,
  getEffectivePricing,
} from '../db.js';
import { uploadMiddleware, deletePhysicalFile, cleanupExpiredFiles } from '../storageService.js';
import { detectPageCount } from '../pdfService.js';
import { calculatePrintCost } from '../../shared/costCalculator.js';
import { PrintJob, ColorMode, SidesMode, OrientationMode } from '../../shared/types.js';

export function createJobsRouter(broadcast: (message: any) => void) {
  const router = Router();

  // Custom upload middleware with clean JSON error handling
  const handleUpload = (req: Request, res: Response, next: () => void) => {
    uploadMiddleware.single('file')(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds maximum allowed limit of 50MB' });
          }
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ error: err.message || 'Invalid file uploaded' });
      }
      next();
    });
  };

  // GET /api/jobs
  router.get('/', (_req: Request, res: Response) => {
    try {
      const jobs = getAllJobs();
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/jobs/:id
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const job = getJobById(id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/jobs/:id/file - Stream file for in-browser preview
  router.get('/:id/file', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const job = getJobById(id);
      if (!job || !job.file_path || !fs.existsSync(job.file_path)) {
        return res.status(404).json({ error: 'Document file not found on disk' });
      }

      let contentType = job.mime_type;
      const ext = path.extname(job.original_filename || job.file_path).toLowerCase();
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';

      const safeAsciiName = path.basename(job.original_filename).replace(/[^\w.-]/g, '_');
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(job.original_filename)}`
      );

      res.sendFile(path.resolve(job.file_path));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/jobs - Customer uploads a print job
  router.post('/', handleUpload, async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No document file uploaded' });
      }

      const customerName = (req.body.customerName || req.body.customer_name || 'Walk-in Customer').trim();
      const colorMode: ColorMode = req.body.colorMode === 'color' ? 'color' : 'bw';
      const sides: SidesMode = req.body.sides === 'duplex' ? 'duplex' : 'single';
      const orientation: OrientationMode =
        req.body.orientation === 'landscape' || req.body.orientation === 'portrait'
          ? req.body.orientation
          : 'auto';
      const copies = Math.max(1, parseInt(req.body.copies, 10) || 1);
      const pageRange = (req.body.pageRange || req.body.page_range || 'all').trim();

      // Detect total pages in document using authoritative server inspection
      let totalPages = await detectPageCount(file.path, file.mimetype);
      // Only if server detection could not determine pages (> 1) and client provided a positive count hint
      if (totalPages <= 1 && req.body.pageCount) {
        const clientCount = parseInt(req.body.pageCount, 10);
        if (!isNaN(clientCount) && clientCount > 1) {
          totalPages = clientCount;
        }
      }

      // Calculate cost using lowest available active printer pricing
      const pricing = getEffectivePricing();

      // Sanitize color and duplex against active printer capabilities
      let finalColorMode: ColorMode = colorMode;
      let finalSides: SidesMode = sides;
      if (!pricing.color_available && finalColorMode === 'color') {
        finalColorMode = 'bw';
      }
      if (!pricing.duplex_available && finalSides === 'duplex') {
        finalSides = 'single';
      }

      const costResult = calculatePrintCost({
        totalPages,
        pageRange,
        colorMode: finalColorMode,
        sides: finalSides,
        copies,
        pricing,
      });

      const token = getNextToken();
      const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const newJob: PrintJob = {
        id,
        token,
        customer_name: customerName,
        original_filename: file.originalname,
        stored_filename: file.filename,
        file_path: file.path,
        file_size: file.size,
        mime_type: file.mimetype,
        page_count: totalPages,
        color_mode: finalColorMode,
        sides: finalSides,
        orientation,
        copies,
        page_range: pageRange,
        effective_pages: costResult.effectivePages,
        estimated_cost: costResult.totalCost,
        status: 'pending',
        created_at: new Date().toISOString(),
        printed_at: null,
        printer_name: null,
        cups_job_id: null,
      };

      insertJob(newJob);

      // Real-time broadcast to all connected Admin PCs
      broadcast({
        type: 'JOB_CREATED',
        job: newJob,
      });

      res.status(201).json({
        success: true,
        job: newJob,
        costBreakdown: costResult,
      });
    } catch (err: any) {
      console.error('[JobsRoute] Upload error:', err);
      if (req.file?.path) {
        deletePhysicalFile(req.file.path);
      }
      res.status(500).json({ error: err.message || 'Failed to submit print job' });
    }
  });

  // PATCH /api/jobs/:id - Update job (e.g. status, options, copies)
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = getJobById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const updates: Partial<PrintJob> = {};

      if (req.body.status) updates.status = req.body.status;
      if (req.body.customer_name) updates.customer_name = req.body.customer_name;
      if (req.body.color_mode) updates.color_mode = req.body.color_mode;
      if (req.body.sides) updates.sides = req.body.sides;
      if (req.body.orientation) updates.orientation = req.body.orientation;
      if (req.body.copies) updates.copies = Math.max(1, parseInt(req.body.copies, 10));
      if (req.body.page_range !== undefined) updates.page_range = req.body.page_range;
      if (req.body.printer_name !== undefined) updates.printer_name = req.body.printer_name;

      if (req.body.status === 'printed' && !existing.printed_at) {
        updates.printed_at = new Date().toISOString();
      } else if (req.body.status === 'pending') {
        updates.printed_at = null;
      }

      // Recalculate cost if options changed
      if (
        updates.color_mode ||
        updates.sides ||
        updates.copies ||
        updates.page_range !== undefined
      ) {
        const pricing = getEffectivePricing();
        const costResult = calculatePrintCost({
          totalPages: existing.page_count,
          pageRange: updates.page_range ?? existing.page_range,
          colorMode: updates.color_mode ?? existing.color_mode,
          sides: updates.sides ?? existing.sides,
          copies: updates.copies ?? existing.copies,
          pricing,
        });
        updates.effective_pages = costResult.effectivePages;
        updates.estimated_cost = costResult.totalCost;
      }

      const updated = updateJob(id, updates);

      broadcast({
        type: 'JOB_UPDATED',
        job: updated,
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/jobs/:id - Delete job and unlink file
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = getJobById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (existing.file_path) {
        deletePhysicalFile(existing.file_path);
      }

      deleteJob(id);

      broadcast({
        type: 'JOB_DELETED',
        id,
      });

      res.json({ success: true, message: 'Job and associated file deleted' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/jobs/cleanup - Manually trigger retention sweep
  router.post('/cleanup', (_req: Request, res: Response) => {
    try {
      const result = cleanupExpiredFiles();
      broadcast({
        type: 'JOBS_REFRESH',
      });
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
