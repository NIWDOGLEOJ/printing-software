import { Router, Request, Response } from 'express';
import { getShopDetails, getShopLogoPath } from '../shopService.js';

export function createShopRouter() {
  const router = Router();

  // GET /api/shop - Return shop info
  router.get('/', (_req: Request, res: Response) => {
    try {
      const details = getShopDetails();
      res.json(details);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/shop/logo - Stream shop logo or fallback SVG
  router.get('/logo', (_req: Request, res: Response) => {
    try {
      const logoPath = getShopLogoPath();
      if (logoPath) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(logoPath);
      }

      // Fallback SVG if no image file exists
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60">
          <rect width="200" height="60" rx="8" fill="#15803d"/>
          <text x="24" y="38" font-family="system-ui, sans-serif" font-weight="900" font-size="24" fill="#ffffff">J MART</text>
          <text x="120" y="36" font-family="system-ui, sans-serif" font-weight="600" font-size="12" fill="#dcfce7">PRINT</text>
        </svg>
      `.trim();

      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } catch (err: any) {
      res.status(500).send('Error loading logo');
    }
  });

  return router;
}
