import { describe, it, expect } from 'vitest';
import { calculatePrintCost, parsePageRange, DEFAULT_PRICING } from '../shared/costCalculator.js';
import { formatWhatsAppReceipt, formatWhatsAppUpdateReceipt } from '../server/whatsappService.js';
import { PrintJob } from '../shared/types.js';

describe('Print Configuration Modal & WhatsApp 1-Tap Link Tests', () => {
  it('correctly calculates instant cost for Black & White vs Color prints', () => {
    const pricing = {
      ...DEFAULT_PRICING,
      bw_price_per_page: 2,
      color_price_per_page: 10,
    };

    // B&W single sided: 12 pages * ₹2 = ₹24
    const bwCalc = calculatePrintCost({
      totalPages: 12,
      pageRange: 'all',
      colorMode: 'bw',
      sides: 'single',
      copies: 1,
      pricing,
    });
    expect(bwCalc.totalCost).toBe(24);
    expect(bwCalc.sheets).toBe(12);
    expect(bwCalc.effectivePages).toBe(12);

    // Color single sided: 12 pages * ₹10 = ₹120
    const colorCalc = calculatePrintCost({
      totalPages: 12,
      pageRange: 'all',
      colorMode: 'color',
      sides: 'single',
      copies: 1,
      pricing,
    });
    expect(colorCalc.totalCost).toBe(120);
    expect(colorCalc.sheets).toBe(12);
  });

  it('correctly calculates paper sheets and savings for Front & Back (Duplex)', () => {
    const pricing = {
      ...DEFAULT_PRICING,
      bw_price_per_page: 2,
      duplex_sheet_price_bw: 3, // ₹3 per sheet (2 pages)
    };

    // 12 pages duplex = 6 sheets * ₹3 = ₹18 (cheaper than 12 * 2 = 24)
    const duplexCalc = calculatePrintCost({
      totalPages: 12,
      pageRange: 'all',
      colorMode: 'bw',
      sides: 'duplex',
      copies: 1,
      pricing,
    });
    expect(duplexCalc.sheets).toBe(6);
    expect(duplexCalc.totalCost).toBe(18);

    // Odd number of pages: 11 pages duplex = 6 sheets
    const oddDuplex = calculatePrintCost({
      totalPages: 11,
      pageRange: 'all',
      colorMode: 'bw',
      sides: 'duplex',
      copies: 1,
      pricing,
    });
    expect(oddDuplex.sheets).toBe(6);
    expect(oddDuplex.effectivePages).toBe(11);
  });

  it('correctly parses visual page selections and clamps to document boundaries', () => {
    // Single page selection
    expect(parsePageRange('1', 10)).toEqual([1]);

    // Range selection
    expect(parsePageRange('1-3', 10)).toEqual([1, 2, 3]);

    // Even pages selection
    expect(parsePageRange('2, 4, 6', 8)).toEqual([2, 4, 6]);

    // Clamping out-of-bounds page requests
    expect(parsePageRange('1-15', 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('formats prioritized 1-tap mobile popup customizer receipt on WhatsApp with no typing needed', () => {
    const sampleJob: PrintJob = {
      id: 'job_whatsapp_sample',
      token: '#P-101',
      customer_name: 'Rahul',
      original_filename: 'report.pdf',
      stored_filename: 'report.pdf',
      file_path: '/tmp/report.pdf',
      file_size: 1024 * 1024,
      mime_type: 'application/pdf',
      page_count: 12,
      color_mode: 'bw',
      sides: 'single',
      orientation: 'auto',
      copies: 1,
      page_range: 'all',
      effective_pages: 12,
      estimated_cost: 24.0,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
      total_files: 1,
      total_pages: 12,
      source: 'whatsapp',
      whatsapp_jid: '919876543210@s.whatsapp.net',
    };

    const receipt = formatWhatsAppReceipt(sampleJob, 'https://jmart-print.ngrok.app');

    // Matches the exact user specification:
    // 📄 Received: report.pdf (12 pages)
    // 💰 Estimated: ₹24.00 (B/W • Single Sided)
    // 🎫 Token: #P-101
    // 👉 📱 Tap to customize in 1-tap (No typing needed):
    // https://<tunnel-url-or-ip>/order/P-101
    // (Select B/W or Color, Single or Both sides, pages & copies visually!)
    // ⚡ Or quick-reply with a number:
    // 1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex

    expect(receipt).toContain('📄 Received: report.pdf (12 pages)');
    expect(receipt).toContain('💰 Estimated: ₹24.00 (B/W • Single Sided)');
    expect(receipt).toContain('🎫 Token: #P-101');
    expect(receipt).toContain('👉 📱 Tap to customize in 1-tap (No typing needed):');
    expect(receipt).toContain('https://jmart-print.ngrok.app/order/P-101');
    expect(receipt).toContain('(Select B/W or Color, Single or Both sides, pages & copies visually!)');
    expect(receipt).toContain('⚡ Or quick-reply with a number:');
    expect(receipt).toContain('1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex');
  });

  it('formats updated receipt with prioritized 1-tap customizer link when options are modified', () => {
    const sampleJob: PrintJob = {
      id: 'job_whatsapp_sample_updated',
      token: '#P-101',
      customer_name: 'Rahul',
      original_filename: 'report.pdf',
      stored_filename: 'report.pdf',
      file_path: '/tmp/report.pdf',
      file_size: 1024 * 1024,
      mime_type: 'application/pdf',
      page_count: 12,
      color_mode: 'color',
      sides: 'duplex',
      orientation: 'auto',
      copies: 2,
      page_range: '1-6',
      effective_pages: 6,
      estimated_cost: 60.0,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
      total_files: 1,
      total_pages: 12,
      source: 'whatsapp',
      whatsapp_jid: '919876543210@s.whatsapp.net',
    };

    const updateMsg = formatWhatsAppUpdateReceipt(sampleJob, 'https://jmart-print.ngrok.app');

    expect(updateMsg).toContain('✅ *Options Updated!*');
    expect(updateMsg).toContain('📄 Received: report.pdf (12 pages)');
    expect(updateMsg).toContain('💰 Estimated: ₹60.00 (Color • Front & Back • 2 Copies • Pages 1-6)');
    expect(updateMsg).toContain('🎫 Token: #P-101');
    expect(updateMsg).toContain('https://jmart-print.ngrok.app/order/P-101');
    expect(updateMsg).toContain('1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex');
  });
});
