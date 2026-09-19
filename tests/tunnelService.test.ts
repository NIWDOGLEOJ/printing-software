import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getTunnelStatus,
  setManualTunnelUrl,
  setServerPort,
  getLocalIpAddresses,
  stopTunnel,
} from '../server/tunnelService.js';
import { getTunnelSettings, updateTunnelSettings } from '../server/db.js';

describe('Tunnel Service & Settings Tests', () => {
  beforeEach(async () => {
    setServerPort(4000);
    await stopTunnel();
    updateTunnelSettings({ manual_url: '', auto_start: true, preferred_provider: 'auto' });
  });

  afterEach(async () => {
    await stopTunnel();
  });

  it('reports default status structure with QR code and local addresses', async () => {
    const status = await getTunnelStatus();
    expect(status).toBeDefined();
    expect(typeof status.isRunning).toBe('boolean');
    expect(Array.isArray(status.localUrls)).toBe(true);
    expect(status.localUrls.length).toBeGreaterThan(0);
    expect(status.activeUrl).toBeDefined();
    expect(status.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(status.autoStart).toBe(true);
  });

  it('updates manual tunnel URL and reflects in activeUrl and DB', async () => {
    const customUrl = 'https://custom-print.shop.lan';
    const status = await setManualTunnelUrl(customUrl);

    expect(status.tunnelUrl).toBe(customUrl);
    expect(status.activeUrl).toBe(customUrl);
    expect(status.provider).toBe('custom');
    expect(status.isRunning).toBe(true);

    const savedSettings = getTunnelSettings();
    expect(savedSettings.manual_url).toBe(customUrl);

    // Reset
    const cleared = await setManualTunnelUrl(null);
    expect(cleared.tunnelUrl).toBeNull();
    expect(cleared.provider).toBe('none');
  });

  it('persists tunnel settings in SQLite db', () => {
    updateTunnelSettings({
      auto_start: false,
      preferred_provider: 'ssh',
    });

    const settings = getTunnelSettings();
    expect(settings.auto_start).toBe(false);
    expect(settings.preferred_provider).toBe('ssh');

    // Toggle back
    updateTunnelSettings({
      auto_start: true,
      preferred_provider: 'auto',
    });
    const updated = getTunnelSettings();
    expect(updated.auto_start).toBe(true);
    expect(updated.preferred_provider).toBe('auto');
  });

  it('returns valid local IP addresses', () => {
    const ips = getLocalIpAddresses();
    expect(ips.length).toBeGreaterThan(0);
    ips.forEach((ip) => {
      expect(ip).toMatch(/^http:\/\/[^:]+:4000$/);
    });
  });
});
