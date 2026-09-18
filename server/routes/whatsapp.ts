import { Router, Request, Response } from 'express';
import {
  startWhatsAppClient,
  disconnectWhatsApp,
  getWhatsAppCurrentStatus,
} from '../whatsappService.js';
import { getWhatsAppSettings, updateWhatsAppSettings } from '../db.js';

export function createWhatsAppRouter() {
  const router = Router();

  // GET /api/whatsapp/status
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const status = getWhatsAppCurrentStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/whatsapp/connect
  router.post('/connect', async (_req: Request, res: Response) => {
    try {
      const status = await startWhatsAppClient();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/whatsapp/disconnect
  router.post('/disconnect', async (_req: Request, res: Response) => {
    try {
      const status = await disconnectWhatsApp();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/whatsapp/settings
  router.get('/settings', (_req: Request, res: Response) => {
    try {
      const settings = getWhatsAppSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/whatsapp/settings
  router.put('/settings', (req: Request, res: Response) => {
    try {
      const updated = updateWhatsAppSettings(req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
