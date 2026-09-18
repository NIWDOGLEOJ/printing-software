import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys';
import {
  PrintJob,
  JobFile,
  ColorMode,
  SidesMode,
  WhatsAppStatus,
  WsMessage,
} from '../shared/types.js';
import {
  insertJobWithFiles,
  getJobById,
  updateJob,
  updateJobFile,
  getJobFiles,
  getNextToken,
  getEffectivePricing,
  getWhatsAppSettings,
  getLatestPendingJobByWhatsAppJid,
} from './db.js';
import { detectPageCount } from './pdfService.js';
import { calculatePrintCost } from '../shared/costCalculator.js';
import { getTunnelStatus } from './tunnelService.js';
import { getShopDetails } from './shopService.js';

const AUTH_DIR = path.resolve(process.cwd(), 'whatsapp-auth');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let sock: ReturnType<typeof makeWASocket> | null = null;
let currentStatus: WhatsAppStatus = {
  state: 'disconnected',
  phoneNumber: null,
  pushName: null,
  qrCodeDataUrl: null,
  lastConnected: null,
  error: null,
};

let broadcastCallback: ((msg: WsMessage) => void) | null = null;
let isStarting = false;

interface PendingBatch {
  timer: NodeJS.Timeout;
  senderJid: string;
  senderName: string;
  files: Array<{
    originalName: string;
    storedName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
    pageCount: number;
  }>;
  colorMode: ColorMode;
  sides: SidesMode;
  copies: number;
}

const pendingBatches = new Map<string, PendingBatch>();

export function setWhatsAppBroadcast(broadcast: (msg: WsMessage) => void) {
  broadcastCallback = broadcast;
}

function broadcastStatus() {
  if (broadcastCallback) {
    broadcastCallback({
      type: 'WHATSAPP_STATUS_UPDATED',
      whatsappStatus: { ...currentStatus },
    });
  }
}

export function getWhatsAppCurrentStatus(): WhatsAppStatus {
  return { ...currentStatus };
}

/**
 * Check if LibreOffice is available and convert office document to PDF
 */
async function tryConvertToPdf(
  filePath: string,
  originalName: string
): Promise<{ newPath: string; newName: string; mimeType: string } | null> {
  const ext = path.extname(originalName).toLowerCase();
  if (!['.docx', '.doc', '.odt', '.rtf', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext)) {
    return null;
  }

  return new Promise((resolve) => {
    const outDir = path.dirname(filePath);
    execFile('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], (err) => {
      if (err) {
        // Try fallback to 'soffice'
        execFile('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], (err2) => {
          if (err2) {
            console.warn('[WhatsApp] LibreOffice conversion failed or not installed:', err2.message);
            return resolve(null);
          }
          checkConverted();
        });
        return;
      }
      checkConverted();
    });

    function checkConverted() {
      const baseWithoutExt = path.basename(filePath, ext);
      const pdfPath = path.join(outDir, `${baseWithoutExt}.pdf`);
      if (fs.existsSync(pdfPath)) {
        const origBaseWithoutExt = path.basename(originalName, ext);
        resolve({
          newPath: pdfPath,
          newName: `${origBaseWithoutExt}.pdf`,
          mimeType: 'application/pdf',
        });
      } else {
        resolve(null);
      }
    }
  });
}

/**
 * Parse caption or text for printing keywords
 */
function parseKeywords(text: string): {
  colorMode?: ColorMode;
  sides?: SidesMode;
  copies?: number;
} {
  const lower = text.toLowerCase();
  const res: { colorMode?: ColorMode; sides?: SidesMode; copies?: number } = {};

  if (/\b(color|colour)\b/i.test(lower)) {
    res.colorMode = 'color';
  } else if (/\b(bw|b\/w|black|black\s*and\s*white|mono)\b/i.test(lower)) {
    res.colorMode = 'bw';
  }

  if (/\b(duplex|double|both\s*side|front\s*and\s*back|two\s*side)\b/i.test(lower)) {
    res.sides = 'duplex';
  } else if (/\b(single|one\s*side|single\s*side)\b/i.test(lower)) {
    res.sides = 'single';
  }

  const copiesMatch = lower.match(/\b(\d+)\s*(?:copies|copy)\b/i) || lower.match(/\b(?:copies|copy)\s*[:=]?\s*(\d+)\b/i);
  if (copiesMatch) {
    const parsed = parseInt(copiesMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 500) {
      res.copies = parsed;
    }
  }

  return res;
}

