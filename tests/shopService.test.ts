import { describe, it, expect } from 'vitest';
import { getShopDetails, getShopLogoPath, DEFAULT_SHOP_DETAILS } from '../server/shopService.js';
import fs from 'fs';

describe('Shop Service & POS DB Integration', () => {
  it('reads shop details with read-only integrity or falls back safely', () => {
    const details = getShopDetails();
    expect(details).toBeDefined();
    expect(typeof details.shopName).toBe('string');
    expect(details.shopName.length).toBeGreaterThan(0);
    expect(typeof details.shopAddress).toBe('string');
    expect(['pos_db', 'fallback']).toContain(details.source);
  });

  it('locates the shop logo image when available in parent dir', () => {
    const logoPath = getShopLogoPath();
    if (logoPath) {
      expect(fs.existsSync(logoPath)).toBe(true);
    }
  });

  it('has valid fallback values with J MART branding and Ramapuram, Chennai address', () => {
    expect(DEFAULT_SHOP_DETAILS.shopName).toBe('J MART');
    expect(DEFAULT_SHOP_DETAILS.shopAddress).toContain('Ramapuram, Chennai');
    expect(DEFAULT_SHOP_DETAILS.source).toBe('fallback');
  });
});
