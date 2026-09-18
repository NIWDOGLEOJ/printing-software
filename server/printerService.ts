import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { PrinterInfo, ColorMode, SidesMode, OrientationMode } from '../shared/types.js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getPricingSettings } from './db.js';

const execFileAsync = promisify(execFile);

function findBinary(name: string): string {
  const candidates = [`/usr/bin/${name}`, `/usr/sbin/${name}`, `/bin/${name}`, `/usr/local/bin/${name}`];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return name;
}

const VIRTUAL_PRINTER: PrinterInfo = {
  name: 'Virtual / Mock Printer (Simulated)',
  isDefault: false,
  status: 'idle',
  rawStatus: 'virtual test printer',
  isMock: true,
};

export async function getPrinters(): Promise<PrinterInfo[]> {
  const printers: PrinterInfo[] = [];
  let defaultPrinter = '';

  try {
    // 1. Get default printer from system CUPS
    try {
      const { stdout: defaultOut } = await execFileAsync(findBinary('lpstat'), ['-d']);
      const match = defaultOut.match(/system default destination:\s*(\S+)/i);
      if (match) {
        defaultPrinter = match[1].trim();
      }
    } catch (e) {
      // lpstat -d may fail if no default printer
    }

    // 2. Get printer statuses
    try {
      const { stdout: statOut } = await execFileAsync(findBinary('lpstat'), ['-p']);
      const lines = statOut.split('\n');

      for (const line of lines) {
        const pMatch = line.match(/^printer\s+(\S+)\s+is\s+([^.]+)/i);
        if (pMatch) {
          const name = pMatch[1].trim();
          const stateStr = pMatch[2].toLowerCase();
          let status: PrinterInfo['status'] = 'idle';
          if (stateStr.includes('idle')) status = 'idle';
          else if (stateStr.includes('printing')) status = 'printing';
          else if (stateStr.includes('disabled')) status = 'disabled';

          printers.push({
            name,
            isDefault: false,
            status,
            rawStatus: line.trim(),
            isMock: false,
          });
        }
      }
    } catch (e) {
      // lpstat -p might return non-zero if no printers
    }

    // 3. Also check lpstat -e for any destination that wasn't in -p
    try {
      const { stdout: enumOut } = await execFileAsync(findBinary('lpstat'), ['-e']);
      const names = enumOut.split('\n').map(s => s.trim()).filter(Boolean);
      for (const name of names) {
        if (!printers.some(p => p.name === name)) {
          printers.push({
            name,
            isDefault: false,
            status: 'idle',
            rawStatus: 'available network destination',
            isMock: false,
          });
        }
      }
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.warn('[PrinterService] Error querying CUPS printers:', (err as Error).message);
  }

  // Check if user set a configured default printer in settings
  try {
    const configuredDefault = getPricingSettings().default_printer;
    if (configuredDefault && printers.some(p => p.name === configuredDefault)) {
      defaultPrinter = configuredDefault;
    }
  } catch (e) {
    // ignore
  }

  // Mark isDefault flag
  if (defaultPrinter) {
    printers.forEach(p => {
      p.isDefault = (p.name === defaultPrinter);
    });
  }

  // Always include the virtual printer so shopkeepers can test without wasting paper
  if (printers.length === 0) {
    printers.push({ ...VIRTUAL_PRINTER, isDefault: true });
  } else {
    if (!printers.some(p => p.isDefault)) {
      printers[0].isDefault = true;
    }
    printers.push({ ...VIRTUAL_PRINTER, isDefault: false });
  }

  return printers;
}

export interface PrintJobOptions {
  printerName?: string;
  copies?: number;
  colorMode?: ColorMode;
  sides?: SidesMode;
  orientation?: OrientationMode;
  pageRange?: string;
}

export interface PrintResult {
  success: boolean;
  cupsJobId: string;
  printerName: string;
  message: string;
}

export async function preparePrintableFile(filePath: string): Promise<{ printablePath: string; isTemp: boolean }> {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext);

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // 1. Image normalization into clean single A4 PDF
  if (isImage) {
    const tempPdfPath = path.resolve(
      uploadsDir,
      `print_temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`
    );

    // Try macOS native sips first for fast conversion (supports WebP, PNG, JPG, etc.)
    try {
      await execFileAsync('/usr/bin/sips', ['-s', 'format', 'pdf', filePath, '--out', tempPdfPath]);
      if (fs.existsSync(tempPdfPath) && fs.statSync(tempPdfPath).size > 0) {
        return { printablePath: tempPdfPath, isTemp: true };
      }
    } catch (err) {
      // fallback to pdf-lib
    }

    // Fallback to embedding via pdf-lib for JPG / PNG
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
      const fileBytes = await fs.promises.readFile(filePath);
      let embeddedImg;
      if (ext === '.png') {
        embeddedImg = await pdfDoc.embedPng(fileBytes);
      } else {
        embeddedImg = await pdfDoc.embedJpg(fileBytes);
      }
      const { width: imgW, height: imgH } = embeddedImg;
      const margin = 20;
      const maxW = 595.28 - margin * 2;
      const maxH = 841.89 - margin * 2;
      const scale = Math.min(maxW / imgW, maxH / imgH, 1);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      page.drawImage(embeddedImg, {
        x: (595.28 - drawW) / 2,
        y: (841.89 - drawH) / 2,
        width: drawW,
        height: drawH,
      });
      const pdfBytes = await pdfDoc.save();
      await fs.promises.writeFile(tempPdfPath, pdfBytes);
      return { printablePath: tempPdfPath, isTemp: true };
    } catch (err) {
      return { printablePath: filePath, isTemp: false };
    }
  }

  // 2. PDF normalization (strips Microsoft Word tagged structures & prevents CUPS rasterizer looping)
  if (ext === '.pdf') {
    try {
      const fileBytes = await fs.promises.readFile(filePath);
      const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
      const pageCount = srcDoc.getPageCount();
      if (pageCount > 0) {
        const normDoc = await PDFDocument.create();
        const copiedPages = await normDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach(p => normDoc.addPage(p));
        const normBytes = await normDoc.save();

        const tempPdfPath = path.resolve(
          uploadsDir,
          `print_norm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`
        );
        await fs.promises.writeFile(tempPdfPath, normBytes);
        return { printablePath: tempPdfPath, isTemp: true };
      }
    } catch (err) {
      // Fallback to original filePath if normalization encountered an issue
      return { printablePath: filePath, isTemp: false };
    }
  }

  return { printablePath: filePath, isTemp: false };
}