/**
 * Initialize or connect WhatsApp client
 */
export async function startWhatsAppClient(): Promise<WhatsAppStatus> {
  if (isStarting) {
    return currentStatus;
  }
  if (sock && currentStatus.state === 'connected') {
    return currentStatus;
  }

  isStarting = true;
  currentStatus = {
    ...currentStatus,
    state: 'connecting',
    error: null,
  };
  broadcastStatus();

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const logger = pino({ level: 'silent' });

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            margin: 2,
            width: 320,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
          currentStatus = {
            state: 'qr_ready',
            qrCodeDataUrl: qrDataUrl,
            phoneNumber: null,
            pushName: null,
            lastConnected: null,
            error: null,
          };
          broadcastStatus();
        } catch (err: any) {
          console.error('[WhatsApp] Failed to generate QR code data URL:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WhatsApp] Connection closed. StatusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {}
          currentStatus = {
            state: 'disconnected',
            qrCodeDataUrl: null,
            phoneNumber: null,
            pushName: null,
            lastConnected: null,
            error: 'Session logged out. Please scan QR again.',
          };
        } else {
          currentStatus = {
            state: 'disconnected',
            qrCodeDataUrl: null,
            phoneNumber: currentStatus.phoneNumber,
            pushName: currentStatus.pushName,
            lastConnected: currentStatus.lastConnected,
            error: (lastDisconnect?.error as any)?.message || 'Connection lost',
          };
          // Try reconnecting after delay if not logged out
          setTimeout(() => {
            if (currentStatus.state !== 'connected' && currentStatus.state !== 'qr_ready') {
              startWhatsAppClient().catch(console.error);
            }
          }, 5000);
        }
        broadcastStatus();
      } else if (connection === 'open') {
        const userJid = sock?.user?.id || '';
        const phone = userJid.split(':')[0] || userJid.split('@')[0];
        const pushName = sock?.user?.name || `Shop WhatsApp (+${phone})`;

        console.log(`✅ [WhatsApp] Connected successfully as ${pushName} (${phone})`);

        currentStatus = {
          state: 'connected',
          phoneNumber: phone,
          pushName,
          qrCodeDataUrl: null,
          lastConnected: new Date().toISOString(),
          error: null,
        };
        broadcastStatus();
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.key.remoteJid && !msg.key.remoteJid.endsWith('@g.us')) {
          await handleIncomingWhatsAppMessage(msg);
        }
      }
    });

    isStarting = false;
    return currentStatus;
  } catch (err: any) {
    isStarting = false;
    console.error('[WhatsApp] Error starting client:', err);
    currentStatus = {
      state: 'disconnected',
      phoneNumber: null,
      pushName: null,
      qrCodeDataUrl: null,
      lastConnected: null,
      error: err.message || 'Failed to start WhatsApp client',
    };
    broadcastStatus();
    return currentStatus;
  }
}

/**
 * Handle incoming message from WhatsApp customer
 */
