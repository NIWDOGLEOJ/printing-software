import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

export async function detectPageCount(filePath: string, mimeType: string): Promise<number> {
  const lowerMime = (mimeType || '').toLowerCase();
  const isImage = lowerMime.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(filePath);

  if (isImage) {
    return 1;
  }

  // 1. Try pdf-lib
  try {
    const fileBytes = await fs.promises.readFile(filePath);
    const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    const count = pdfDoc.getPageCount();
    if (count && count > 0) {
      return count;
    }
  } catch (err) {
    console.warn(`[PdfService] pdf-lib parse failed for ${filePath}:`, (err as Error).message);
  }

  // 2. Try macOS native metadata (mdls)
  try {
    const { stdout } = await execFileAsync('/usr/bin/mdls', ['-name', 'kMDItemNumberOfPages', '-raw', filePath]);
    const trimmed = stdout.trim();
    const count = parseInt(trimmed, 10);
    if (!isNaN(count) && count > 0) {
      return count;
    }
  } catch (err) {
    // ignore
  }

  // 3. Fallback regex search on PDF binary structure
  try {
    const content = await fs.promises.readFile(filePath, { encoding: 'binary' });
    const matches = content.match(/\/Type\s*\/Page[^s]/g);
    if (matches && matches.length > 0) {
      return matches.length;
    }
  } catch (err) {
    // ignore
  }

  // Default fallback
  return 1;
}