export async function printFile(filePath: string, options: PrintJobOptions): Promise<PrintResult> {
  const printers = await getPrinters();
  let targetPrinter = options.printerName?.trim();

  // If no printer specified, choose the default one
  if (!targetPrinter) {
    const def = printers.find(p => p.isDefault) || printers[0];
    targetPrinter = def.name;
  }

  const selectedPrinter = printers.find(p => p.name === targetPrinter) || {
    name: targetPrinter,
    isMock: targetPrinter.includes('Virtual') || targetPrinter.includes('Mock'),
  };

  // Mock / Virtual printer flow
  if (selectedPrinter.isMock) {
    await new Promise(res => setTimeout(res, 400));
    const mockId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
      success: true,
      cupsJobId: mockId,
      printerName: selectedPrinter.name,
      message: `[Virtual Print] Dispatched to ${selectedPrinter.name} successfully (ID: ${mockId})`,
    };
  }

  // Prepare printable file (wrapping images in clean single A4 PDF & normalizing PDFs)
  const { printablePath, isTemp } = await preparePrintableFile(filePath);

  try {
    // Real CUPS print execution
    const args: string[] = ['-d', targetPrinter];

    // Explicit standard media size (A4) - ensures printer matches loaded paper tray without scaling errors
    args.push('-o', 'media=A4', '-o', 'PageSize=A4');

    // Copies & Collation
    const copies = Math.max(1, options.copies || 1);
    if (copies > 1) {
      args.push('-n', String(copies));
      args.push('-o', 'Collate=True');
    }

    // Color mode
    if (options.colorMode === 'bw') {
      args.push('-o', 'ColorModel=Gray', '-o', 'print-color-mode=monochrome');
    } else {
      args.push('-o', 'ColorModel=RGB', '-o', 'print-color-mode=color');
    }

    // Sides / Duplex
    if (options.sides === 'duplex') {
      args.push('-o', 'Duplex=DuplexNoTumble', '-o', 'sides=two-sided-long-edge', '-o', 'Option1=True');
    } else {
      args.push('-o', 'Duplex=None', '-o', 'sides=one-sided');
    }

    // Orientation
    if (options.orientation === 'landscape') {
      args.push('-o', 'orientation-requested=4');
    } else if (options.orientation === 'portrait') {
      args.push('-o', 'orientation-requested=3');
    }

    // Page range
    if (options.pageRange && options.pageRange !== 'all' && options.pageRange.trim() !== '') {
      args.push('-o', `page-ranges=${options.pageRange.trim()}`);
    }

    args.push(printablePath);

    const { stdout, stderr } = await execFileAsync(findBinary('lp'), args);
    const combined = `${stdout} ${stderr}`;
    const match = combined.match(/request id is (\S+)/i);
    const cupsJobId = match ? match[1] : `JOB-${Date.now()}`;

    return {
      success: true,
      cupsJobId,
      printerName: targetPrinter,
      message: `Print job dispatched successfully (CUPS Job ID: ${cupsJobId})`,
    };
  } catch (err: any) {
    throw new Error(`Failed to print on ${targetPrinter}: ${err.message || err}`);
  } finally {
    if (isTemp && fs.existsSync(printablePath)) {
      try {
        fs.unlinkSync(printablePath);
      } catch (e) {
        // ignore
      }
    }
  }
}

