import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  getAllJobs,
  getJobById,
  getJobByToken,
  insertJob,
  insertJobWithFiles,
  getJobFiles,
  getJobFileById,
  updateJobFile,
  updateJob,
  deleteJob,
  getNextToken,
  getPricingSettings,
  getEffectivePricing,
} from '../db.js';
import { uploadMiddleware, deletePhysicalFile, cleanupExpiredFiles } from '../storageService.js';
import { detectPageCount } from '../pdfService.js';
import { calculatePrintCost } from '../../shared/costCalculator.js';
import { PrintJob, JobFile, ColorMode, SidesMode, OrientationMode } from '../../shared/types.js';
import { notifyWhatsAppJobPrinting, notifyWhatsAppJobCompleted, sendWhatsAppOrderUpdateNotification, formatPageRangeString } from '../whatsappService.js';

export function createJobsRouter(broadcast: (message: any) => void) {
  const router = Router();

  // Custom upload middleware supporting both multi-file and single-file uploads with clean JSON error handling
  const handleUpload = (req: Request, res: Response, next: () => void) => {
    uploadMiddleware.any()(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File size exceeds maximum allowed limit of 100MB' });
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

  // GET /api/jobs/token/:token - Lookup job by token (e.g. #P-101 or P-101)
  router.get('/token/:token', (req: Request, res: Response) => {
    try {
      const token = String(req.params.token);
      const job = getJobByToken(token);
      if (!job) {
        return res.status(404).json({ error: 'Job not found for token' });
      }
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/jobs/:id/file - Stream first / primary document file
  router.get('/:id/file', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const job = getJobById(id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // If job has files array, pick first file, else fallback to job.file_path
      const targetPath = job.files && job.files.length > 0 ? job.files[0].file_path : job.file_path;
      const targetName = job.files && job.files.length > 0 ? job.files[0].original_filename : job.original_filename;
      const targetMime = job.files && job.files.length > 0 ? job.files[0].mime_type : job.mime_type;

      if (!targetPath || !fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'Document file not found on disk' });
      }

      let contentType = targetMime;
      const ext = path.extname(targetName || targetPath).toLowerCase();
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';

      const safeAsciiName = path.basename(targetName).replace(/[^\w.-]/g, '_');
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(targetName)}`
      );

      res.sendFile(path.resolve(targetPath));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/jobs/:id/files/:fileId/file - Stream specific document file for in-browser preview
  router.get('/:id/files/:fileId/file', (req: Request, res: Response) => {
    try {
      const fileId = String(req.params.fileId);
      const file = getJobFileById(fileId);
      if (!file || !file.file_path || !fs.existsSync(file.file_path)) {
        return res.status(404).json({ error: 'Document file not found on disk' });
      }

      let contentType = file.mime_type;
      const ext = path.extname(file.original_filename || file.file_path).toLowerCase();
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';

      const safeAsciiName = path.basename(file.original_filename).replace(/[^\w.-]/g, '_');
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(file.original_filename)}`
      );

      res.sendFile(path.resolve(file.file_path));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/jobs - Customer uploads print documents (single or multiple files)
  router.post('/', handleUpload, async (req: Request, res: Response) => {
    try {
      const rawFiles = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      if (!rawFiles || rawFiles.length === 0) {
        return res.status(400).json({ error: 'No document files uploaded' });
      }

      const customerName = (req.body.customerName || req.body.customer_name || 'Walk-in Customer').trim();
      let masterColorMode: ColorMode = req.body.colorMode === 'color' ? 'color' : 'bw';
      let masterSides: SidesMode = req.body.sides === 'duplex' ? 'duplex' : 'single';
      const masterOrientation: OrientationMode =
        req.body.orientation === 'landscape' || req.body.orientation === 'portrait'
          ? req.body.orientation
          : 'auto';
      const masterCopies = Math.max(1, parseInt(req.body.copies, 10) || 1);
      const masterPageRange = (req.body.pageRange || req.body.page_range || 'all').trim();

      // Optional per-file custom settings
      let customFileOptions: any[] = [];
      try {
        if (req.body.fileOptions) {
          customFileOptions = typeof req.body.fileOptions === 'string'
            ? JSON.parse(req.body.fileOptions)
            : req.body.fileOptions;
        }
      } catch {}

      const pricing = getEffectivePricing();
      if (!pricing.color_available && masterColorMode === 'color') {
        masterColorMode = 'bw';
      }
      if (!pricing.duplex_available && masterSides === 'duplex') {
        masterSides = 'single';
      }

      const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const token = getNextToken();

      const jobFiles: JobFile[] = [];
      let totalPages = 0;
      let totalEstimatedCost = 0;

      for (let i = 0; i < rawFiles.length; i++) {
        const file = rawFiles[i];
        const customOpt = customFileOptions[i] || {};

        let fColorMode: ColorMode = (customOpt.colorMode || customOpt.color_mode || masterColorMode) === 'color' ? 'color' : 'bw';
        let fSides: SidesMode = (customOpt.sides || masterSides) === 'duplex' ? 'duplex' : 'single';
        const fOrientation: OrientationMode = customOpt.orientation || masterOrientation;
        const fCopies = Math.max(1, parseInt(customOpt.copies || masterCopies, 10) || 1);
        const fPageRange = (customOpt.pageRange || customOpt.page_range || masterPageRange || 'all').trim();

        if (!pricing.color_available && fColorMode === 'color') {
          fColorMode = 'bw';
        }
        if (!pricing.duplex_available && fSides === 'duplex') {
          fSides = 'single';
        }

        // Authoritative page count inspection
        let filePages = await detectPageCount(file.path, file.mimetype);
        if (filePages <= 1 && customOpt.pageCount) {
          const clientCount = parseInt(customOpt.pageCount, 10);
          if (!isNaN(clientCount) && clientCount > 1) {
            filePages = clientCount;
          }
        }

        const costResult = calculatePrintCost({
          totalPages: filePages,
          pageRange: fPageRange,
          colorMode: fColorMode,
          sides: fSides,
          copies: fCopies,
          pricing,
        });

        const jFile: JobFile = {
          id: `file_${jobId}_${i}`,
          job_id: jobId,
          original_filename: file.originalname,
          stored_filename: file.filename,
          file_path: file.path,
          file_size: file.size,
          mime_type: file.mimetype,
          page_count: filePages,
          color_mode: fColorMode,
          sides: fSides,
          orientation: fOrientation,
          copies: fCopies,
          page_range: fPageRange,
          effective_pages: costResult.effectivePages,
          estimated_cost: costResult.totalCost,
          file_index: i,
          status: 'pending',
          cups_job_id: null,
          printed_at: null,
        };

        jobFiles.push(jFile);
        totalPages += (filePages * fCopies);
        totalEstimatedCost += costResult.totalCost;
      }

      const primaryFile = jobFiles[0];
      const newJob: PrintJob = {
        id: jobId,
        token,
        customer_name: customerName,
        original_filename: rawFiles.length === 1
          ? primaryFile.original_filename
          : `${primaryFile.original_filename} (+${rawFiles.length - 1} more)`,
        stored_filename: primaryFile.stored_filename,
        file_path: primaryFile.file_path,
        file_size: rawFiles.reduce((sum, f) => sum + f.size, 0),
        mime_type: primaryFile.mime_type,
        page_count: totalPages,
        color_mode: masterColorMode,
        sides: masterSides,
        orientation: masterOrientation,
        copies: masterCopies,
        page_range: masterPageRange,
        effective_pages: totalPages,
        estimated_cost: totalEstimatedCost,
        status: 'pending',
        created_at: new Date().toISOString(),
        printed_at: null,
        printer_name: null,
        cups_job_id: null,
        files: jobFiles,
        total_files: jobFiles.length,
        total_pages: totalPages,
      };

      insertJobWithFiles(newJob, jobFiles);

      // Real-time broadcast to all connected Admin PCs
      broadcast({
        type: 'JOB_CREATED',
        job: newJob,
      });

      res.status(201).json({
        success: true,
        job: newJob,
        totalCost: totalEstimatedCost,
      });
    } catch (err: any) {
      console.error('[JobsRoute] Upload error:', err);
      const rawFiles = (req.files as Express.Multer.File[]) || (req.file ? [req.file] : []);
      for (const f of rawFiles) {
        if (f?.path) deletePhysicalFile(f.path);
      }
      res.status(500).json({ error: err.message || 'Failed to submit print job' });
    }
  });

  // PATCH /api/jobs/:id/files/:fileId - Update specific file print options
  router.patch('/:id/files/:fileId', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const fileId = String(req.params.fileId);
      const existingFile = getJobFileById(fileId);
      if (!existingFile || existingFile.job_id !== id) {
        return res.status(404).json({ error: 'File not found in this job' });
      }

      const updates: Partial<JobFile> = {};
      if (req.body.color_mode) updates.color_mode = req.body.color_mode;
      if (req.body.sides) updates.sides = req.body.sides;
      if (req.body.orientation) updates.orientation = req.body.orientation;
      if (req.body.copies) updates.copies = Math.max(1, parseInt(req.body.copies, 10));
      if (req.body.page_range !== undefined) updates.page_range = req.body.page_range;
      if (req.body.status) updates.status = req.body.status;

      // Recalculate file cost
      const pricing = getEffectivePricing();
      const costResult = calculatePrintCost({
        totalPages: existingFile.page_count,
        pageRange: updates.page_range ?? existingFile.page_range,
        colorMode: updates.color_mode ?? existingFile.color_mode,
        sides: updates.sides ?? existingFile.sides,
        copies: updates.copies ?? existingFile.copies,
        pricing,
      });
      updates.effective_pages = costResult.effectivePages;
      updates.estimated_cost = costResult.totalCost;

      const updatedFile = updateJobFile(fileId, updates);

      // Recalculate parent job total cost
      const allFiles = getJobFiles(id);
      const newTotalCost = allFiles.reduce((s, f) => s + f.estimated_cost, 0);
      const newTotalPages = allFiles.reduce((s, f) => s + (f.page_count * f.copies), 0);
      updateJob(id, {
        estimated_cost: newTotalCost,
        total_pages: newTotalPages,
      });

      const updatedJob = getJobById(id);
      broadcast({
        type: 'JOB_UPDATED',
        job: updatedJob,
      });

      res.json({ success: true, file: updatedFile, job: updatedJob });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const handleOptionsUpdate = async (
    existing: PrintJob,
    body: any,
    res: Response
  ) => {
    if (existing.status === 'printed' || existing.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot modify a job that has already been ${existing.status}` });
    }

    const colorMode: ColorMode | undefined = body.color_mode || body.colorMode;
    const sides: SidesMode | undefined = body.sides;
    const copies: number | undefined = body.copies ? Math.max(1, parseInt(body.copies, 10)) : undefined;
    const rawPageRange = body.page_range !== undefined ? body.page_range : body.pageRange;

    const pricing = getEffectivePricing();
    let newColor: ColorMode = colorMode || existing.color_mode;
    let newSides: SidesMode = sides || existing.sides;
    let newCopies: number = copies || existing.copies;
    let newPageRange: string = rawPageRange !== undefined ? String(rawPageRange).trim() : existing.page_range;

    if (!pricing.color_available && newColor === 'color') {
      newColor = 'bw';
    }
    if (!pricing.duplex_available && newSides === 'duplex') {
      newSides = 'single';
    }

    const files = getJobFiles(existing.id);
    const maxDocPages = files.length > 0
      ? Math.max(...files.map((f) => f.page_count))
      : (existing.page_count || 1);

    let warning: string | undefined;
    if (newPageRange && newPageRange.toLowerCase() !== 'all') {
      const parsedRange = formatPageRangeString(newPageRange, maxDocPages);
      newPageRange = parsedRange.pageRange;
      warning = parsedRange.warning;
    } else {
      newPageRange = 'all';
    }

    let totalCost = 0;
    let totalPages = 0;
    let primaryEffectivePages = existing.effective_pages;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const costRes = calculatePrintCost({
        totalPages: f.page_count,
        pageRange: newPageRange,
        colorMode: newColor,
        sides: newSides,
        copies: newCopies,
        pricing,
      });

      totalCost += costRes.totalCost;
      totalPages += costRes.effectivePages * newCopies;
      if (i === 0) primaryEffectivePages = costRes.effectivePages;

      updateJobFile(f.id, {
        color_mode: newColor,
        sides: newSides,
        copies: newCopies,
        page_range: newPageRange,
        effective_pages: costRes.effectivePages,
        estimated_cost: costRes.totalCost,
      });
    }

    const updated = updateJob(existing.id, {
      color_mode: newColor,
      sides: newSides,
      copies: newCopies,
      page_range: newPageRange,
      effective_pages: primaryEffectivePages,
      estimated_cost: totalCost,
      total_pages: totalPages,
    });

    broadcast({
      type: 'JOB_UPDATED',
      job: updated,
    });

    if (updated && updated.whatsapp_jid) {
      sendWhatsAppOrderUpdateNotification(updated, warning).catch(console.warn);
    }

    return res.json({ success: true, job: updated, warning });
  };

  // PATCH /api/jobs/token/:token/options - Mobile Customizer endpoint
  router.patch('/token/:token/options', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token);
      const existing = getJobByToken(token);
      if (!existing) {
        return res.status(404).json({ error: 'Job not found for token' });
      }
      await handleOptionsUpdate(existing, req.body, res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/jobs/:id/options - Options endpoint by job ID
  router.patch('/:id/options', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = getJobById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Job not found' });
      }
      await handleOptionsUpdate(existing, req.body, res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      if (updated && updated.source === 'whatsapp' && updated.whatsapp_jid) {
        if (updates.status === 'printing') {
          notifyWhatsAppJobPrinting(updated).catch(console.warn);
        } else if (updates.status === 'printed') {
          notifyWhatsAppJobCompleted(updated).catch(console.warn);
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/jobs/:id - Delete job and unlink all associated files
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
      if (existing.files && Array.isArray(existing.files)) {
        for (const f of existing.files) {
          if (f.file_path) deletePhysicalFile(f.file_path);
        }
      }

      deleteJob(id);

      broadcast({
        type: 'JOB_DELETED',
        id,
      });

      res.json({ success: true, message: 'Job and all associated files deleted' });
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
