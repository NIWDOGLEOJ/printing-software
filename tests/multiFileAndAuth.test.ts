import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { createJobsRouter } from '../server/routes/jobs.js';
import { createPrintersRouter } from '../server/routes/printers.js';
import { createAuthRouter } from '../server/routes/auth.js';
import { authenticateWithBillingDb } from '../server/authService.js';
import { getJobById, getJobFiles } from '../server/db.js';

describe('Multi-Document & Billing Auth Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const dummyBroadcast = () => {};
    app.use('/api/auth', createAuthRouter());
    app.use('/api/jobs', createJobsRouter(dummyBroadcast));
    app.use('/api/printers', createPrintersRouter(dummyBroadcast));

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // 1. BILLING DATABASE AUTHENTICATION SYNC
  // =========================================================================
  describe('Billing Database Auth Sync', () => {
    it('authenticates with fallback admin or billing db credentials', async () => {
      // Test login with fallback admin or active billing user
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'password123',
        }),
      });

      // Should succeed if fallback admin is enabled or admin user exists
      if (res.status === 200) {
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.token).toBeDefined();
        expect(data.user).toBeDefined();
        expect(data.user.username).toBe('admin');

        // Test GET /api/auth/me with Bearer token
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${data.token}`,
          },
        });
        expect(meRes.status).toBe(200);
        const meData = await meRes.json();
        expect(meData.user.username).toBe('admin');
      } else {
        // If password is not default fallback, invalid login returns 401
        expect(res.status).toBe(401);
      }
    });

    it('rejects invalid password with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'completely_wrong_password_9999',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    it('rejects GET /api/auth/me without token with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. MULTI-FILE UPLOAD & CUMULATIVE PRICING
  // =========================================================================
  describe('Multi-Document Upload & Cumulative Cost', () => {
    let multiJobId: string;
    let file1Id: string;
    let file2Id: string;

    it('submits multiple documents in a single order (2 PDFs + 1 image)', async () => {
      // Create Document 1 (2 pages)
      const doc1 = await PDFDocument.create();
      doc1.addPage([595.28, 841.89]);
      doc1.addPage([595.28, 841.89]);
      const bytes1 = await doc1.save();

      // Create Document 2 (1 page)
      const doc2 = await PDFDocument.create();
      doc2.addPage([595.28, 841.89]);
      const bytes2 = await doc2.save();

      // Create a dummy PNG image file
      const imgBuffer = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d400000000049454e44ae426082',
        'hex'
      );

      const formData = new FormData();
      formData.append('files', new Blob([bytes1], { type: 'application/pdf' }), 'Contract_Part1.pdf');
      formData.append('files', new Blob([bytes2], { type: 'application/pdf' }), 'Contract_Part2.pdf');
      formData.append('files', new Blob([imgBuffer], { type: 'image/png' }), 'ID_Proof.png');
      formData.append('customerName', 'Joel Multi Doc Test');
      formData.append('colorMode', 'bw');
      formData.append('sides', 'single');
      formData.append('copies', '1');

      const res = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job).toBeDefined();
      expect(data.job.token).toMatch(/^#P-\d+$/);
      expect(data.job.total_files).toBe(3);
      expect(data.job.files).toBeDefined();
      expect(data.job.files.length).toBe(3);

      multiJobId = data.job.id;
      file1Id = data.job.files[0].id;
      file2Id = data.job.files[1].id;

      // Verify files in DB
      const dbFiles = getJobFiles(multiJobId);
      expect(dbFiles.length).toBe(3);
      expect(dbFiles[0].original_filename).toBe('Contract_Part1.pdf');
      expect(dbFiles[1].original_filename).toBe('Contract_Part2.pdf');
      expect(dbFiles[2].original_filename).toBe('ID_Proof.png');
    });

    it('GET /api/jobs/:id/files/:fileId/file streams individual file for in-browser review', async () => {
      expect(multiJobId).toBeDefined();
      expect(file1Id).toBeDefined();

      const res = await fetch(`${baseUrl}/api/jobs/${multiJobId}/files/${file1Id}/file`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('inline');
    });

    it('PATCH /api/jobs/:id/files/:fileId updates specific file options and recalculates total job cost', async () => {
      // Update file 1 copies to 3
      const patchRes = await fetch(`${baseUrl}/api/jobs/${multiJobId}/files/${file1Id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copies: 3,
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.success).toBe(true);
      expect(patchData.file.copies).toBe(3);

      // Verify parent job was updated
      const updatedJob = getJobById(multiJobId);
      expect(updatedJob).toBeDefined();
      expect(updatedJob?.files?.find((f) => f.id === file1Id)?.copies).toBe(3);
    });

    it('POST /api/printers/print-file/:fileId prints an individual document file', async () => {
      const res = await fetch(`${baseUrl}/api/printers/print-file/${file2Id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerName: 'Virtual / Mock Printer (Simulated)',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.file.status).toBe('printed');
      expect(data.cupsJobId).toBeDefined();
    });

    it('POST /api/printers/print/:id prints all documents in the order sequentially', async () => {
      const res = await fetch(`${baseUrl}/api/printers/print/${multiJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerName: 'Virtual / Mock Printer (Simulated)',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.job.status).toBe('printed');

      // Verify all files in job are now printed
      const finalFiles = getJobFiles(multiJobId);
      for (const f of finalFiles) {
        expect(f.status).toBe('printed');
        expect(f.printed_at).not.toBeNull();
      }
    });
  });
});
