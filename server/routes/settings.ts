import { Router, Request, Response } from 'express';
import { getPricingSettings, updatePricingSettings, getEffectivePricing } from '../db.js';

export function createSettingsRouter(broadcast: (message: any) => void) {
  const router = Router();

  // GET /api/settings
  router.get('/', (_req: Request, res: Response) => {
    try {
      const settings = getPricingSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/settings
  router.put('/', (req: Request, res: Response) => {
    try {
      const updated = updatePricingSettings(req.body);
      broadcast({
        type: 'PRICING_UPDATED',
        pricing: getEffectivePricing(),
      });
      broadcast({
        type: 'SETTINGS_UPDATED',
        settings: updated,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
