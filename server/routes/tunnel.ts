import { Router, Request, Response } from 'express';
import {
  getTunnelStatus,
  startCloudflareTunnel,
  stopCloudflareTunnel,
  setManualTunnelUrl,
} from '../tunnelService.js';

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

  // POST /api/tunnel/start
  router.post('/start', async (_req: Request, res: Response) => {
    try {
      const status = await startCloudflareTunnel((updatedStatus) => {
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
      const status = await stopCloudflareTunnel();
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
