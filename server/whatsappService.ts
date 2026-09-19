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
  pageRange?: string;
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

export interface ParsedPrintOptions {
  colorMode?: ColorMode;
  sides?: SidesMode;
  copies?: number;
  pageRange?: string;
  effectivePages?: number;
  warning?: string;
  isShortcut?: boolean;
}

/**
 * Normalizes user-entered page range strings into standard CUPS/calculator format (e.g. "1-5", "1,3,5").
 * Clamps requested page range to document totalPages if provided.
 */
export function formatPageRangeString(
  input: string,
  totalPages?: number
): { pageRange: string; effectivePages: number; warning?: string } {
  const clean = input.trim();
  if (
    !clean ||
    clean.toLowerCase() === 'all' ||
    clean.toLowerCase() === 'all pages' ||
    clean.toLowerCase() === 'all page' ||
    clean.toLowerCase() === 'entire doc' ||
    clean.toLowerCase() === 'entire document'
  ) {
    return {
      pageRange: 'all',
      effectivePages: totalPages && totalPages > 0 ? totalPages : 1,
    };
  }

  // Strip words like "pages", "page", "pgs", "pg", "p", "only"
  const stripped = clean
    .replace(/\b(?:pages?|pgs?|p|only)\b/gi, '')
    .trim();

  // Normalize "to", "through", "thru", "until" to "-"
  // and "and", "&", "+" to ","
  const normalized = stripped
    .replace(/\b(?:to|through|thru|until)\b/gi, '-')
    .replace(/\b(?:and|&|\+)\b/gi, ',')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*,\s*/g, ',');

  // Extract page segments
  const parts = normalized.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const pagesSet = new Set<number>();
  let hasExceeded = false;

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const from = Math.max(1, Math.min(start, end));
        const to = Math.max(1, Math.max(start, end));
        if (totalPages && totalPages > 0 && to > totalPages) {
          hasExceeded = true;
        }
        const clampedFrom = Math.max(1, totalPages ? Math.min(from, totalPages) : from);
        const clampedTo = totalPages ? Math.min(to, totalPages) : to;
        for (let i = clampedFrom; i <= clampedTo; i++) {
          pagesSet.add(i);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!isNaN(pageNum)) {
        const validPage = Math.max(1, pageNum);
        if (totalPages && totalPages > 0 && validPage > totalPages) {
          hasExceeded = true;
        }
        const clamped = totalPages ? Math.min(validPage, totalPages) : validPage;
        pagesSet.add(clamped);
      }
    }
  }

  const sortedPages = Array.from(pagesSet).sort((a, b) => a - b);
  if (sortedPages.length === 0) {
    return {
      pageRange: 'all',
      effectivePages: totalPages && totalPages > 0 ? totalPages : 1,
    };
  }

  // Group sorted numbers into standard canonical range string (e.g. 1-4 or 1-3,5)
  const rangeSegments: string[] = [];
  let rangeStart = sortedPages[0];
  let prev = sortedPages[0];

  for (let i = 1; i < sortedPages.length; i++) {
    const cur = sortedPages[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      rangeSegments.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = cur;
      prev = cur;
    }
  }
  rangeSegments.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
  const canonicalRange = rangeSegments.join(',');

  let warning: string | undefined;
  if (hasExceeded && totalPages && totalPages > 0) {
    warning = `Requested page range exceeds document total (${totalPages} pages). Clamped to ${canonicalRange}.`;
  }

  return {
    pageRange: canonicalRange,
    effectivePages: sortedPages.length,
    warning,
  };
}

/**
 * Natural Language Multi-Option Sentence Parser
 * Parses color, sides, copies, page range, and numbered quick-reply shortcuts.
 */
