import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { createJobsRouter } from '../server/routes/jobs.js';
import { createPrintersRouter } from '../server/routes/printers.js';
import { createShopRouter } from '../server/routes/shop.js';
import { createSettingsRouter } from '../server/routes/settings.js';
import { createTunnelRouter } from '../server/routes/tunnel.js';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

describe('API Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const dummyBroadcast = () => {};
    app.use('/api/jobs', createJobsRouter(dummyBroadcast));
    app.use('/api/printers', createPrintersRouter(dummyBroadcast));
    app.use('/api/shop', createShopRouter());
    app.use('/api/settings', createSettingsRouter(dummyBroadcast));
    app.use('/api/tunnel', createTunnelRouter(dummyBroadcast));

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

  it('GET /api/shop returns shop details', async () => {
    const res = await fetch(`${baseUrl}/api/shop`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shopName).toBeDefined();
    expect(data.shopAddress).toBeDefined();
    expect(data.hasLogo).toBe(true);
  });

  it('GET /api/shop/logo returns an image or SVG', async () => {
    const res = await fetch(`${baseUrl}/api/shop/logo`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toMatch(/image/);
  });

  it('GET /api/printers returns printer list', async () => {
    const res = await fetch(`${baseUrl}/api/printers`);
    expect(res.status).toBe(200);
    const printers = await res.json();
    expect(Array.isArray(printers)).toBe(true);
    expect(printers.length).toBeGreaterThan(0);
  });

  it('GET /api/settings and PUT /api/settings work properly', async () => {
    const getRes = await fetch(`${baseUrl}/api/settings`);
    expect(getRes.status).toBe(200);
    const settings = await getRes.json();
    expect(settings.bw_price_per_page).toBeDefined();

    const putRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bw_price_per_page: 3 }),
    });
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.bw_price_per_page).toBe(3);

    // Reset back to 2
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bw_price_per_page: 2 }),
    });
  });

  it('POST /api/jobs submits a new print job and returns token', async () => {
    // Create a valid 2-page PDF using pdf-lib
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.28, 841.89]);
    pdfDoc.addPage([595.28, 841.89]);
    const pdfBytes = await pdfDoc.save();
    const dummyPath = path.resolve('/tmp/test_valid_upload.pdf');
    fs.writeFileSync(dummyPath, pdfBytes);

    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(dummyPath)], { type: 'application/pdf' });
    formData.append('file', fileBlob, 'sample_contract.pdf');
    formData.append('customerName', 'Joel Alex');
    formData.append('colorMode', 'bw');
    formData.append('sides', 'duplex');
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
    expect(data.job.customer_name).toBe('Joel Alex');
    expect(data.job.status).toBe('pending');
    expect(data.job.sides).toBe('duplex');
    expect(data.job.page_count).toBe(2);

    const createdJobId = data.job.id;

    // Verify GET /api/jobs/:id
    const getJobRes = await fetch(`${baseUrl}/api/jobs/${createdJobId}`);
    expect(getJobRes.status).toBe(200);
    const fetchedJob = await getJobRes.json();
    expect(fetchedJob.id).toBe(createdJobId);

    // Verify GET /api/jobs/:id/file
    const getFileRes = await fetch(`${baseUrl}/api/jobs/${createdJobId}/file`);
    expect(getFileRes.status).toBe(200);
    expect(getFileRes.headers.get('content-type')).toBe('application/pdf');

    // Dispatch print to Virtual Printer with updated copies: 3
    const printRes = await fetch(`${baseUrl}/api/printers/print/${createdJobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printerName: 'Virtual / Mock Printer (Simulated)',
        copies: 3,
      }),
    });
    expect(printRes.status).toBe(200);
    const printData = await printRes.json();
    expect(printData.success).toBe(true);
    expect(printData.job.status).toBe('printed');
    // 2 pages duplex = 1 sheet * ₹5 (active printer rate from GX4070) = ₹5 * 3 copies = ₹15
    expect(printData.job.estimated_cost).toBe(15);

    // Toggle job status back to pending and verify printed_at is cleared
    const patchRes = await fetch(`${baseUrl}/api/jobs/${createdJobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    expect(patchRes.status).toBe(200);
    const patchedJob = await patchRes.json();
    expect(patchedJob.status).toBe('pending');
    expect(patchedJob.printed_at).toBeNull();

    // Clean up DELETE /api/jobs/:id
    const delRes = await fetch(`${baseUrl}/api/jobs/${createdJobId}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // Clean up tmp file
    if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
  });

  it('POST /api/jobs rejects invalid file extensions with 400 Bad Request JSON', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['disallowed text content'], { type: 'text/plain' }), 'test.txt');

    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(400);
    const errData = await res.json();
    expect(errData.error).toMatch(/Only PDF, JPG, PNG, and WebP documents are allowed/);
  });
});