async function handleIncomingWhatsAppMessage(msg: WAMessage) {
  if (!sock) return;

  const senderJid = msg.key.remoteJid!;
  const senderName = msg.pushName || `Customer (${senderJid.split('@')[0]})`;

  const messageContent = msg.message;
  if (!messageContent) return;

  const documentMsg = messageContent.documentMessage;
  const imageMsg = messageContent.imageMessage;
  const textMsg =
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    '';

  // --- CASE 1: Incoming Media Document / Image ---
  if (documentMsg || imageMsg) {
    try {
      const logger = pino({ level: 'silent' });
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger, reuploadRequest: async () => msg }
      )) as Buffer;

      let originalName = documentMsg?.fileName || (imageMsg ? `photo_${Date.now()}.jpg` : `document_${Date.now()}.pdf`);
      let mimeType = documentMsg?.mimetype || imageMsg?.mimetype || 'application/octet-stream';
      const ext = path.extname(originalName) || (imageMsg ? '.jpg' : '.pdf');
      const storedName = `wa_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
      const savedPath = path.join(UPLOADS_DIR, storedName);

      fs.writeFileSync(savedPath, buffer);

      // Attempt office doc conversion if applicable
      let finalPath = savedPath;
      let finalName = originalName;
      let finalMime = mimeType;

      const converted = await tryConvertToPdf(savedPath, originalName);
      if (converted) {
        finalPath = converted.newPath;
        finalName = converted.newName;
        finalMime = converted.mimeType;
      }

      // Detect authoritative page count
      const detectedPages = await detectPageCount(finalPath, finalMime);
      const stats = fs.statSync(finalPath);

      // Parse caption if provided with media
      const captionText = documentMsg?.caption || imageMsg?.caption || '';
      const parsedOpts = parseKeywords(captionText);

      // Batch ingestion handling (7-second sliding debounce window, silent without intermediate processing messages)
      let batch = pendingBatches.get(senderJid);
      if (batch) {
        clearTimeout(batch.timer);
        batch.files.push({
          originalName: finalName,
          storedName: path.basename(finalPath),
          filePath: finalPath,
          fileSize: stats.size,
          mimeType: finalMime,
          pageCount: detectedPages,
        });
        if (parsedOpts.colorMode) batch.colorMode = parsedOpts.colorMode;
        if (parsedOpts.sides) batch.sides = parsedOpts.sides;
        if (parsedOpts.copies) batch.copies = parsedOpts.copies;
      } else {
        batch = {
          senderJid,
          senderName,
          files: [
            {
              originalName: finalName,
              storedName: path.basename(finalPath),
              filePath: finalPath,
              fileSize: stats.size,
              mimeType: finalMime,
              pageCount: detectedPages,
            },
          ],
          colorMode: parsedOpts.colorMode || 'bw',
          sides: parsedOpts.sides || 'single',
          copies: parsedOpts.copies || 1,
          timer: setTimeout(() => {}, 0),
        };
        pendingBatches.set(senderJid, batch);
      }

      // Reset sliding debounce timer (7 seconds after last file received)
      batch.timer = setTimeout(async () => {
        pendingBatches.delete(senderJid);
        await finalizeWhatsAppJob(batch!);
      }, 7000);
    } catch (err: any) {
      console.error('[WhatsApp] Failed to process media upload:', err);
      await sock.sendMessage(senderJid, {
        text: `❌ Could not process uploaded file: ${err.message || 'Unknown error'}. Please resend as PDF or Photo.`,
      });
    }
    return;
  }

  // --- CASE 2: Text Commands & Customer Queries ---
  const trimmed = textMsg.trim();
  if (!trimmed) return;

  // Check if customer has an active batch currently waiting in debounce window
  const activeBatch = pendingBatches.get(senderJid);
  if (activeBatch) {
    const opts = parseKeywords(trimmed);
    if (opts.colorMode) activeBatch.colorMode = opts.colorMode;
    if (opts.sides) activeBatch.sides = opts.sides;
    if (opts.copies) activeBatch.copies = opts.copies;

    if (/\b(done|print|go|ready|finish)\b/i.test(trimmed)) {
      clearTimeout(activeBatch.timer);
      pendingBatches.delete(senderJid);
      await finalizeWhatsAppJob(activeBatch);
      return;
    }
  }

  // Check if customer has an existing pending job in database
  const pendingJob = getLatestPendingJobByWhatsAppJid(senderJid);

  if (pendingJob) {
    const upper = trimmed.toUpperCase();

    // 1. Color Mode Toggle
    if (upper === 'COLOR' || upper === 'COLOUR') {
      const pricing = getEffectivePricing();
      if (!pricing.color_available) {
        await sock.sendMessage(senderJid, {
          text: `⚠️ *Color Printing Unavailable*\nOur color printer is currently in maintenance. Your job will be printed in *Black & White*.`,
        });
        return;
      }
      applyJobUpdate(pendingJob, { colorMode: 'color' }, senderJid);
      return;
    }

    if (upper === 'BW' || upper === 'BLACK' || upper === 'B&W') {
      applyJobUpdate(pendingJob, { colorMode: 'bw' }, senderJid);
      return;
    }

    // 2. Sides Mode Toggle
    if (upper === 'DUPLEX' || upper === 'DOUBLE' || upper === 'BOTH' || upper === 'FRONT AND BACK') {
      const pricing = getEffectivePricing();
      if (!pricing.duplex_available) {
        await sock.sendMessage(senderJid, {
          text: `⚠️ *Duplex Unavailable*\nTwo-sided printing is currently disabled across active printers.`,
        });
        return;
      }
      applyJobUpdate(pendingJob, { sides: 'duplex' }, senderJid);
      return;
    }

    if (upper === 'SINGLE' || upper === 'ONE' || upper === '1 SIDE') {
      applyJobUpdate(pendingJob, { sides: 'single' }, senderJid);
      return;
    }

    // 3. Copies Command
    const copiesMatch = trimmed.match(/^(\d+)\s*(?:copies|copy)?$/i) || trimmed.match(/^(?:copies|copy)\s*[:=]?\s*(\d+)$/i);
    if (copiesMatch) {
      const count = parseInt(copiesMatch[1], 10);
      if (count > 0 && count <= 500) {
        applyJobUpdate(pendingJob, { copies: count }, senderJid);
        return;
      }
    }

    // 4. Cancel Command
    if (upper === 'CANCEL' || upper === 'DELETE') {
      updateJob(pendingJob.id, { status: 'cancelled' });
      if (broadcastCallback) {
        broadcastCallback({ type: 'JOB_UPDATED', job: getJobById(pendingJob.id) });
      }
      await sock.sendMessage(senderJid, {
        text: `❌ Print job *${pendingJob.token}* has been cancelled.`,
      });
      return;
    }

    // 5. Status / Price Enquiry
    if (upper === 'STATUS' || upper === 'PRICE' || upper === 'COST') {
      const inWords = numberToWords(pendingJob.estimated_cost);
      await sock.sendMessage(senderJid, {
        text: `🎫 Token: *${pendingJob.token}*\n💰 Total Amount: *₹${pendingJob.estimated_cost.toFixed(2)}* (Rupees ${inWords} Only)`,
      });
      return;
    }
  }

  // --- CASE 3: General Text Message / Welcome Greeting ---
  const settings = getWhatsAppSettings();
  if (settings.welcomeEnabled) {
    const shop = getShopDetails();
    const pricing = getEffectivePricing();
    const tunnel = await getTunnelStatus();

    const bwRate = `₹${pricing.bw_price_per_page} / pg` + (pricing.duplex_available ? ` (Duplex: ₹${pricing.duplex_sheet_price_bw}/sheet)` : '');
    const colorRate = pricing.color_available
      ? `₹${pricing.color_price_per_page} / pg` + (pricing.duplex_available ? ` (Duplex: ₹${pricing.duplex_sheet_price_color}/sheet)` : '')
      : 'Currently Unavailable';

    await sock.sendMessage(senderJid, {
      text: `👋 Welcome to *${shop.shopName} Print Station*!\n\n📄 *Print Rates:*\n• Black & White: ${bwRate}\n• Color: ${colorRate}\n\n📎 *How to Print:*\nSimply attach your *PDF* or *Photo* and send it right here in this chat!\n\n🌐 Or configure and upload on our web portal:\n${tunnel.activeUrl}`,
    });
  }
}

/**
 * Convert numeric currency amount to English words (Indian numbering system)
 */
export function numberToWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  function convertChunk(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? '-' + ones[n % 10] : '') + ' ';
    return ones[Math.floor(n / 100)] + ' Hundred ' + convertChunk(n % 100);
  }

  function convertNum(num: number): string {
    if (num === 0) return 'Zero';
    let res = '';
    const crore = Math.floor(num / 10000000);
    const lakh = Math.floor((num % 10000000) / 100000);
    const thousand = Math.floor((num % 100000) / 1000);
    const remainder = num % 1000;

    if (crore > 0) res += convertChunk(crore) + 'Crore ';
    if (lakh > 0) res += convertChunk(lakh) + 'Lakh ';
    if (thousand > 0) res += convertChunk(thousand) + 'Thousand ';
    if (remainder > 0) res += convertChunk(remainder);
    return res.trim();
  }

  const words = rupees > 0 ? convertNum(rupees) : (paise > 0 ? '' : 'Zero');
  if (paise > 0) {
    const paiseWords = convertNum(paise);
    if (rupees > 0) {
      return `${words} and ${paiseWords} Paise`;
    } else {
      return `${paiseWords} Paise`;
    }
  }
  return words;
}

/**
 * Apply keyword updates to an existing pending job and notify customer
 */
async function applyJobUpdate(
  job: PrintJob,
  updates: { colorMode?: ColorMode; sides?: SidesMode; copies?: number },
  recipientJid: string
) {
  if (!sock) return;

  const pricing = getEffectivePricing();
  const files = getJobFiles(job.id);

  let newColor = updates.colorMode || job.color_mode;
  let newSides = updates.sides || job.sides;
  let newCopies = updates.copies || job.copies;

  if (!pricing.color_available && newColor === 'color') newColor = 'bw';
  if (!pricing.duplex_available && newSides === 'duplex') newSides = 'single';

  let totalCost = 0;
  for (const f of files) {
    const cost = calculatePrintCost({
      totalPages: f.page_count,
      pageRange: f.page_range,
      colorMode: newColor,
      sides: newSides,
      copies: newCopies,
      pricing,
    });
    totalCost += cost.totalCost;
    updateJobFile(f.id, {
      color_mode: newColor,
      sides: newSides,
      copies: newCopies,
      estimated_cost: cost.totalCost,
    });
  }

  const updatedJob = updateJob(job.id, {
    color_mode: newColor,
    sides: newSides,
    copies: newCopies,
    estimated_cost: totalCost,
  });

  if (broadcastCallback && updatedJob) {
    broadcastCallback({ type: 'JOB_UPDATED', job: updatedJob });
  }

  const inWords = numberToWords(totalCost);
  await sock.sendMessage(recipientJid, {
    text: `🎫 Token: *${job.token}*\n💰 Total Amount: *₹${totalCost.toFixed(2)}* (Rupees ${inWords} Only)`,
  });
}

/**
 * Combine multiple image files into a single multi-page A4 PDF
 */
export async function combineBatchImagesToPdf(
  images: Array<{ originalName: string; storedName: string; filePath: string; fileSize: number; mimeType: string; pageCount: number }>
): Promise<{ originalName: string; storedName: string; filePath: string; fileSize: number; mimeType: string; pageCount: number }> {
  const pdfDoc = await PDFDocument.create();

  for (const img of images) {
    const ext = path.extname(img.filePath).toLowerCase();
    let tempImgPath = img.filePath;
    let isTemp = false;

    // If WebP, HEIC or BMP, convert to temporary JPG using macOS sips
    if (['.webp', '.heic', '.bmp', '.gif'].includes(ext)) {
      const convPath = path.join(UPLOADS_DIR, `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`);
      try {
        await execFileAsync('/usr/bin/sips', ['-s', 'format', 'jpeg', img.filePath, '--out', convPath]);
        if (fs.existsSync(convPath) && fs.statSync(convPath).size > 0) {
          tempImgPath = convPath;
          isTemp = true;
        }
      } catch (e) {
        // fallback
      }
    }

    try {
      const fileBytes = await fs.promises.readFile(tempImgPath);
      const curExt = path.extname(tempImgPath).toLowerCase();
      let embeddedImg;
      if (curExt === '.png') {
        embeddedImg = await pdfDoc.embedPng(fileBytes);
      } else {
        embeddedImg = await pdfDoc.embedJpg(fileBytes);
      }

      const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
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
    } catch (err) {
      console.warn(`[WhatsApp] Failed to embed image ${img.originalName} into combined PDF:`, err);
    } finally {
      if (isTemp && fs.existsSync(tempImgPath)) {
        try { fs.unlinkSync(tempImgPath); } catch {}
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const storedName = `wa_combined_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`;
  const filePath = path.join(UPLOADS_DIR, storedName);
  await fs.promises.writeFile(filePath, pdfBytes);
  const stats = fs.statSync(filePath);

  return {
    originalName: `Combined_Photos_${images.length}_Pages.pdf`,
    storedName,
    filePath,
    fileSize: stats.size,
    mimeType: 'application/pdf',
    pageCount: pdfDoc.getPageCount(),
  };
}

/**
 * Finalize batch of uploaded files into a single PrintJob
 */
async function finalizeWhatsAppJob(batch: PendingBatch) {
  if (!sock || batch.files.length === 0) return;

  try {
    const token = getNextToken();
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const pricing = getEffectivePricing();

    let colorMode: ColorMode = batch.colorMode;
    let sides: SidesMode = batch.sides;
    const copies = batch.copies;

    if (!pricing.color_available && colorMode === 'color') colorMode = 'bw';
    if (!pricing.duplex_available && sides === 'duplex') sides = 'single';

    // If the batch contains 2 or more image files, automatically combine them into a single multi-page PDF
    const nonImages = batch.files.filter(
      f => !['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(f.mimeType) &&
           !['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(path.extname(f.filePath).toLowerCase())
    );
    const images = batch.files.filter(
      f => ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'].includes(f.mimeType) ||
           ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(path.extname(f.filePath).toLowerCase())
    );

    let filesToProcess = [...batch.files];
    if (images.length >= 2) {
      try {
        const combinedPdf = await combineBatchImagesToPdf(images);
        filesToProcess = [...nonImages, combinedPdf];
        console.log(`[WhatsApp] Combined ${images.length} images into single multi-page document ${combinedPdf.originalName} (${combinedPdf.pageCount} pages)`);
      } catch (err) {
        console.error('[WhatsApp] Failed to combine images into PDF, keeping individual files:', err);
      }
    }

    const jobFiles: JobFile[] = [];
    let totalPages = 0;
    let totalCost = 0;

    for (let i = 0; i < filesToProcess.length; i++) {
      const f = filesToProcess[i];
      const costRes = calculatePrintCost({
        totalPages: f.pageCount,
        pageRange: 'all',
        colorMode,
        sides,
        copies,
        pricing,
      });

      totalPages += f.pageCount * copies;
      totalCost += costRes.totalCost;

      const jFile: JobFile = {
        id: `file_${jobId}_${i}`,
        job_id: jobId,
        original_filename: f.originalName,
        stored_filename: f.storedName,
        file_path: f.filePath,
        file_size: f.fileSize,
        mime_type: f.mimeType,
        page_count: f.pageCount,
        color_mode: colorMode,
        sides,
        orientation: 'auto',
        copies,
        page_range: 'all',
        effective_pages: costRes.effectivePages,
        estimated_cost: costRes.totalCost,
        file_index: i,
        status: 'pending',
        cups_job_id: null,
        printed_at: null,
      };
      jobFiles.push(jFile);
    }

    const primaryFile = jobFiles[0];
    const newJob: PrintJob = {
      id: jobId,
      token,
      customer_name: batch.senderName,
      original_filename: primaryFile.original_filename,
      stored_filename: primaryFile.stored_filename,
      file_path: primaryFile.file_path,
      file_size: primaryFile.file_size,
      mime_type: primaryFile.mime_type,
      page_count: primaryFile.page_count,
      color_mode: colorMode,
      sides,
      orientation: 'auto',
      copies,
      page_range: 'all',
      effective_pages: primaryFile.effective_pages,
      estimated_cost: totalCost,
      status: 'pending',
      created_at: new Date().toISOString(),
      printed_at: null,
      printer_name: null,
      cups_job_id: null,
      files: jobFiles,
      total_files: jobFiles.length,
      total_pages: totalPages,
      source: 'whatsapp',
      whatsapp_jid: batch.senderJid,
      whatsapp_sender_name: batch.senderName,
    };

    const saved = insertJobWithFiles(newJob, jobFiles);

    // Broadcast NEW_JOB to admin dashboard (triggers WebSocket chime!)
    if (broadcastCallback) {
      broadcastCallback({ type: 'NEW_JOB', job: saved });
    }

    const inWords = numberToWords(totalCost);
    const replyText =
      `🎫 Token: *${token}*\n` +
      `💰 Total Amount: *₹${totalCost.toFixed(2)}* (Rupees ${inWords} Only)`;

    await sock.sendMessage(batch.senderJid, { text: replyText });
    console.log(`✅ [WhatsApp] Job ${token} created and confirmation sent to ${batch.senderJid}`);
  } catch (err: any) {
    console.error('[WhatsApp] Failed to finalize job:', err);
  }
}

/**
 * Dispatch notification when printing starts (Silenced to avoid intermediate processing messages)
 */
export async function notifyWhatsAppJobPrinting(_job: PrintJob) {
  // Silenced: do not send intermediate "processing" / "printing started" messages
  return;
}

/**
 * Dispatch notification when print job is completed / ready
 */
export async function notifyWhatsAppJobCompleted(job: PrintJob) {
  if (!sock || !job.whatsapp_jid) return;

  const settings = getWhatsAppSettings();
  if (!settings.notifyOnComplete) return;

  try {
    const shop = getShopDetails();
    await sock.sendMessage(job.whatsapp_jid, {
      text:
        `✅ *Prints Ready for Collection!*\n\n` +
        `🎫 *Token:* *${job.token}*\n` +
        `💰 *Total Due:* *₹${job.estimated_cost.toFixed(2)}*\n` +
        `📍 *Location:* ${shop.shopName} Counter\n\n` +
        `_Please pay cash or UPI at the counter when collecting your documents. Thank you!_`,
    });
  } catch (err: any) {
    console.warn('[WhatsApp] Failed to send completion notification:', (err as Error).message);
  }
}

/**
 * Disconnect and logout WhatsApp session
 */
export async function disconnectWhatsApp(): Promise<WhatsAppStatus> {
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch {}
      sock = null;
    }

    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch {}

    currentStatus = {
      state: 'disconnected',
      phoneNumber: null,
      pushName: null,
      qrCodeDataUrl: null,
      lastConnected: null,
      error: null,
    };
    broadcastStatus();
    return currentStatus;
  } catch (err: any) {
    console.error('[WhatsApp] Error disconnecting:', err);
    currentStatus.error = err.message;
    broadcastStatus();
    return currentStatus;
  }
}

// Auto-start WhatsApp if auth folder with creds already exists
if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
  console.log('🔄 [WhatsApp] Existing session credentials detected. Auto-connecting...');
  setTimeout(() => {
    startWhatsAppClient().catch((err) => {
      console.warn('[WhatsApp] Auto-connect failed:', err.message);
    });
  }, 2000);
}
