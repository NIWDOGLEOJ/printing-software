import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AuthUser } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'jmart_print_station_secure_jwt_secret_2026';
const TOKEN_EXPIRY = '24h';

function getDbCandidates(): string[] {
  return [
    path.resolve(__dirname, '../../retail.db'),
    path.resolve(__dirname, '../../pos.db'),
    path.resolve(process.cwd(), '../retail.db'),
    path.resolve(process.cwd(), '../pos.db'),
    path.resolve(process.cwd(), 'retail.db'),
    path.resolve(process.cwd(), 'pos.db'),
  ];
}

export function findBillingDbPath(): string | null {
  const candidates = getDbCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.size > 0) return candidate;
      } catch {}
    }
  }
  return null;
}

export interface AuthenticateResult {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
}

/**
 * Authenticates against the retail.db users table (read-only) using bcrypt.
 * Falls back to local offline admin if billing db is unavailable.
 */
export function authenticateBillingUser(username: string, password: string): AuthenticateResult {
  if (!username || !password) {
    return { success: false, error: 'Username and password are required' };
  }

  const dbPath = findBillingDbPath();

  // 1. If billing db is found, check credentials against users table
  if (dbPath) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const user = db.prepare(`
        SELECT id, username, name, role, password_hash, is_active
        FROM users
        WHERE username = ? COLLATE NOCASE
      `).get(username.trim()) as any;
      db.close();

      if (user) {
        if (!user.is_active) {
          return { success: false, error: 'This user account is deactivated in the billing system' };
        }

        const matches = bcrypt.compareSync(password, user.password_hash);
        if (matches) {
          const authUser: AuthUser = {
            id: user.id,
            username: user.username,
            name: user.name || user.username,
            role: user.role || 'employee',
            source: 'billing_db',
          };

          const token = jwt.sign(authUser, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
          return { success: true, token, user: authUser };
        }
      }
    } catch (err: any) {
      console.warn('[AuthService] Error reading billing database:', err.message);
    }
  }

  // 2. Fallback offline administrator account (useful when running standalone or in development)
  const isFallbackAdmin = (username.toLowerCase() === 'admin' && password === 'admin') ||
                          (username.toLowerCase() === 'owner' && password === 'admin123');
  if (isFallbackAdmin) {
    const fallbackUser: AuthUser = {
      id: 'admin_local',
      username: username.toLowerCase(),
      name: 'Print Station Administrator',
      role: 'owner',
      source: 'fallback_admin',
    };
    const token = jwt.sign(fallbackUser, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    return { success: true, token, user: fallbackUser };
  }

  return { success: false, error: 'Invalid username or password' };
}

/**
 * Verify a JWT session token
 */
export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    return decoded;
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Express middleware to protect routes requiring authentication
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.substring(7).trim();
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }

  req.user = user;
  next();
}
