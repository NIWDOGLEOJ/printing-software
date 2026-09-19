import { Router, Request, Response } from 'express';
import {
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  setManualTunnelUrl,
} from '../tunnelService.js';
import { getTunnelSettings, updateTunnelSettings } from '../db.js';

export function createTunnelRouter(broadcast: (message: any) => void) {
  const router = Router();

  // GET /api/tunnel
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const status = await getTunnelStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/tunnel/settings
  router.get('/settings', (_req: Request, res: Response) => {
    try {
      const settings = getTunnelSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tunnel/settings
  router.post('/settings', async (req: Request, res: Response) => {
    try {
      const { auto_start, preferred_provider } = req.body;
      const updated = updateTunnelSettings({
        auto_start: auto_start !== undefined ? Boolean(auto_start) : undefined,
        preferred_provider,
      });
      const status = await getTunnelStatus();
      broadcast({
        type: 'TUNNEL_UPDATED',
        tunnel: status,
      });
      res.json({ settings: updated, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tunnel/start
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const provider = req.body?.provider || 'auto';
      const status = await startTunnel(provider, (updatedStatus) => {
        broadcast({
          type: 'TUNNEL_UPDATED',
          tunnel: updatedStatus,
        });
      });

      broadcast({
        type: 'TUNNEL_UPDATED',
        tunnel: status,
      });

      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tunnel/stop
  router.post('/stop', async (_req: Request, res: Response) => {
    try {
      const status = await stopTunnel();
      broadcast({
        type: 'TUNNEL_UPDATED',
        tunnel: status,
      });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tunnel/set-url
  router.post('/set-url', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const status = await setManualTunnelUrl(url);
      broadcast({
        type: 'TUNNEL_UPDATED',
        tunnel: status,
      });
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
