import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { calculateEffectivePricing, findOptimalPrinter } from '../shared/costCalculator.js';
import { PrinterProfile, PrinterInfo } from '../shared/types.js';
import { createPrintersRouter } from '../server/routes/printers.js';
import { createSettingsRouter } from '../server/routes/settings.js';
import { createJobsRouter } from '../server/routes/jobs.js';
import {
  getAllPrinterProfiles,
  getPrinterProfileById,
  updatePrinterProfile,
  deletePrinterProfile,
  seedDefaultPrinterProfiles,
  getEffectivePricing,
  getPricingSettings,
  updatePricingSettings,
} from '../server/db.js';

describe('Lowest Available Price Algorithm & Printer Profiles (Unit Tests)', () => {
  const profileIR4225: PrinterProfile = {
    id: 'ir4225',
    name: 'Canon imageRUNNER 4225',
    cups_printer_name: 'Canon_IR4225',
    supports_color: false,
    supports_duplex: true,
    duplex_enabled: true,
    is_active: false, // in maintenance
    bw_single_price: 2,
    bw_duplex_price: 3,
    color_single_price: 0,
    color_duplex_price: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const profileGX4070: PrinterProfile = {
    id: 'gx4070',
    name: 'Canon MAXIFY GX4070',
    cups_printer_name: 'Canon_GX4000_series',
    supports_color: true,
    supports_duplex: true,
    duplex_enabled: true,
    is_active: true, // operational
    bw_single_price: 3,
    bw_duplex_price: 5,
    color_single_price: 10,
    color_duplex_price: 18,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('Scenario 1: When IR4225 is in maintenance, customer sees lowest available rate from GX4070 (B/W Single ₹3, Duplex ₹5)', () => {
    const profiles = [
      { ...profileIR4225, is_active: false },
      { ...profileGX4070, is_active: true },
    ];

    const result = calculateEffectivePricing(profiles);

    expect(result.bw_price_per_page).toBe(3); // From GX4070
    expect(result.duplex_sheet_price_bw).toBe(5); // From GX4070
    expect(result.color_price_per_page).toBe(10); // From GX4070
    expect(result.duplex_sheet_price_color).toBe(18); // From GX4070
    expect(result.color_available).toBe(true);
    expect(result.duplex_available).toBe(true);
    expect(result.active_printers_count).toBe(1);
    expect(result.active_printers).toContain('Canon MAXIFY GX4070');
  });

  it('Scenario 2: When IR4225 is activated, customer sees lowest available rate (B/W Single ₹2, Duplex ₹3)', () => {
    const profiles = [
      { ...profileIR4225, is_active: true },
      { ...profileGX4070, is_active: true },
    ];

    const result = calculateEffectivePricing(profiles);

    // B/W Single: min(2, 3) = 2
    expect(result.bw_price_per_page).toBe(2);
    // B/W Duplex: min(3, 5) = 3
    expect(result.duplex_sheet_price_bw).toBe(3);
    // Color still available from GX4070
    expect(result.color_price_per_page).toBe(10);
    expect(result.duplex_sheet_price_color).toBe(18);
    expect(result.color_available).toBe(true);
    expect(result.duplex_available).toBe(true);
    expect(result.active_printers_count).toBe(2);
  });

  it('Scenario 3: When GX4070 goes to maintenance and IR4225 is active, Color is marked unavailable', () => {
    const profiles = [
      { ...profileIR4225, is_active: true },
      { ...profileGX4070, is_active: false },
    ];

    const result = calculateEffectivePricing(profiles);

    expect(result.bw_price_per_page).toBe(2);
    expect(result.duplex_sheet_price_bw).toBe(3);
    // Color unavailable because IR4225 does not support color
    expect(result.color_available).toBe(false);
    expect(result.duplex_available).toBe(true);
    expect(result.active_printers_count).toBe(1);
  });

  it('Scenario 4: When per-printer Duplex is disabled (e.g. printer won\'t print front & back), Duplex is marked unavailable', () => {
    // GX4070 duplex disabled, IR4225 in maintenance
    const profiles = [
      { ...profileIR4225, is_active: false },
      { ...profileGX4070, is_active: true, duplex_enabled: false },
    ];

    const result = calculateEffectivePricing(profiles);

    expect(result.bw_price_per_page).toBe(3);
    expect(result.color_available).toBe(true);
    expect(result.duplex_available).toBe(false); // Duplex unavailable!
  });

  it('Scenario 5: When global Duplex is disabled in settings, Duplex is marked unavailable for customer', () => {
    const profiles = [
      { ...profileIR4225, is_active: true },
      { ...profileGX4070, is_active: true },
    ];

    const result = calculateEffectivePricing(profiles, { globalDuplexEnabled: false });

    expect(result.duplex_available).toBe(false);
    expect(result.global_duplex_enabled).toBe(false);
  });

  it('Scenario 6: When all printers are in maintenance, system falls back safely without crashing', () => {
    const profiles = [
      { ...profileIR4225, is_active: false },
      { ...profileGX4070, is_active: false },
    ];

    const result = calculateEffectivePricing(profiles);

    expect(result.has_active_printers).toBe(false);
    expect(result.active_printers_count).toBe(0);
    expect(result.color_available).toBe(false);
    expect(result.duplex_available).toBe(false);
    expect(result.bw_price_per_page).toBeGreaterThan(0);
  });
});

describe('Smart Routing Algorithm (findOptimalPrinter)', () => {
  const discoveredPrinters: PrinterInfo[] = [
    { name: 'Canon_GX4000_series', isDefault: true, status: 'idle', rawStatus: 'idle' },
    { name: 'Canon_IR4225', isDefault: false, status: 'idle', rawStatus: 'idle' },
    { name: 'Virtual / Mock Printer (Simulated)', isDefault: false, status: 'idle', rawStatus: 'idle' },
  ];

  const profileIR4225: PrinterProfile = {
    id: 'ir4225',
    name: 'Canon imageRUNNER 4225',
    cups_printer_name: 'Canon_IR4225',
    supports_color: false,
    supports_duplex: true,
    duplex_enabled: true,
    is_active: false,
    bw_single_price: 2,
    bw_duplex_price: 3,
    color_single_price: 0,
    color_duplex_price: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const profileGX4070: PrinterProfile = {
    id: 'gx4070',
    name: 'Canon MAXIFY GX4070',
    cups_printer_name: 'Canon_GX4000_series',
    supports_color: true,
    supports_duplex: true,
    duplex_enabled: true,
    is_active: true,
    bw_single_price: 3,
    bw_duplex_price: 5,
    color_single_price: 10,
    color_duplex_price: 18,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('smart-routes Color order to Canon_GX4000_series (only active printer supporting color)', () => {
    const selected = findOptimalPrinter({
      colorMode: 'color',
      sides: 'single',
      profiles: [{ ...profileIR4225, is_active: true }, { ...profileGX4070, is_active: true }],
      printers: discoveredPrinters,
    });

    expect(selected).toBe('Canon_GX4000_series');
  });

  it('smart-routes B/W order to Canon_IR4225 when operational due to lower rate (₹2 vs ₹3)', () => {
    const selected = findOptimalPrinter({
      colorMode: 'bw',
      sides: 'single',
      profiles: [{ ...profileIR4225, is_active: true }, { ...profileGX4070, is_active: true }],
      printers: discoveredPrinters,
    });

    expect(selected).toBe('Canon_IR4225');
  });

  it('smart-routes B/W order to Canon_GX4000_series when IR4225 is in maintenance', () => {
    const selected = findOptimalPrinter({
      colorMode: 'bw',
      sides: 'single',
      profiles: [{ ...profileIR4225, is_active: false }, { ...profileGX4070, is_active: true }],
      printers: discoveredPrinters,
    });

    expect(selected).toBe('Canon_GX4000_series');
  });

  it('smart-routes Duplex B/W order to GX4000 when IR4225 has duplex disabled', () => {
    const selected = findOptimalPrinter({
      colorMode: 'bw',
      sides: 'duplex',
      profiles: [
        { ...profileIR4225, is_active: true, duplex_enabled: false },
        { ...profileGX4070, is_active: true, duplex_enabled: true },
      ],
      printers: discoveredPrinters,
    });

    // Must route to GX4070 because IR4225 cannot print duplex
    expect(selected).toBe('Canon_GX4000_series');
  });

  it('never routes Color order to Canon_IR4225 when GX4070 is in maintenance', () => {
    const selected = findOptimalPrinter({
      colorMode: 'color',
      sides: 'single',
      profiles: [
        { ...profileIR4225, is_active: true },
        { ...profileGX4070, is_active: false },
      ],
      printers: discoveredPrinters,
    });

    // Must NOT select IR4225 because IR4225 is B/W only
    expect(selected).not.toBe('Canon_IR4225');
  });
});

describe('Printer Profiles API & Dynamic Pricing Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastBroadcast: any = null;

  beforeAll(async () => {
    seedDefaultPrinterProfiles(true);
    updatePricingSettings({ global_duplex_enabled: true });
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const broadcast = (msg: any) => {
      lastBroadcast = msg;
    };

    app.use('/api/printers', createPrintersRouter(broadcast));
    app.use('/api/settings', createSettingsRouter(broadcast));
    app.use('/api/jobs', createJobsRouter(broadcast));

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
    seedDefaultPrinterProfiles(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/printers/profiles returns configured hardware profiles including IR4225 and GX4070', async () => {
    const res = await fetch(`${baseUrl}/api/printers/profiles`);
    expect(res.status).toBe(200);
    const profiles = (await res.json()) as PrinterProfile[];

    expect(Array.isArray(profiles)).toBe(true);
    const ir = profiles.find((p) => p.id === 'ir4225');
    const gx = profiles.find((p) => p.id === 'gx4070');

    expect(ir).toBeDefined();
    expect(ir?.name).toBe('Canon imageRUNNER 4225');
    expect(ir?.supports_color).toBe(false);

    expect(gx).toBeDefined();
    expect(gx?.name).toBe('Canon MAXIFY GX4070');
    expect(gx?.supports_color).toBe(true);
  });

  it('GET /api/printers/pricing returns effective pricing and capability availability', async () => {
    const res = await fetch(`${baseUrl}/api/printers/pricing`);
    expect(res.status).toBe(200);
    const pricing = await res.json();

    expect(pricing.bw_price_per_page).toBeDefined();
    expect(pricing.color_price_per_page).toBeDefined();
    expect(typeof pricing.color_available).toBe('boolean');
    expect(typeof pricing.duplex_available).toBe('boolean');
  });

  it('PATCH /api/printers/profiles/:id toggles maintenance status and triggers WebSocket broadcasts', async () => {
    // 1. Activate IR4225
    const patchRes = await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.is_active).toBe(true);
    expect(lastBroadcast?.type).toBe('SETTINGS_UPDATED');

    // Effective pricing now has lowest B/W single rate = ₹2
    const pricingRes = await fetch(`${baseUrl}/api/printers/pricing`);
    const pricing = await pricingRes.json();
    expect(pricing.bw_price_per_page).toBe(2);
    expect(pricing.duplex_sheet_price_bw).toBe(3);

    // 2. Put IR4225 back in maintenance
    const deactRes = await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    expect(deactRes.status).toBe(200);
    const deact = await deactRes.json();
    expect(deact.is_active).toBe(false);

    // Effective pricing now switches to GX4070 rate = ₹3
    const pricingRes2 = await fetch(`${baseUrl}/api/printers/pricing`);
    const pricing2 = await pricingRes2.json();
    expect(pricing2.bw_price_per_page).toBe(3);
    expect(pricing2.duplex_sheet_price_bw).toBe(5);
  });

  it('PATCH /api/printers/profiles/:id toggles per-printer duplex capability', async () => {
    updatePricingSettings({ global_duplex_enabled: true });
    // Ensure IR4225 is in maintenance
    await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });

    // Disable duplex on GX4070 while IR4225 is in maintenance
    const patchRes = await fetch(`${baseUrl}/api/printers/profiles/gx4070`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplex_enabled: false }),
    });
    expect(patchRes.status).toBe(200);

    const pricingRes = await fetch(`${baseUrl}/api/printers/pricing`);
    const pricing = await pricingRes.json();
    expect(pricing.duplex_available).toBe(false);

    // Restore duplex on GX4070
    await fetch(`${baseUrl}/api/printers/profiles/gx4070`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplex_enabled: true }),
    });

    const restoredPricing = await (await fetch(`${baseUrl}/api/printers/pricing`)).json();
    expect(restoredPricing.duplex_available).toBe(true);
  });

  it('POST /api/jobs calculates job estimated_cost using lowest active rates (₹3 with IR4225 in maintenance, ₹2 when active)', async () => {
    // 1. Ensure IR4225 is in maintenance
    await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });

    // Create 1-page PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.28, 841.89]);
    const pdfBytes = await pdfDoc.save();
    const testPdfPath = path.resolve('/tmp/test_pricing_sample.pdf');
    fs.writeFileSync(testPdfPath, pdfBytes);

    const formData1 = new FormData();
    formData1.append('file', new Blob([fs.readFileSync(testPdfPath)], { type: 'application/pdf' }), 'test1.pdf');
    formData1.append('customerName', 'Maintenance Customer');
    formData1.append('colorMode', 'bw');
    formData1.append('sides', 'single');
    formData1.append('copies', '1');

    const res1 = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formData1,
    });
    expect(res1.status).toBe(201);
    const data1 = await res1.json();
    // IR4225 is in maintenance, so GX4070 rate of ₹3 applies!
    expect(data1.job.estimated_cost).toBe(3);

    // 2. Activate IR4225
    await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });

    const formData2 = new FormData();
    formData2.append('file', new Blob([fs.readFileSync(testPdfPath)], { type: 'application/pdf' }), 'test2.pdf');
    formData2.append('customerName', 'Active Customer');
    formData2.append('colorMode', 'bw');
    formData2.append('sides', 'single');
    formData2.append('copies', '1');

    const res2 = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formData2,
    });
    expect(res2.status).toBe(201);
    const data2 = await res2.json();
    // IR4225 is active, so lowest rate of ₹2 applies!
    expect(data2.job.estimated_cost).toBe(2);

    // Reset IR4225 back to maintenance (factory default state)
    await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
  });

  it('POST /api/jobs auto-fallbacks unavailable capabilities safely', async () => {
    // Both IR4225 and GX4070 duplex disabled
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global_duplex_enabled: false }),
    });

    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595.28, 841.89]);
    const pdfBytes = await pdfDoc.save();
    const testPdfPath = path.resolve('/tmp/test_fallback_sample.pdf');
    fs.writeFileSync(testPdfPath, pdfBytes);

    const formData = new FormData();
    formData.append('file', new Blob([fs.readFileSync(testPdfPath)], { type: 'application/pdf' }), 'fallback.pdf');
    formData.append('customerName', 'Duplex Request Customer');
    formData.append('colorMode', 'bw');
    formData.append('sides', 'duplex'); // Duplex requested, but disabled globally
    formData.append('copies', '1');

    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      body: formData,
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    // Should fallback to single-sided safely
    expect(data.job.sides).toBe('single');

    // Restore global duplex
    await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ global_duplex_enabled: true }),
    });
  });

  it('POST /api/printers/profiles/reset restores default factory profiles', async () => {
    // Delete IR4225 profile
    const delRes = await fetch(`${baseUrl}/api/printers/profiles/ir4225`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/printers/profiles/ir4225`);
    expect(getRes.status).toBe(404);

    // Call reset endpoint
    const resetRes = await fetch(`${baseUrl}/api/printers/profiles/reset`, {
      method: 'POST',
    });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.success).toBe(true);

    // IR4225 is restored
    const restoredRes = await fetch(`${baseUrl}/api/printers/profiles/ir4225`);
    expect(restoredRes.status).toBe(200);
    const restored = await restoredRes.json();
    expect(restored.name).toBe('Canon imageRUNNER 4225');
    expect(restored.is_active).toBe(false);
  });
});
