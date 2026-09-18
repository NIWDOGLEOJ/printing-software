import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  insertJobWithFiles,
  getJobById,
  getJobByToken,
  getLatestPendingJobByWhatsAppJid,
  getWhatsAppSettings,
  updateWhatsAppSettings,
  getNextToken,
} from '../server/db.js';
import { PrintJob, JobFile } from '../shared/types.js';

describe('WhatsApp Integration & Database Support', () => {
  beforeEach(() => {
    // Clean test jobs
    db.prepare("DELETE FROM jobs WHERE id LIKE 'test_wa_%'").run();
  });

  it('correctly persists and retrieves a WhatsApp-sourced print job', () => {
    const jobId = `test_wa_${Date.now()}`;
    const token = getNextToken();

    const file: JobFile = {
      id: `file_${jobId}_0`,
      job_id: jobId,
      original_filename: 'resume.pdf',
      stored_filename: `${jobId}.pdf`,
      file_path: `/tmp/${jobId}.pdf`,
      file_size: 1024,
      mime_type: 'application/pdf',
      page_count: 3,
      color_mode: 'bw',
      sides: 'single',
      orientation: 'auto',
      copies: 1,
      page_range: 'all',
      effective_pages: 3,
      estimated_cost: 6,
      file_index: 0,
      status: 'pending',
      cups_job_id: null,
      printed_at: null,
    };

    const job: PrintJob = {
      id: jobId,
      token,
      customer_name: 'Rahul Sharma',
      original_filename: 'resume.pdf',
      stored_filename: `${jobId}.pdf`,
      file_path: `/tmp/${jobId}.pdf`,
      file_size: 1024,
      mime_type: 'application/pdf',
      page_count: 3,
      color_mode: 'bw',
      sides: 'single',
      orientation: 'auto',
      copies: 1,
      page_range: 'all',
      effective_pages: 3,
      estimated_cost: 6,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
      files: [file],
      total_files: 1,
      total_pages: 3,
      source: 'whatsapp',
      whatsapp_jid: '919876543210@s.whatsapp.net',
      whatsapp_sender_name: 'Rahul Sharma',
    };

    const saved = insertJobWithFiles(job, [file]);
    expect(saved.source).toBe('whatsapp');
    expect(saved.whatsapp_jid).toBe('919876543210@s.whatsapp.net');
    expect(saved.whatsapp_sender_name).toBe('Rahul Sharma');

    // Retrieve by ID
    const retrieved = getJobById(jobId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.source).toBe('whatsapp');
    expect(retrieved?.whatsapp_jid).toBe('919876543210@s.whatsapp.net');

    // Retrieve by Token
    const byToken = getJobByToken(token);
    expect(byToken).toBeDefined();
    expect(byToken?.id).toBe(jobId);

    // Retrieve latest pending job by WhatsApp JID
    const latestPending = getLatestPendingJobByWhatsAppJid('919876543210@s.whatsapp.net');
    expect(latestPending).toBeDefined();
    expect(latestPending?.id).toBe(jobId);
  });

  it('manages WhatsApp notification settings in database', () => {
    // Initial defaults
    const initial = getWhatsAppSettings();
    expect(initial).toHaveProperty('notifyOnPrint');
    expect(initial).toHaveProperty('notifyOnComplete');
    expect(initial).toHaveProperty('welcomeEnabled');

    // Update settings
    const updated = updateWhatsAppSettings({
      notifyOnPrint: false,
      notifyOnComplete: true,
      welcomeEnabled: false,
    });

    expect(updated.notifyOnPrint).toBe(false);
    expect(updated.notifyOnComplete).toBe(true);
    expect(updated.welcomeEnabled).toBe(false);

    // Revert
    updateWhatsAppSettings({
      notifyOnPrint: true,
      welcomeEnabled: true,
    });
  });

  it('combines multiple incoming images into a single multi-page PDF', async () => {
    const { combineBatchImagesToPdf } = await import('../server/whatsappService.js');
    const fs = await import('fs');
    const path = await import('path');
    const { PDFDocument } = await import('pdf-lib');

    // 1x1 transparent PNG base64
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const img1 = path.resolve('/tmp/test_img1.png');
    const img2 = path.resolve('/tmp/test_img2.png');
    fs.writeFileSync(img1, pngBytes);
    fs.writeFileSync(img2, pngBytes);

    const testImages = [
      {
        originalName: 'photo_1.png',
        storedName: 'test_img1.png',
        filePath: img1,
        fileSize: pngBytes.length,
        mimeType: 'image/png',
        pageCount: 1,
      },
      {
        originalName: 'photo_2.png',
        storedName: 'test_img2.png',
        filePath: img2,
        fileSize: pngBytes.length,
        mimeType: 'image/png',
        pageCount: 1,
      },
    ];

    const combined = await combineBatchImagesToPdf(testImages);
    expect(combined.mimeType).toBe('application/pdf');
    expect(combined.pageCount).toBe(2);
    expect(fs.existsSync(combined.filePath)).toBe(true);

    const doc = await PDFDocument.load(fs.readFileSync(combined.filePath));
    expect(doc.getPageCount()).toBe(2);

    // Cleanup
    if (fs.existsSync(img1)) fs.unlinkSync(img1);
    if (fs.existsSync(img2)) fs.unlinkSync(img2);
    if (fs.existsSync(combined.filePath)) fs.unlinkSync(combined.filePath);
  });

  it('converts amounts to Indian denomination words correctly', async () => {
    const { numberToWords } = await import('../server/whatsappService.js');
    expect(numberToWords(0)).toBe('Zero');
    expect(numberToWords(5)).toBe('Five');
    expect(numberToWords(34)).toBe('Thirty-Four');
    expect(numberToWords(150)).toBe('One Hundred Fifty');
    expect(numberToWords(1250)).toBe('One Thousand Two Hundred Fifty');
    expect(numberToWords(34.50)).toBe('Thirty-Four and Fifty Paise');
    expect(numberToWords(0.50)).toBe('Fifty Paise');
  });
});