export async function createTestPrintFile(printerName: string): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 size in points
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();

  // Draw header bar
  page.drawRectangle({
    x: 40,
    y: height - 100,
    width: width - 80,
    height: 60,
    color: rgb(0.08, 0.64, 0.29),
  });

  page.drawText('J MART QUICK PRINT STATION', {
    x: 60,
    y: height - 68,
    size: 20,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('Official Network Printer Test Page', {
    x: 60,
    y: height - 88,
    size: 11,
    font: fontNormal,
    color: rgb(0.9, 1, 0.9),
  });

  // Content
  let y = height - 140;
  const addLine = (label: string, value: string) => {
    page.drawText(label, { x: 50, y, size: 12, font: fontBold, color: rgb(0.15, 0.2, 0.25) });
    page.drawText(value, { x: 200, y, size: 12, font: fontNormal, color: rgb(0.25, 0.3, 0.35) });
    y -= 26;
  };

  addLine('Target Printer:', printerName);
  addLine('Date & Time:', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  addLine('System:', 'macOS CUPS Network Printing');
  addLine('Alignment:', 'Normal A4 Centered');
  addLine('Status:', 'Printer Connected and Operational');

  // Test pattern box
  y -= 20;
  page.drawRectangle({
    x: 50,
    y: y - 100,
    width: width - 100,
    height: 100,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 1,
    color: rgb(0.97, 0.97, 0.97),
  });

  page.drawText('PRINT QUALITY & COLOR ALIGNMENT TEST PATTERN', {
    x: 70,
    y: y - 25,
    size: 11,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });

  // 4 Color squares: Black, Red, Green, Blue
  const sqY = y - 75;
  page.drawRectangle({ x: 70, y: sqY, width: 30, height: 30, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 120, y: sqY, width: 30, height: 30, color: rgb(0.9, 0.1, 0.1) });
  page.drawRectangle({ x: 170, y: sqY, width: 30, height: 30, color: rgb(0.1, 0.7, 0.2) });
  page.drawRectangle({ x: 220, y: sqY, width: 30, height: 30, color: rgb(0.1, 0.4, 0.9) });

  page.drawText('Black', { x: 72, y: sqY - 12, size: 9, font: fontNormal, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Cyan/Red', { x: 118, y: sqY - 12, size: 9, font: fontNormal, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Green', { x: 172, y: sqY - 12, size: 9, font: fontNormal, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Blue', { x: 224, y: sqY - 12, size: 9, font: fontNormal, color: rgb(0.3, 0.3, 0.3) });

  // Footer
  page.drawText('Generated automatically by J MART Print Management System', {
    x: 50,
    y: 40,
    size: 9,
    font: fontNormal,
    color: rgb(0.5, 0.5, 0.5),
  });

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const tempPath = path.resolve(uploadsDir, `test_print_${Date.now()}.pdf`);
  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(tempPath, pdfBytes);
  return tempPath;
}
