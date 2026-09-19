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

  it('parses natural language multi-option combined sentences', async () => {
    const { parsePrintKeywords } = await import('../server/whatsappService.js');

    // Multi-option combined sentence: Color + Duplex + Copies + Page Range
    const res1 = parsePrintKeywords('Color front and back 2 copies pages 1 to 4', 10);
    expect(res1.colorMode).toBe('color');
    expect(res1.sides).toBe('duplex');
    expect(res1.copies).toBe(2);
    expect(res1.pageRange).toBe('1-4');
    expect(res1.effectivePages).toBe(4);

    // B/W + Single Sided + Sets
    const res2 = parsePrintKeywords('b/w single side 3 sets', 5);
    expect(res2.colorMode).toBe('bw');
    expect(res2.sides).toBe('single');
    expect(res2.copies).toBe(3);

    // Black and white + double sided + specific page
    const res3 = parsePrintKeywords('black and white duplex only page 2', 5);
    expect(res3.colorMode).toBe('bw');
    expect(res3.sides).toBe('duplex');
    expect(res3.pageRange).toBe('2');
    expect(res3.effectivePages).toBe(1);

    // "in colour" + "both sides" + "first 3 pages"
    const res4 = parsePrintKeywords('print in colour both sides first 3 pages', 8);
    expect(res4.colorMode).toBe('color');
    expect(res4.sides).toBe('duplex');
    expect(res4.pageRange).toBe('1-3');
    expect(res4.effectivePages).toBe(3);

    // Discontinuous page range: p 1-3, 5 + copies
    const res5 = parsePrintKeywords('p 1-3, 5 2 copies', 10);
    expect(res5.copies).toBe(2);
    expect(res5.pageRange).toBe('1-3,5');
    expect(res5.effectivePages).toBe(4);

    // All pages
    const res6 = parsePrintKeywords('all pages', 12);
    expect(res6.pageRange).toBe('all');
    expect(res6.effectivePages).toBe(12);

    // Prefix copy
    const res7 = parsePrintKeywords('copy 4 mono', 10);
    expect(res7.copies).toBe(4);
    expect(res7.colorMode).toBe('bw');

    // "one sided" boundary check
    const res8 = parsePrintKeywords('one sided', 5);
    expect(res8.sides).toBe('single');

    // "pages 1-3, 5 copies" - ensure 5 copies does not bleed into page range!
    const res9 = parsePrintKeywords('pages 1-3, 5 copies', 10);
    expect(res9.copies).toBe(5);
    expect(res9.pageRange).toBe('1-3');
    expect(res9.effectivePages).toBe(3);

    // "and" / "&" separated page ranges
    const res10 = parsePrintKeywords('pages 1 and 2', 5);
    expect(res10.pageRange).toBe('1-2');
    expect(res10.effectivePages).toBe(2);

    const res11 = parsePrintKeywords('page 1 & 3', 5);
    expect(res11.pageRange).toBe('1,3');
    expect(res11.effectivePages).toBe(2);

    const res12 = parsePrintKeywords('pages 1 to 3 and 5 to 7', 10);
    expect(res12.pageRange).toBe('1-3,5-7');
    expect(res12.effectivePages).toBe(6);

    // "pg" and "pgs" abbreviations
    const res13 = parsePrintKeywords('pg 1-4 color', 10);
    expect(res13.pageRange).toBe('1-4');
    expect(res13.colorMode).toBe('color');

    const res14 = parsePrintKeywords('pgs 2 to 5', 10);
    expect(res14.pageRange).toBe('2-5');

    // "first page" and "last page"
    const res15 = parsePrintKeywords('first page', 8);
    expect(res15.pageRange).toBe('1');
    expect(res15.effectivePages).toBe(1);

    const res16 = parsePrintKeywords('last page', 8);
    expect(res16.pageRange).toBe('8');
    expect(res16.effectivePages).toBe(1);

    // Word copies and duplex variations
    const res17 = parsePrintKeywords('two copies back to back', 5);
    expect(res17.copies).toBe(2);
    expect(res17.sides).toBe('duplex');

    // Isolated range syntax
    const res18 = parsePrintKeywords('1 to 4 color', 10);
    expect(res18.pageRange).toBe('1-4');
    expect(res18.colorMode).toBe('color');
  });

  it('correctly handles numbered quick-reply shortcuts (1, 2, 3, 4)', async () => {
    const { parsePrintKeywords } = await import('../server/whatsappService.js');

    // 1 -> B/W Single
    const opt1 = parsePrintKeywords('1');
    expect(opt1.isShortcut).toBe(true);
    expect(opt1.colorMode).toBe('bw');
    expect(opt1.sides).toBe('single');

    // 2 -> B/W Front & Back
    const opt2 = parsePrintKeywords('2');
    expect(opt2.isShortcut).toBe(true);
    expect(opt2.colorMode).toBe('bw');
    expect(opt2.sides).toBe('duplex');

    // 3 -> Color Single
    const opt3 = parsePrintKeywords('3');
    expect(opt3.isShortcut).toBe(true);
    expect(opt3.colorMode).toBe('color');
    expect(opt3.sides).toBe('single');

    // 4 -> Color Front & Back
    const opt4 = parsePrintKeywords('4');
    expect(opt4.isShortcut).toBe(true);
    expect(opt4.colorMode).toBe('color');
    expect(opt4.sides).toBe('duplex');

    // Bracketed and dotted shortcuts: [1], (2), 3.
    expect(parsePrintKeywords('[1]').colorMode).toBe('bw');
    expect(parsePrintKeywords('(2)').sides).toBe('duplex');
    expect(parsePrintKeywords('3.').colorMode).toBe('color');

    // "2 copies" should NOT trigger shortcut 2, it should parse copies: 2
    const optCopies = parsePrintKeywords('2 copies');
    expect(optCopies.isShortcut).toBeFalsy();
    expect(optCopies.copies).toBe(2);
    expect(optCopies.colorMode).toBeUndefined();
  });

  it('formats page ranges and clamps out-of-range requests cleanly', async () => {
    const { formatPageRangeString } = await import('../server/whatsappService.js');

    // Standard range
    const r1 = formatPageRangeString('1 to 4', 10);
    expect(r1.pageRange).toBe('1-4');
    expect(r1.effectivePages).toBe(4);
    expect(r1.warning).toBeUndefined();

    // Out of bounds range clamping
    const r2 = formatPageRangeString('pages 1 to 8', 4);
    expect(r2.pageRange).toBe('1-4');
    expect(r2.effectivePages).toBe(4);
    expect(r2.warning).toContain('exceeds document total');

    // Discontinuous range
    const r3 = formatPageRangeString('1-3, 5, 7', 10);
    expect(r3.pageRange).toBe('1-3,5,7');
    expect(r3.effectivePages).toBe(5);

    // Single page out of range clamped
    const r4 = formatPageRangeString('page 10', 4);
    expect(r4.pageRange).toBe('4');
    expect(r4.effectivePages).toBe(1);
    expect(r4.warning).toContain('exceeds document total');

    // Overlapping ranges canonical reduction: 1-3, 2-4, 8 -> 1-4,8
    const r5 = formatPageRangeString('pages 1-3, 2-4, 8', 10);
    expect(r5.pageRange).toBe('1-4,8');
    expect(r5.effectivePages).toBe(5);

    // 0-start clamping: 0 to 5 -> 1-5
    const r6 = formatPageRangeString('0 to 5', 10);
    expect(r6.pageRange).toBe('1-5');
    expect(r6.effectivePages).toBe(5);
  });

  it('formats transparent WhatsApp confirmation receipt with quick-reply guide and web link', async () => {
    const { formatWhatsAppReceipt } = await import('../server/whatsappService.js');

    const mockJob: PrintJob = {
      id: 'job_test_receipt',
      token: '#P-202',
      customer_name: 'Ananya Verma',
      original_filename: 'thesis_report.pdf',
      stored_filename: 'thesis_report.pdf',
      file_path: '/tmp/thesis.pdf',
      file_size: 2048,
      mime_type: 'application/pdf',
      page_count: 12,
      color_mode: 'bw',
      sides: 'duplex',
      orientation: 'auto',
      copies: 2,
      page_range: '1-6',
      effective_pages: 6,
      estimated_cost: 18,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
      total_files: 1,
      total_pages: 12,
      source: 'whatsapp',
      whatsapp_jid: '919123456789@s.whatsapp.net',
    };

    const receipt = formatWhatsAppReceipt(mockJob, 'https://station.example.com');
    expect(receipt).toContain('📄 Received: thesis_report.pdf (12 pages)');
    expect(receipt).toContain('💰 Estimated: ₹18.00 (B/W • Front & Back • 2 Copies • Pages 1-6)');
    expect(receipt).toContain('🎫 Token: #P-202');
    expect(receipt).toContain('👉 📱 Tap to customize in 1-tap (No typing needed):');
    expect(receipt).toContain('https://station.example.com/order/P-202');
    expect(receipt).toContain('(Select B/W or Color, Single or Both sides, pages & copies visually!)');
    expect(receipt).toContain('⚡ Or quick-reply with a number:');
    expect(receipt).toContain('1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex');

    const { formatWhatsAppUpdateReceipt } = await import('../server/whatsappService.js');
    const updateReceipt = formatWhatsAppUpdateReceipt(mockJob, 'https://station.example.com');
    expect(updateReceipt).toContain('✅ *Options Updated!*');
    expect(updateReceipt).toContain('📄 Received: thesis_report.pdf (12 pages)');
    expect(updateReceipt).toContain('https://station.example.com/order/P-202');
  });

  it('updates order options via PATCH /api/jobs/token/:token/options and recalculates cost', async () => {
    const express = (await import('express')).default;
    const http = await import('http');
    const { createJobsRouter } = await import('../server/routes/jobs.js');

    const app = express();
    app.use(express.json());
    app.use('/api/jobs', createJobsRouter(() => {}));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const testJobId = `test_wa_${Date.now()}`;
      const token = getNextToken();

      const testFile: JobFile = {
        id: `file_${testJobId}_0`,
        job_id: testJobId,
        original_filename: 'presentation.pdf',
        stored_filename: `${testJobId}.pdf`,
        file_path: `/tmp/${testJobId}.pdf`,
        file_size: 5000,
        mime_type: 'application/pdf',
        page_count: 8,
        color_mode: 'bw',
        sides: 'single',
        orientation: 'auto',
        copies: 1,
        page_range: 'all',
        effective_pages: 8,
        estimated_cost: 24, // 8 pages * 3
        file_index: 0,
        status: 'pending',
        cups_job_id: null,
        printed_at: null,
      };

      const testJob: PrintJob = {
        id: testJobId,
        token,
        customer_name: 'Priya',
        original_filename: 'presentation.pdf',
        stored_filename: `${testJobId}.pdf`,
        file_path: `/tmp/${testJobId}.pdf`,
        file_size: 5000,
        mime_type: 'application/pdf',
        page_count: 8,
        color_mode: 'bw',
        sides: 'single',
        orientation: 'auto',
        copies: 1,
        page_range: 'all',
        effective_pages: 8,
        estimated_cost: 24,
        status: 'pending',
        created_at: new Date().toISOString(),
        printed_at: null,
        printer_name: null,
        cups_job_id: null,
        files: [testFile],
        total_files: 1,
        total_pages: 8,
        source: 'whatsapp',
        whatsapp_jid: '919876500000@s.whatsapp.net',
      };

      insertJobWithFiles(testJob, [testFile]);

      // Call PATCH /api/jobs/token/:token/options to customize options
      // Change to Color, Duplex, 2 copies, pages 1 to 4 (4 pages)
      const patchRes = await fetch(`${baseUrl}/api/jobs/token/${encodeURIComponent(token)}/options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          color_mode: 'color',
          sides: 'duplex',
          copies: 2,
          page_range: '1-4',
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.success).toBe(true);
      expect(patchData.job.color_mode).toBe('color');
      expect(patchData.job.sides).toBe('duplex');
      expect(patchData.job.copies).toBe(2);
      expect(patchData.job.page_range).toBe('1-4');
      expect(patchData.job.effective_pages).toBe(4);
      // In active profiles, Canon GX4070 color duplex price is ₹18 per sheet.
      // 4 pages duplex = 2 sheets * 18 = 36 per copy * 2 copies = 72!
      expect(patchData.job.estimated_cost).toBe(72);

      // Verify directly from SQLite DB
      const updatedInDb = getJobById(testJobId);
      expect(updatedInDb).toBeDefined();
      expect(updatedInDb?.color_mode).toBe('color');
      expect(updatedInDb?.sides).toBe('duplex');
      expect(updatedInDb?.copies).toBe(2);
      expect(updatedInDb?.page_range).toBe('1-4');
      expect(updatedInDb?.estimated_cost).toBe(72);

      // Verify case-insensitive and numeric token lookups
      const rawNum = token.replace(/^#P-/i, '');
      const lowerToken = token.toLowerCase();
      expect(getJobByToken(lowerToken)?.id).toBe(testJobId);
      expect(getJobByToken(rawNum)?.id).toBe(testJobId);

      // Verify 404 on non-existent token
      const notFoundRes = await fetch(`${baseUrl}/api/jobs/token/nonexistent_token/options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copies: 3 }),
      });
      expect(notFoundRes.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});


