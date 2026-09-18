import { describe, it, expect } from 'vitest';
import { getPrinters, printFile, createTestPrintFile, preparePrintableFile } from '../server/printerService.js';
import { updatePricingSettings } from '../server/db.js';
import fs from 'fs';
import path from 'path';

describe('Printer Service', () => {
  it('discovers system printers or provides virtual printer', async () => {
    const printers = await getPrinters();
    expect(printers.length).toBeGreaterThan(0);

    const hasVirtual = printers.some((p) => p.isMock);
    expect(hasVirtual).toBe(true);

    const hasDefault = printers.some((p) => p.isDefault);
    expect(hasDefault).toBe(true);
  });

  it('respects default_printer configured in settings', async () => {
    const printers = await getPrinters();
    const targetName = printers[0].name;

    updatePricingSettings({ default_printer: targetName });
    const updatedPrinters = await getPrinters();
    const markedDefault = updatedPrinters.find((p) => p.isDefault);
    expect(markedDefault?.name).toBe(targetName);

    // Reset setting
    updatePricingSettings({ default_printer: '' });
  });

  it('converts image files to printable A4 PDF before sending to CUPS', async () => {
    const tmpImg = path.resolve('/tmp/test_prepare.png');
    // 1x1 transparent PNG base64
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(tmpImg, pngBytes);

    const prep = await preparePrintableFile(tmpImg);
    expect(prep.printablePath.endsWith('.pdf')).toBe(true);
    expect(fs.existsSync(prep.printablePath)).toBe(true);
    expect(prep.isTemp).toBe(true);

    // Cleanup
    if (fs.existsSync(prep.printablePath)) fs.unlinkSync(prep.printablePath);
    if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
  });

  it('handles print job execution via virtual printer cleanly', async () => {
    // Generate a temporary file to test print
    const testFilePath = await createTestPrintFile('Virtual / Mock Printer (Simulated)');
    expect(fs.existsSync(testFilePath)).toBe(true);

    const result = await printFile(testFilePath, {
      printerName: 'Virtual / Mock Printer (Simulated)',
      copies: 1,
      colorMode: 'bw',
      sides: 'single',
    });

    expect(result.success).toBe(true);
    expect(result.cupsJobId).toBeDefined();

    // Clean up test file
    fs.unlinkSync(testFilePath);
  });

  it('normalizes multi-page PDF files preserving all pages cleanly', async () => {
    // Generate a 3-page test PDF
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([595.28, 841.89]);
    doc.addPage([595.28, 841.89]);
    doc.addPage([595.28, 841.89]);
    const pdfBytes = await doc.save();

    const tmpPdf = path.resolve('/tmp/test_multipage.pdf');
    fs.writeFileSync(tmpPdf, pdfBytes);

    const prep = await preparePrintableFile(tmpPdf);
    expect(prep.printablePath.endsWith('.pdf')).toBe(true);
    expect(fs.existsSync(prep.printablePath)).toBe(true);

    const checkDoc = await PDFDocument.load(fs.readFileSync(prep.printablePath));
    expect(checkDoc.getPageCount()).toBe(3);

    // Cleanup
    if (prep.isTemp && fs.existsSync(prep.printablePath)) fs.unlinkSync(prep.printablePath);
    if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
  });
});
