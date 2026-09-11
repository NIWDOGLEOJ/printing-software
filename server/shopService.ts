import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ShopDetails } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_SHOP_DETAILS: ShopDetails = {
  shopName: 'J MART',
  shopAddress: 'Ramapuram, Chennai - 600089',
  shopPhone: '044-24567890',
  shopEmail: 'print@jmart.com',
  gstNumber: '33AAAAA0000A1Z5',
  hasLogo: true,
  logoUrl: '/api/shop/logo',
  source: 'fallback',
};

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

export function getShopLogoPath(): string | null {
  const logoCandidates = [
    path.resolve(__dirname, '../../jmart_logo_transparent.png'),
    path.resolve(__dirname, '../../jmart_logo.png'),
    path.resolve(process.cwd(), '../jmart_logo_transparent.png'),
    path.resolve(process.cwd(), '../jmart_logo.png'),
  ];

  for (const candidate of logoCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getShopDetails(): ShopDetails {
  const candidates = getDbCandidates();

  for (const dbPath of candidates) {
    if (fs.existsSync(dbPath)) {
      try {
        const stats = fs.statSync(dbPath);
        if (stats.size === 0) continue;

        // Open strictly in READ-ONLY mode as required
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });

        // Check if settings table exists
        const tableCheck = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
        ).get();

        if (!tableCheck) {
          db.close();
          continue;
        }

        const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
        db.close();

        const map: Record<string, string> = {};
        for (const row of rows) {
          map[row.key] = row.value;
        }

        const shopName = map.shopName?.trim() || DEFAULT_SHOP_DETAILS.shopName;
        const shopAddress = map.shopAddress?.trim() || DEFAULT_SHOP_DETAILS.shopAddress;
        const shopPhone = map.shopPhone?.trim() || DEFAULT_SHOP_DETAILS.shopPhone;
        const shopEmail = map.shopEmail?.trim() || DEFAULT_SHOP_DETAILS.shopEmail;
        const gstNumber = map.gstNumber?.trim() || map.gstin?.trim() || DEFAULT_SHOP_DETAILS.gstNumber;

        return {
          shopName,
          shopAddress,
          shopPhone,
          shopEmail,
          gstNumber,
          hasLogo: true,
          logoUrl: '/api/shop/logo',
          source: 'pos_db',
        };
      } catch (err) {
        console.warn(`[ShopService] Failed to read settings from ${dbPath}:`, (err as Error).message);
      }
    }
  }

  // Graceful fallback to default "J MART" (Ramapuram, Chennai)
  return { ...DEFAULT_SHOP_DETAILS };
}
