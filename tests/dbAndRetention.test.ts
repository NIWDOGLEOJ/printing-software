import { describe, it, expect } from 'vitest';
import {
  insertJob,
  getAllJobs,
  getJobById,
  updateJob,
  deleteJob,
  getNextToken,
  getPricingSettings,
  updatePricingSettings,
} from '../server/db.js';
import { cleanupExpiredFiles } from '../server/storageService.js';
import { PrintJob } from '../shared/types.js';

describe('Database & Retention Service', () => {
  it('generates sequential tokens like #P-101', () => {
    const token = getNextToken();
    expect(token).toMatch(/^#P-\d+$/);
  });

  it('inserts, updates, retrieves and deletes print jobs properly', () => {
    const id = `test_job_${Date.now()}`;
    const token = getNextToken();

    const newJob: PrintJob = {
      id,
      token,
      customer_name: 'Test Customer',
      original_filename: 'sample.pdf',
      stored_filename: 'stored_sample.pdf',
      file_path: '/tmp/sample.pdf',
      file_size: 1024,
      mime_type: 'application/pdf',
      page_count: 2,
      color_mode: 'bw',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: 'all',
      effective_pages: 2,
      estimated_cost: 4,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
    };

    insertJob(newJob);

    const retrieved = getJobById(id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.customer_name).toBe('Test Customer');
    expect(retrieved?.token).toBe(token);

    // Update job
    const updated = updateJob(id, { status: 'printed', cups_job_id: 'TEST-CUPS-1' });
    expect(updated?.status).toBe('printed');
    expect(updated?.cups_job_id).toBe('TEST-CUPS-1');

    // Delete job
    const deleted = deleteJob(id);
    expect(deleted).toBe(true);
    expect(getJobById(id)).toBeUndefined();
  });

  it('reads and updates pricing settings', () => {
    const current = getPricingSettings();
    expect(current.bw_price_per_page).toBeGreaterThan(0);

    const updated = updatePricingSettings({ bw_price_per_page: 2.5 });
    expect(updated.bw_price_per_page).toBe(2.5);

    // Restore to 2
    updatePricingSettings({ bw_price_per_page: 2 });
  });

  it('runs retention sweeper without throwing errors', () => {
    const res = cleanupExpiredFiles();
    expect(res).toBeDefined();
    expect(typeof res.deletedCount).toBe('number');
  });
});