export function parsePrintKeywords(text: string, totalPages?: number): ParsedPrintOptions {
  const trimmed = text.trim();
  if (!trimmed) return {};

  const lower = trimmed.toLowerCase();
  const res: ParsedPrintOptions = {};

  // 1. Numbered Quick-Reply Shortcuts: 1, 2, 3, 4
  const shortcutMatch = trimmed.match(/^[\(\[]?(?:option\s*|opt\s*|#)?([1-4])[\)\]\.]?$/i);
  if (shortcutMatch) {
    const num = shortcutMatch[1];
    res.isShortcut = true;
    switch (num) {
      case '1':
        res.colorMode = 'bw';
        res.sides = 'single';
        return res;
      case '2':
        res.colorMode = 'bw';
        res.sides = 'duplex';
        return res;
      case '3':
        res.colorMode = 'color';
        res.sides = 'single';
        return res;
      case '4':
        res.colorMode = 'color';
        res.sides = 'duplex';
        return res;
    }
  }

  let workingText = lower;

  // 2. Copies (extract first to prevent numbers in "5 copies" polluting page ranges!)
  const wordToNum: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    single: 1,
    double: 2,
    triple: 3,
  };

  const copiesNumMatch =
    workingText.match(/\b(\d+)\s*(?:copies|copy|sets?|prints?)\b/i) ||
    workingText.match(/\b(?:copies|copy|sets?)\s*[:=]?\s*(\d+)\b/i);

  if (copiesNumMatch) {
    const parsed = parseInt(copiesNumMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 500) {
      res.copies = parsed;
      workingText = workingText.replace(copiesNumMatch[0], ' ');
    }
  } else {
    const copiesWordMatch = workingText.match(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|double|triple)\s*(?:copies|copy|sets?)\b/i
    );
    if (copiesWordMatch) {
      const w = copiesWordMatch[1].toLowerCase();
      if (wordToNum[w]) {
        res.copies = wordToNum[w];
        workingText = workingText.replace(copiesWordMatch[0], ' ');
      }
    }
  }

  // 3. Sides Mode (Duplex vs Single)
  const duplexMatch = workingText.match(
    /\b(front\s*(?:and|&)\s*back|back\s*(?:to|&)\s*back|both\s*sides?|duplex|double\s*sided?|two\s*sided?|2\s*sided?)\b/i
  );
  const singleMatch = workingText.match(
    /\b(single\s*sided?|single|one\s*sided?|one\s*side|1\s*sided?|1\s*side)\b/i
  );

  if (duplexMatch) {
    res.sides = 'duplex';
    workingText = workingText.replace(duplexMatch[0], ' ');
  } else if (singleMatch) {
    res.sides = 'single';
    workingText = workingText.replace(singleMatch[0], ' ');
  }

  // 4. Color Mode
  const bwMatch = workingText.match(
    /\b(bw|b\/w|black\s*(?:and|&)\s*white|black|mono(?:chrome)?|greyscale|grayscale)\b/i
  );
  const colorMatch = workingText.match(/\b(in\s+colou?r|colou?r)\b/i);

  if (bwMatch) {
    res.colorMode = 'bw';
    workingText = workingText.replace(bwMatch[0], ' ');
  } else if (colorMatch) {
    res.colorMode = 'color';
    workingText = workingText.replace(colorMatch[0], ' ');
  }

  // 5. Page Range
  if (
    /\b(?:all\s*pages?|entire\s*(?:doc|document))\b/i.test(workingText) ||
    workingText.trim() === 'all'
  ) {
    res.pageRange = 'all';
    if (totalPages && totalPages > 0) {
      res.effectivePages = totalPages;
    }
  } else if (/\bfirst\s*page\b/i.test(workingText)) {
    const pr = formatPageRangeString('1', totalPages);
    res.pageRange = pr.pageRange;
    res.effectivePages = pr.effectivePages;
    if (pr.warning) res.warning = pr.warning;
  } else if (/\bfirst\s*(\d+)\s*pages?\b/i.test(workingText)) {
    const m = workingText.match(/\bfirst\s*(\d+)\s*pages?\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const pr = formatPageRangeString(`1-${n}`, totalPages);
      res.pageRange = pr.pageRange;
      res.effectivePages = pr.effectivePages;
      if (pr.warning) res.warning = pr.warning;
    }
  } else if (/\blast\s*page\b/i.test(workingText) && totalPages && totalPages > 0) {
    const pr = formatPageRangeString(`${totalPages}`, totalPages);
    res.pageRange = pr.pageRange;
    res.effectivePages = pr.effectivePages;
    if (pr.warning) res.warning = pr.warning;
  } else if (/\blast\s*(\d+)\s*pages?\b/i.test(workingText) && totalPages && totalPages > 0) {
    const m = workingText.match(/\blast\s*(\d+)\s*pages?\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const start = Math.max(1, totalPages - n + 1);
      const pr = formatPageRangeString(`${start}-${totalPages}`, totalPages);
      res.pageRange = pr.pageRange;
      res.effectivePages = pr.effectivePages;
      if (pr.warning) res.warning = pr.warning;
    }
  } else if (
    /\bonly\s+pages?\s*([0-9\s,\-to&and+]+)\b/i.test(workingText) ||
    /\bpages?\s*([0-9\s,\-to&and+]+)\s+only\b/i.test(workingText)
  ) {
    const m =
      workingText.match(/\bonly\s+pages?\s*([0-9\s,\-to&and+]+)\b/i) ||
      workingText.match(/\bpages?\s*([0-9\s,\-to&and+]+)\s+only\b/i);
    if (m && /\d/.test(m[1])) {
      const pr = formatPageRangeString(m[1].trim(), totalPages);
      res.pageRange = pr.pageRange;
      res.effectivePages = pr.effectivePages;
      if (pr.warning) res.warning = pr.warning;
    }
  } else if (/\bonly\s+([0-9\s,\-to&and+]+)\b/i.test(workingText)) {
    const m = workingText.match(/\bonly\s+([0-9\s,\-to&and+]+)\b/i);
    if (m && /\d/.test(m[1])) {
      const pr = formatPageRangeString(m[1].trim(), totalPages);
      res.pageRange = pr.pageRange;
      res.effectivePages = pr.effectivePages;
      if (pr.warning) res.warning = pr.warning;
    }
  } else {
    // Check for "pages 1 to 4", "page 1-5", "p 1-3, 5", "pg 1-4", "pgs 1 to 3", "page 1 and 2"
    const rangeMatch = workingText.match(/\b(?:pages?|pgs?|p)\s*[:=]?\s*([0-9\s,\-to&and+]+)\b/i);
    if (rangeMatch) {
      const raw = rangeMatch[1].trim();
      if (/\d/.test(raw)) {
        const pr = formatPageRangeString(raw, totalPages);
        res.pageRange = pr.pageRange;
        res.effectivePages = pr.effectivePages;
        if (pr.warning) res.warning = pr.warning;
      }
    } else {
      // Fallback: check for isolated explicit ranges like "1 to 4" or "1-5"
      const explicitRangeMatch = workingText.match(/\b(\d+\s*(?:to|-)\s*\d+)\b/i);
      if (explicitRangeMatch) {
        const pr = formatPageRangeString(explicitRangeMatch[1].trim(), totalPages);
        res.pageRange = pr.pageRange;
        res.effectivePages = pr.effectivePages;
        if (pr.warning) res.warning = pr.warning;
      }
    }
  }

  return res;
}

/**
 * Backward compatibility alias for parsePrintKeywords
 */
function parseKeywords(text: string): {
  colorMode?: ColorMode;
  sides?: SidesMode;
  copies?: number;
  pageRange?: string;
} {
  return parsePrintKeywords(text);
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
      const parsedOpts = parsePrintKeywords(captionText, detectedPages);

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
        if (parsedOpts.pageRange) batch.pageRange = parsedOpts.pageRange;
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
          pageRange: parsedOpts.pageRange || 'all',
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
    const totalBatchPages = activeBatch.files.reduce((sum, f) => sum + f.pageCount, 0);
    const opts = parsePrintKeywords(trimmed, totalBatchPages);
    if (opts.colorMode) activeBatch.colorMode = opts.colorMode;
    if (opts.sides) activeBatch.sides = opts.sides;
    if (opts.copies) activeBatch.copies = opts.copies;
    if (opts.pageRange) activeBatch.pageRange = opts.pageRange;

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

    // 1. Cancel Command
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

    // 2. Status / Price Enquiry
    if (upper === 'STATUS' || upper === 'PRICE' || upper === 'COST') {
      const tunnel = await getTunnelStatus();
      const receipt = formatWhatsAppReceipt(pendingJob, tunnel.activeUrl);
      await sock.sendMessage(senderJid, { text: receipt });
      return;
    }

    // 3. Multi-Option Natural Language Instructions & Shortcuts
    const jobFilesList = getJobFiles(pendingJob.id);
    const maxPages = jobFilesList.length > 0
      ? Math.max(...jobFilesList.map((f) => f.page_count))
      : (pendingJob.page_count || 1);
    const opts = parsePrintKeywords(trimmed, maxPages);
    if (opts.colorMode || opts.sides || opts.copies || opts.pageRange) {
      const pricing = getEffectivePricing();
      let warning = opts.warning;

      let colorMode = opts.colorMode;
      let sides = opts.sides;

      if (colorMode === 'color' && !pricing.color_available) {
        colorMode = 'bw';
        warning = 'Color printing is currently in maintenance. Set to Black & White.';
      }
      if (sides === 'duplex' && !pricing.duplex_available) {
        sides = 'single';
        warning = 'Duplex printing is currently unavailable. Set to Single Sided.';
      }

      await applyJobUpdate(
        pendingJob,
        {
          colorMode,
          sides,
          copies: opts.copies,
          pageRange: opts.pageRange,
          warning,
        },
        senderJid
      );
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
 * Structured confirmation receipt with quick-reply guide and 1-tap mobile customizer link
 */
export function formatWhatsAppReceipt(
  job: PrintJob,
  tunnelUrl: string,
  warning?: string
): string {
  const colorLabel = job.color_mode === 'color' ? 'Color' : 'B/W';
  const sidesLabel = job.sides === 'duplex' ? 'Front & Back' : 'Single Sided';
  const pageRangeLabel =
    !job.page_range || job.page_range.toLowerCase() === 'all'
      ? ''
      : ` • Pages ${job.page_range}`;
  const copiesLabel = job.copies > 1 ? ` • ${job.copies} Copies` : '';

  const cleanToken = job.token.replace(/^#/, '');
  const baseUrl = (tunnelUrl || '').trim().replace(/\/$/, '') || 'http://localhost:3000';
  const customizerUrl = `${baseUrl}/order/${encodeURIComponent(cleanToken)}`;

  let docInfo = `📄 Received: ${job.original_filename}`;
  if (job.page_count && job.page_count > 0) {
    docInfo += ` (${job.page_count} ${job.page_count === 1 ? 'page' : 'pages'})`;
  }

  const lines = [
    docInfo,
    `💰 Estimated: ₹${job.estimated_cost.toFixed(2)} (${colorLabel} • ${sidesLabel}${copiesLabel}${pageRangeLabel})`,
    `🎫 Token: ${job.token}`,
    ``,
    `👉 📱 Tap to customize in 1-tap (No typing needed):`,
    `${customizerUrl}`,
    `(Select B/W or Color, Single or Both sides, pages & copies visually!)`,
    ``,
    `⚡ Or quick-reply with a number:`,
    `1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex`,
  ];

  if (warning) {
    lines.push(``, `⚠️ _${warning}_`);
  }

  return lines.join('\n');
}

/**
 * Structured update notification sent when customer modifies options
 */
export function formatWhatsAppUpdateReceipt(
  job: PrintJob,
  tunnelUrl: string,
  warning?: string
): string {
  const colorLabel = job.color_mode === 'color' ? 'Color' : 'B/W';
  const sidesLabel = job.sides === 'duplex' ? 'Front & Back' : 'Single Sided';
  const pageRangeLabel =
    !job.page_range || job.page_range.toLowerCase() === 'all'
      ? ''
      : ` • Pages ${job.page_range}`;
  const copiesLabel = job.copies > 1 ? ` • ${job.copies} Copies` : '';

  const cleanToken = job.token.replace(/^#/, '');
  const baseUrl = (tunnelUrl || '').trim().replace(/\/$/, '') || 'http://localhost:3000';
  const customizerUrl = `${baseUrl}/order/${encodeURIComponent(cleanToken)}`;

  let docInfo = `📄 Received: ${job.original_filename}`;
  if (job.page_count && job.page_count > 0) {
    docInfo += ` (${job.page_count} ${job.page_count === 1 ? 'page' : 'pages'})`;
  }

  const lines = [
    `✅ *Options Updated!*`,
    ``,
    docInfo,
    `💰 Estimated: ₹${job.estimated_cost.toFixed(2)} (${colorLabel} • ${sidesLabel}${copiesLabel}${pageRangeLabel})`,
    `🎫 Token: ${job.token}`,
    ``,
    `👉 📱 Tap to customize in 1-tap (No typing needed):`,
    `${customizerUrl}`,
    `(Select B/W or Color, Single or Both sides, pages & copies visually!)`,
    ``,
    `⚡ Or quick-reply with a number:`,
    `1️⃣ B/W Single  2️⃣ B/W Duplex  3️⃣ Color Single  4️⃣ Color Duplex`,
  ];

  if (warning) {
    lines.push(``, `⚠️ _${warning}_`);
  }

  return lines.join('\n');
}

/**
 * Apply keyword updates to an existing pending job and notify customer
 */
export async function applyJobUpdate(
  job: PrintJob,
  updates: {
    colorMode?: ColorMode;
    sides?: SidesMode;
    copies?: number;
    pageRange?: string;
    warning?: string;
  },
  recipientJid: string
): Promise<PrintJob | undefined> {
  const pricing = getEffectivePricing();
  const files = getJobFiles(job.id);

  let newColor = updates.colorMode || job.color_mode;
  let newSides = updates.sides || job.sides;
  let newCopies = updates.copies || job.copies;
  let newPageRange = updates.pageRange !== undefined ? updates.pageRange : job.page_range;

  if (!pricing.color_available && newColor === 'color') newColor = 'bw';
  if (!pricing.duplex_available && newSides === 'duplex') newSides = 'single';

  let totalCost = 0;
  let totalPages = 0;
  let primaryEffectivePages = job.effective_pages;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const cost = calculatePrintCost({
      totalPages: f.page_count,
      pageRange: newPageRange,
      colorMode: newColor,
      sides: newSides,
      copies: newCopies,
      pricing,
    });
    totalCost += cost.totalCost;
    totalPages += cost.effectivePages * newCopies;
    if (i === 0) primaryEffectivePages = cost.effectivePages;

    updateJobFile(f.id, {
      color_mode: newColor,
      sides: newSides,
      copies: newCopies,
      page_range: newPageRange,
      effective_pages: cost.effectivePages,
      estimated_cost: cost.totalCost,
    });
  }

  const updatedJob = updateJob(job.id, {
    color_mode: newColor,
    sides: newSides,
    copies: newCopies,
    page_range: newPageRange,
    effective_pages: primaryEffectivePages,
    estimated_cost: totalCost,
    total_pages: totalPages,
  });

  if (broadcastCallback && updatedJob) {
    broadcastCallback({ type: 'JOB_UPDATED', job: updatedJob });
  }

  if (sock && updatedJob) {
    try {
      const tunnel = await getTunnelStatus();
      const updateText = formatWhatsAppUpdateReceipt(updatedJob, tunnel.activeUrl, updates.warning);
      await sock.sendMessage(recipientJid, { text: updateText });
    } catch (err: any) {
      console.warn('[WhatsApp] Failed to send update receipt:', err.message);
    }
  }

  return updatedJob;
}

/**
 * Send WhatsApp notification when order options are updated via web
 */
export async function sendWhatsAppOrderUpdateNotification(job: PrintJob, warning?: string) {
  if (!sock || !job.whatsapp_jid) return;
  try {
    const tunnel = await getTunnelStatus();
    const updateText = formatWhatsAppUpdateReceipt(job, tunnel.activeUrl, warning);
    await sock.sendMessage(job.whatsapp_jid, { text: updateText });
  } catch (err: any) {
    console.warn('[WhatsApp] Failed to send order update notification:', err.message);
  }
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
    const pageRange = batch.pageRange || 'all';

    for (let i = 0; i < filesToProcess.length; i++) {
      const f = filesToProcess[i];
      const costRes = calculatePrintCost({
        totalPages: f.pageCount,
        pageRange,
        colorMode,
        sides,
        copies,
        pricing,
      });

      totalPages += costRes.effectivePages * copies;
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
        page_range: pageRange,
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
      page_range: pageRange,
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

    const tunnel = await getTunnelStatus();
    const replyText = formatWhatsAppReceipt(saved, tunnel.activeUrl);

    await sock.sendMessage(batch.senderJid, { text: replyText });
    console.log(`✅ [WhatsApp] Job ${token} created and confirmation receipt sent to ${batch.senderJid}`);
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
