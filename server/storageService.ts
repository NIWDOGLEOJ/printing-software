import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { getExpiredJobs, deleteJob, getPricingSettings } from './db.js';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function getUploadsDir(): string {
  return UPLOADS_DIR;
}

// Multer disk storage engine
export const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    // Sanitize file name
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    cb(null, `${uniqueSuffix}_${baseName}${ext}`);
  },
});

export const fileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
  ];

  if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, PNG, and WebP documents are allowed'));
  }
};

export const uploadMiddleware = multer({
  storage: uploadStorage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max
  },
});

export function deletePhysicalFile(filePath: string): boolean {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.warn(`[StorageService] Failed to unlink file ${filePath}:`, (err as Error).message);
  }
  return false;
}

export function cleanupExpiredFiles(): { deletedCount: number; orphanedCount: number } {
  const settings = getPricingSettings();
  const retentionHours = Math.max(1, settings.retention_hours || 24);
  const maxAgeMs = retentionHours * 60 * 60 * 1000;
  const cutoffTime = Date.now() - maxAgeMs;

  let deletedCount = 0;
  let orphanedCount = 0;

  try {
    // 1. Clean expired jobs from DB and delete their files
    const expiredJobs = getExpiredJobs(maxAgeMs);
    for (const job of expiredJobs) {
      if (job.file_path) {
        deletePhysicalFile(job.file_path);
      }
      deleteJob(job.id);
      deletedCount++;
    }

    // 2. Scan uploads directory for orphaned / old files not caught in DB
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      if (file === '.gitkeep') continue;
      const fullPath = path.join(UPLOADS_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoffTime) {
          fs.unlinkSync(fullPath);
          orphanedCount++;
        }
      } catch (e) {
        // ignore
      }
    }

    if (deletedCount > 0 || orphanedCount > 0) {
      console.log(`🧹 [Retention Cleanup] Purged ${deletedCount} expired jobs and ${orphanedCount} old files (> ${retentionHours}h).`);
    }
  } catch (err) {
    console.error('[StorageService] Error during retention cleanup:', (err as Error).message);
  }

  return { deletedCount, orphanedCount };
}

export function initRetentionScheduler() {
  // Run on startup after 5 seconds
  setTimeout(() => {
    cleanupExpiredFiles();
  }, 5000);

  // Run every hour
  setInterval(() => {
    cleanupExpiredFiles();
  }, 60 * 60 * 1000);
}
