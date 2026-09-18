import { Router, Request, Response } from 'express';
import { getPrinters, printFile, createTestPrintFile } from '../printerService.js';
import {
  discoverAllPrinters,
  getLatestDiscoveredPrinters,
  scanPrintersNow,
  linkDiscoveredPrinterToProfile,
  createProfileFromDiscovered,
} from '../printerDiscoveryService.js';
import {
  getJobById,
  updateJob,
  getPricingSettings,
  getAllPrinterProfiles,
  getPrinterProfileById,
  upsertPrinterProfile,
  updatePrinterProfile,
  deletePrinterProfile,
  getEffectivePricing,
  seedDefaultPrinterProfiles,
  getJobFiles,
  getJobFileById,
  updateJobFile,
} from '../db.js';
import { calculatePrintCost } from '../../shared/costCalculator.js';
import { ColorMode, SidesMode, OrientationMode } from '../../shared/types.js';
import { notifyWhatsAppJobCompleted } from '../whatsappService.js';

export function createPrintersRouter(broadcast: (message: any) => void) {
  const router = Router();

  // GET /api/printers/discovered - Get all auto-detected network, USB, and CUPS printers
  router.get('/discovered', async (_req: Request, res: Response) => {
    try {
      let printers = getLatestDiscoveredPrinters();
      if (printers.length === 0) {
        printers = await discoverAllPrinters();
      }
      res.json(printers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/scan - Trigger fresh active scan across network (Bonjour), USB, and CUPS
  router.post('/scan', async (_req: Request, res: Response) => {
    try {
      const printers = await scanPrintersNow(broadcast);
      res.json({
        success: true,
        count: printers.length,
        printers,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/link-profile - Associate a discovered device with an existing profile
  router.post('/link-profile', async (req: Request, res: Response) => {
    try {
      const { discoveredId, profileId } = req.body;
      if (!discoveredId || !profileId) {
        return res.status(400).json({ error: 'discoveredId and profileId are required' });
      }
      const updated = await linkDiscoveredPrinterToProfile(discoveredId, profileId, broadcast);
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/create-profile-from-device - 1-click create profile from discovered device
  router.post('/create-profile-from-device', async (req: Request, res: Response) => {
    try {
      const { discoveredId } = req.body;
      if (!discoveredId) {
        return res.status(400).json({ error: 'discoveredId is required' });
      }
      const created = await createProfileFromDiscovered(discoveredId, broadcast);
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers - Discover all CUPS and virtual printers
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const printers = await getPrinters();
      res.json(printers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/pricing - Effective customer rates and capability availability
  router.get('/pricing', (_req: Request, res: Response) => {
    try {
      const pricing = getEffectivePricing();
      res.json(pricing);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/profiles - Get all configured printer profiles
  router.get('/profiles', (_req: Request, res: Response) => {
    try {
      const profiles = getAllPrinterProfiles();
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/profiles - Add a new printer profile
  router.post('/profiles', (req: Request, res: Response) => {
    try {
      if (!req.body.name || !req.body.name.trim()) {
        return res.status(400).json({ error: 'Printer profile name is required' });
      }
      const profile = upsertPrinterProfile(req.body);
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: getPricingSettings(),
      });
      res.status(201).json(profile);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/profiles/reset - Restore default hardware printer profiles (IR4225 + GX4070)
  router.post('/profiles/reset', (_req: Request, res: Response) => {
    try {
      seedDefaultPrinterProfiles(true);
      const profiles = getAllPrinterProfiles();
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles,
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: getPricingSettings(),
      });
      res.json({ success: true, message: 'Printer profiles reset to defaults', profiles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/profiles/:id - Get a specific printer profile
  router.get('/profiles/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const profile = getPrinterProfileById(id);
      if (!profile) {
        return res.status(404).json({ error: 'Printer profile not found' });
      }
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/printers/profiles/:id - Update profile status, rates, or settings
  router.patch('/profiles/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updated = updatePrinterProfile(id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Printer profile not found' });
      }
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: getPricingSettings(),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/profiles/:id - Replace or update printer profile
  router.put('/profiles/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const updated = upsertPrinterProfile({ ...req.body, id });
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: getPricingSettings(),
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/profiles/:id - Remove printer profile
  router.delete('/profiles/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const deleted = deletePrinterProfile(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Printer profile not found' });
      }
      broadcast({
        type: 'PRINTER_PROFILES_UPDATED',
        profiles: getAllPrinterProfiles(),
      });
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: getPricingSettings(),
      });
      res.json({ success: true, message: 'Printer profile deleted' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/print/:id - Print a specific document job (all files if multi-document)
  router.post('/print/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const job = getJobById(id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const {
        printerName,
        copies,
        colorMode,
        sides,
        orientation,
        pageRange,
      } = req.body;

      const pricing = getEffectivePricing();
      const filesToPrint = (job.files && job.files.length > 0)
        ? job.files
        : [{
            id: `file_${job.id}_0`,
            job_id: job.id,
            original_filename: job.original_filename,
            stored_filename: job.stored_filename,
            file_path: job.file_path,
            file_size: job.file_size,
            mime_type: job.mime_type,
            page_count: job.page_count,
            color_mode: job.color_mode,
            sides: job.sides,
            orientation: job.orientation,
            copies: job.copies,
            page_range: job.page_range,
            effective_pages: job.effective_pages,
            estimated_cost: job.estimated_cost,
            file_index: 0,
            status: job.status,
            cups_job_id: job.cups_job_id,
            printed_at: job.printed_at,
          }];

      const cupsIds: string[] = [];
      let lastPrinterName = '';

      for (const file of filesToPrint) {
        const fileOpts = {
          printerName: printerName || job.printer_name || undefined,
          copies: copies !== undefined ? Number(copies) : file.copies,
          colorMode: (colorMode || file.color_mode) as ColorMode,
          sides: (sides || file.sides) as SidesMode,
          orientation: (orientation || file.orientation) as OrientationMode,
          pageRange: pageRange !== undefined ? String(pageRange) : file.page_range,
        };

        const result = await printFile(file.file_path, fileOpts);
        cupsIds.push(result.cupsJobId);
        lastPrinterName = result.printerName;

        const costResult = calculatePrintCost({
          totalPages: file.page_count,
          pageRange: fileOpts.pageRange,
          colorMode: fileOpts.colorMode,
          sides: fileOpts.sides,
          copies: fileOpts.copies,
          pricing,
        });

        if (job.files && job.files.length > 0) {
          updateJobFile(file.id, {
            status: 'printed',
            printed_at: new Date().toISOString(),
            cups_job_id: result.cupsJobId,
            copies: fileOpts.copies,
            color_mode: fileOpts.colorMode,
            sides: fileOpts.sides,
            orientation: fileOpts.orientation,
            page_range: fileOpts.pageRange,
            effective_pages: costResult.effectivePages,
            estimated_cost: costResult.totalCost,
          });
        }
      }

      // Update parent job
      const allFiles = getJobFiles(job.id);
      const totalCost = allFiles.length > 0 ? allFiles.reduce((s, f) => s + f.estimated_cost, 0) : job.estimated_cost;
      const totalPages = allFiles.length > 0 ? allFiles.reduce((s, f) => s + (f.page_count * f.copies), 0) : job.page_count;

      updateJob(job.id, {
        status: 'printed',
        printed_at: new Date().toISOString(),
        printer_name: lastPrinterName,
        cups_job_id: cupsIds.join(', '),
        estimated_cost: totalCost,
        total_pages: totalPages,
      });

      const updated = getJobById(job.id)!;

      broadcast({
        type: 'JOB_UPDATED',
        job: updated,
      });

      if (updated && updated.source === 'whatsapp' && updated.whatsapp_jid) {
        notifyWhatsAppJobCompleted(updated).catch(console.warn);
      }

      res.json({
        success: true,
        message: `Successfully printed ${filesToPrint.length} document(s) on ${lastPrinterName}`,
        cupsJobId: cupsIds.join(', '),
        printerName: lastPrinterName,
        job: updated,
      });
    } catch (err: any) {
      console.error('[PrintersRoute] Print error:', err);
      res.status(500).json({ error: err.message || 'Failed to dispatch print job' });
    }
  });

  // POST /api/printers/print-file/:fileId - Print a single file from a multi-document job
  router.post('/print-file/:fileId', async (req: Request, res: Response) => {
    try {
      const fileId = String(req.params.fileId);
      const file = getJobFileById(fileId);
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }
      const job = getJobById(file.job_id);
      if (!job) {
        return res.status(404).json({ error: 'Associated job not found' });
      }

      const {
        printerName,
        copies,
        colorMode,
        sides,
        orientation,
        pageRange,
      } = req.body;

      const printOptions = {
        printerName: printerName || job.printer_name || undefined,
        copies: copies !== undefined ? Number(copies) : file.copies,
        colorMode: (colorMode || file.color_mode) as ColorMode,
        sides: (sides || file.sides) as SidesMode,
        orientation: (orientation || file.orientation) as OrientationMode,
        pageRange: pageRange !== undefined ? String(pageRange) : file.page_range,
      };

      const result = await printFile(file.file_path, printOptions);

      const pricing = getEffectivePricing();
      const costResult = calculatePrintCost({
        totalPages: file.page_count,
        pageRange: printOptions.pageRange,
        colorMode: printOptions.colorMode,
        sides: printOptions.sides,
        copies: printOptions.copies,
        pricing,
      });

      const updatedFile = updateJobFile(fileId, {
        status: 'printed',
        printed_at: new Date().toISOString(),
        cups_job_id: result.cupsJobId,
        copies: printOptions.copies,
        color_mode: printOptions.colorMode,
        sides: printOptions.sides,
        orientation: printOptions.orientation,
        page_range: printOptions.pageRange,
        effective_pages: costResult.effectivePages,
        estimated_cost: costResult.totalCost,
      });

      // Update parent job status if all files printed
      const allFiles = getJobFiles(job.id);
      const allPrinted = allFiles.length > 0 && allFiles.every((f) => f.status === 'printed');
      const newTotalCost = allFiles.reduce((s, f) => s + f.estimated_cost, 0);
      const newTotalPages = allFiles.reduce((s, f) => s + (f.page_count * f.copies), 0);

      updateJob(job.id, {
        status: allPrinted ? 'printed' : job.status,
        printed_at: allPrinted ? new Date().toISOString() : job.printed_at,
        printer_name: result.printerName,
        cups_job_id: result.cupsJobId,
        estimated_cost: newTotalCost,
        total_pages: newTotalPages,
      });

      const updatedJob = getJobById(job.id)!;

      broadcast({
        type: 'JOB_UPDATED',
        job: updatedJob,
      });

      res.json({
        success: true,
        message: result.message,
        cupsJobId: result.cupsJobId,
        printerName: result.printerName,
        file: updatedFile,
        job: updatedJob,
      });
    } catch (err: any) {
      console.error('[PrintersRoute] Print file error:', err);
      res.status(500).json({ error: err.message || 'Failed to dispatch file print' });
    }
  });

  // POST /api/printers/test - Print a test page
  router.post('/test', async (req: Request, res: Response) => {
    try {
      const printerName = req.body.printerName || 'Virtual / Mock Printer (Simulated)';
      const testFile = await createTestPrintFile(printerName);

      const result = await printFile(testFile, {
        printerName,
        copies: 1,
        colorMode: 'color',
        sides: 'single',
        orientation: 'portrait',
      });

      res.json({
        success: true,
        message: `Test page sent to ${printerName}: ${result.message}`,
        cupsJobId: result.cupsJobId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
