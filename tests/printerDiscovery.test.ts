import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { createPrintersRouter } from '../server/routes/printers.js';
import {
  discoverAllPrinters,
  getLatestDiscoveredPrinters,
  scanPrintersNow,
  linkDiscoveredPrinterToProfile,
  createProfileFromDiscovered,
} from '../server/printerDiscoveryService.js';
import {
  getAllPrinterProfiles,
  upsertPrinterProfile,
  deletePrinterProfile,
  seedDefaultPrinterProfiles,
} from '../server/db.js';

describe('Printer Auto-Discovery Service & API Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    seedDefaultPrinterProfiles(true);
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const dummyBroadcast = () => {};
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
    seedDefaultPrinterProfiles(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it(
    'discoverAllPrinters scans system and network, returning discovered list',
    async () => {
      const discovered = await discoverAllPrinters();
      expect(Array.isArray(discovered)).toBe(true);

      if (discovered.length > 0) {
        const first = discovered[0];
        expect(first.id).toBeDefined();
        expect(first.name).toBeDefined();
        expect(first.connectionType).toBeDefined();
        expect(typeof first.supportsColor).toBe('boolean');
        expect(typeof first.supportsDuplex).toBe('boolean');
        expect(typeof first.isOnline).toBe('boolean');
        expect(first.status).toBeDefined();
      }
    },
    15000
  );

  it('getLatestDiscoveredPrinters returns cached results immediately', () => {
    const cached = getLatestDiscoveredPrinters();
    expect(Array.isArray(cached)).toBe(true);
  });

  it('GET /api/printers/discovered returns 200 with printer array', async () => {
    const res = await fetch(`${baseUrl}/api/printers/discovered`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it(
    'POST /api/printers/scan executes active scan and returns fresh count and printers',
    async () => {
      const res = await fetch(`${baseUrl}/api/printers/scan`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(typeof data.count).toBe('number');
      expect(Array.isArray(data.printers)).toBe(true);
    },
    15000
  );

  it(
    'correctly maps discovered Canon GX4000 series to gx4070 profile if present',
    async () => {
      const discovered = await discoverAllPrinters();
      const gx = discovered.find(
        (d) =>
          d.name.toLowerCase().includes('gx4000') ||
          d.name.toLowerCase().includes('gx4070') ||
          (d.cupsPrinterName && d.cupsPrinterName.toLowerCase().includes('gx4000'))
      );

      if (gx) {
        expect(gx.matchedProfileId).toBe('gx4070');
        expect(gx.supportsColor).toBe(true);
        expect(gx.supportsDuplex).toBe(true);
        expect(gx.connectionType).toMatch(/network_bonjour|cups_queue/);
      }
    },
    15000
  );

  it(
    'POST /api/printers/link-profile links a device to an existing profile',
    async () => {
      const discovered = await discoverAllPrinters();
      if (discovered.length === 0) return;

      const device = discovered[0];
      const profiles = getAllPrinterProfiles();
      if (profiles.length === 0) return;

      const targetProfile = profiles[0];

      const res = await fetch(`${baseUrl}/api/printers/link-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discoveredId: device.id,
          profileId: targetProfile.id,
        }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.id).toBe(targetProfile.id);
      expect(updated.cups_printer_name).toBeDefined();
    },
    15000
  );

  it(
    'POST /api/printers/create-profile-from-device creates a new profile for unmapped hardware',
    async () => {
      const discovered = await discoverAllPrinters();
      if (discovered.length === 0) return;

      const device = discovered[0];

      const res = await fetch(`${baseUrl}/api/printers/create-profile-from-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discoveredId: device.id,
        }),
      });

      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.id).toBeDefined();
      expect(created.name).toBe(device.name);
      expect(created.supports_color).toBe(device.supportsColor);
      expect(created.supports_duplex).toBe(device.supportsDuplex);

      // Clean up newly created test profile to prevent polluting subsequent test runs
      deletePrinterProfile(created.id);
    },
    15000
  );
});
