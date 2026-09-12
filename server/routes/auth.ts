import { Router, Request, Response } from 'express';
import { authenticateBillingUser, verifyToken, AuthenticatedRequest, requireAuth } from '../authService.js';

export function createAuthRouter(): Router {
  const router = Router();

  // POST /api/auth/login
  router.post('/login', (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const result = authenticateBillingUser(username, password);
      if (!result.success) {
        return res.status(401).json({ error: result.error || 'Invalid credentials' });
      }

      res.json({
        success: true,
        token: result.token,
        user: result.user,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/auth/me
  router.get('/me', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ authenticated: false, error: 'No token provided' });
    }

    const token = authHeader.substring(7).trim();
    const user = verifyToken(token);
    if (!user) {
      return res.status(401).json({ authenticated: false, error: 'Token expired or invalid' });
    }

    res.json({ authenticated: true, user });
  });

  // POST /api/auth/logout
  router.post('/logout', (_req: Request, res: Response) => {
    res.json({ success: true, message: 'Logged out successfully' });
  });

  return router;
}
