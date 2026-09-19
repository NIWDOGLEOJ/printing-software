import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PrintJob, JobFile, PricingSettings, PrinterProfile, EffectivePricing, WhatsAppSettings } from '../shared/types.js';
import { DEFAULT_PRICING, calculateEffectivePricing } from '../shared/costCalculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../print_jobs.db');
export const db = new Database(dbPath);

// Enable WAL mode
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS pricing_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS printer_profiles (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    cups_printer_name  TEXT NOT NULL DEFAULT '',
    supports_color     INTEGER NOT NULL DEFAULT 1,
    supports_duplex    INTEGER NOT NULL DEFAULT 1,
    duplex_enabled     INTEGER NOT NULL DEFAULT 1,
    is_active          INTEGER NOT NULL DEFAULT 1,
    bw_single_price    REAL NOT NULL DEFAULT 2,
    bw_duplex_price    REAL NOT NULL DEFAULT 3,
    color_single_price REAL NOT NULL DEFAULT 10,
    color_duplex_price REAL NOT NULL DEFAULT 18,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id                   TEXT PRIMARY KEY,
    token                TEXT NOT NULL,
    customer_name        TEXT NOT NULL,
    original_filename    TEXT NOT NULL,
    stored_filename      TEXT NOT NULL,
    file_path            TEXT NOT NULL,
    file_size            INTEGER NOT NULL,
    mime_type            TEXT NOT NULL,
    page_count           INTEGER NOT NULL,
    color_mode           TEXT NOT NULL,
    sides                TEXT NOT NULL,
    orientation          TEXT NOT NULL,
    copies               INTEGER NOT NULL DEFAULT 1,
    page_range           TEXT NOT NULL DEFAULT 'all',
    effective_pages      INTEGER NOT NULL DEFAULT 1,
    estimated_cost       REAL NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'pending',
    created_at           TEXT NOT NULL,
    printed_at           TEXT,
    printer_name         TEXT,
    cups_job_id          TEXT,
    total_files          INTEGER NOT NULL DEFAULT 1,
    total_pages          INTEGER NOT NULL DEFAULT 1,
    source               TEXT NOT NULL DEFAULT 'web',
    whatsapp_jid         TEXT,
    whatsapp_sender_name TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

  CREATE TABLE IF NOT EXISTS job_files (
    id                TEXT PRIMARY KEY,
    job_id            TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename   TEXT NOT NULL,
    file_path         TEXT NOT NULL,
    file_size         INTEGER NOT NULL,
    mime_type         TEXT NOT NULL,
    page_count        INTEGER NOT NULL,
    color_mode        TEXT NOT NULL,
    sides             TEXT NOT NULL,
    orientation       TEXT NOT NULL,
    copies            INTEGER NOT NULL DEFAULT 1,
    page_range        TEXT NOT NULL DEFAULT 'all',
    effective_pages   INTEGER NOT NULL DEFAULT 1,
    estimated_cost    REAL NOT NULL DEFAULT 0,
    file_index        INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending',
    cups_job_id       TEXT,
    printed_at        TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
`);

// Migration: add columns if they don't exist on older db instances
try {
  db.prepare('ALTER TABLE jobs ADD COLUMN total_files INTEGER DEFAULT 1').run();
} catch {}
try {
  db.prepare('ALTER TABLE jobs ADD COLUMN total_pages INTEGER DEFAULT 1').run();
} catch {}
try {
  db.prepare("ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'web'").run();
} catch {}
try {
  db.prepare('ALTER TABLE jobs ADD COLUMN whatsapp_jid TEXT').run();
} catch {}
try {
  db.prepare('ALTER TABLE jobs ADD COLUMN whatsapp_sender_name TEXT').run();
} catch {}
try {
  db.prepare('CREATE INDEX IF NOT EXISTS idx_jobs_whatsapp_jid ON jobs(whatsapp_jid)').run();
} catch {}

// Legacy migration: ensure any existing jobs have entries in job_files
try {
  const legacyJobs = db.prepare(`
    SELECT j.* FROM jobs j
    LEFT JOIN job_files jf ON j.id = jf.job_id
    WHERE jf.id IS NULL
  `).all() as any[];

  for (const lj of legacyJobs) {
    db.prepare(`
      INSERT OR IGNORE INTO job_files (
        id, job_id, original_filename, stored_filename, file_path, file_size,
        mime_type, page_count, color_mode, sides, orientation, copies,
        page_range, effective_pages, estimated_cost, file_index, status,
        cups_job_id, printed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      `file_${lj.id}_0`,
      lj.id,
      lj.original_filename || 'document.pdf',
      lj.stored_filename || '',
      lj.file_path || '',
      lj.file_size || 0,
      lj.mime_type || 'application/pdf',
      lj.page_count || 1,
      lj.color_mode || 'bw',
      lj.sides || 'single',
      lj.orientation || 'auto',
      lj.copies || 1,
      lj.page_range || 'all',
      lj.effective_pages || 1,
      lj.estimated_cost || 0,
      0,
      lj.status || 'pending',
      lj.cups_job_id || null,
      lj.printed_at || null
    );
  }
} catch {}

// Seed default settings if empty
const insertSetting = db.prepare('INSERT OR IGNORE INTO pricing_settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_PRICING)) {
  insertSetting.run(k, String(v));
}

// Seed default printer profiles if table is empty
export function seedDefaultPrinterProfiles(force = false): void {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM printer_profiles').get() as { count: number };
  if (!force && countRow && countRow.count > 0) {
    return;
  }

  if (force) {
    db.prepare('DELETE FROM printer_profiles').run();
  }

  const now = new Date().toISOString();
  const insertProf = db.prepare(`
    INSERT OR REPLACE INTO printer_profiles (
      id, name, cups_printer_name, supports_color, supports_duplex, duplex_enabled,
      is_active, bw_single_price, bw_duplex_price, color_single_price, color_duplex_price,
      created_at, updated_at
    ) VALUES (
      @id, @name, @cups_printer_name, @supports_color, @supports_duplex, @duplex_enabled,
      @is_active, @bw_single_price, @bw_duplex_price, @color_single_price, @color_duplex_price,
      @created_at, @updated_at
    )
  `);

  const seedTx = db.transaction(() => {
    // Profile 1: Canon imageRUNNER 4225 (B/W only, currently in maintenance)
    insertProf.run({
      id: 'ir4225',
      name: 'Canon imageRUNNER 4225',
      cups_printer_name: 'Canon_IR4225',
      supports_color: 0,
      supports_duplex: 1,
      duplex_enabled: 1,
      is_active: 0,
      bw_single_price: 2,
      bw_duplex_price: 3,
      color_single_price: 0,
      color_duplex_price: 0,
      created_at: now,
      updated_at: now,
    });

    // Profile 2: Canon MAXIFY GX4070 (B/W & Color, operational)
    insertProf.run({
      id: 'gx4070',
      name: 'Canon MAXIFY GX4070',
      cups_printer_name: 'Canon_GX4000_series',
      supports_color: 1,
      supports_duplex: 1,
      duplex_enabled: 1,
      is_active: 1,
      bw_single_price: 3,
      bw_duplex_price: 5,
      color_single_price: 10,
      color_duplex_price: 18,
      created_at: now,
      updated_at: now,
    });
  });

  seedTx();
}

seedDefaultPrinterProfiles(false);

interface PrinterProfileRow {
  id: string;
  name: string;
  cups_printer_name: string;
  supports_color: number;
  supports_duplex: number;
  duplex_enabled: number;
  is_active: number;
  bw_single_price: number;
  bw_duplex_price: number;
  color_single_price: number;
  color_duplex_price: number;
  created_at: string;
  updated_at: string;
}

function mapProfileRow(row: PrinterProfileRow): PrinterProfile {
  return {
    id: row.id,
    name: row.name,
    cups_printer_name: row.cups_printer_name || '',
    supports_color: Boolean(row.supports_color),
    supports_duplex: Boolean(row.supports_duplex),
    duplex_enabled: Boolean(row.duplex_enabled),
    is_active: Boolean(row.is_active),
    bw_single_price: Number(row.bw_single_price),
    bw_duplex_price: Number(row.bw_duplex_price),
    color_single_price: Number(row.color_single_price),
    color_duplex_price: Number(row.color_duplex_price),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getAllPrinterProfiles(): PrinterProfile[] {
  const rows = db.prepare('SELECT * FROM printer_profiles ORDER BY name ASC').all() as PrinterProfileRow[];
  return rows.map(mapProfileRow);
}

export function getPrinterProfileById(id: string): PrinterProfile | undefined {
  const row = db.prepare('SELECT * FROM printer_profiles WHERE id = ?').get(id) as PrinterProfileRow | undefined;
  return row ? mapProfileRow(row) : undefined;
}

export function upsertPrinterProfile(profile: Partial<PrinterProfile> & { name: string }): PrinterProfile {
  const id = profile.id || `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const existing = getPrinterProfileById(id);

  const stmt = db.prepare(`
    INSERT INTO printer_profiles (
      id, name, cups_printer_name, supports_color, supports_duplex, duplex_enabled,
      is_active, bw_single_price, bw_duplex_price, color_single_price, color_duplex_price,
      created_at, updated_at
    ) VALUES (
      @id, @name, @cups_printer_name, @supports_color, @supports_duplex, @duplex_enabled,
      @is_active, @bw_single_price, @bw_duplex_price, @color_single_price, @color_duplex_price,
      @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      cups_printer_name = excluded.cups_printer_name,
      supports_color = excluded.supports_color,
      supports_duplex = excluded.supports_duplex,
      duplex_enabled = excluded.duplex_enabled,
      is_active = excluded.is_active,
      bw_single_price = excluded.bw_single_price,
      bw_duplex_price = excluded.bw_duplex_price,
      color_single_price = excluded.color_single_price,
      color_duplex_price = excluded.color_duplex_price,
      updated_at = excluded.updated_at
  `);

  stmt.run({
    id,
    name: profile.name,
    cups_printer_name: profile.cups_printer_name ?? existing?.cups_printer_name ?? '',
    supports_color: profile.supports_color !== undefined ? (profile.supports_color ? 1 : 0) : (existing?.supports_color ? 1 : 0),
    supports_duplex: profile.supports_duplex !== undefined ? (profile.supports_duplex ? 1 : 0) : (existing?.supports_duplex ? 1 : 1),
    duplex_enabled: profile.duplex_enabled !== undefined ? (profile.duplex_enabled ? 1 : 0) : (existing?.duplex_enabled ? 1 : 1),
    is_active: profile.is_active !== undefined ? (profile.is_active ? 1 : 0) : (existing?.is_active ? 1 : 1),
    bw_single_price: Number(profile.bw_single_price ?? existing?.bw_single_price ?? 2),
    bw_duplex_price: Number(profile.bw_duplex_price ?? existing?.bw_duplex_price ?? 3),
    color_single_price: Number(profile.color_single_price ?? existing?.color_single_price ?? 10),
    color_duplex_price: Number(profile.color_duplex_price ?? existing?.color_duplex_price ?? 18),
    created_at: existing?.created_at || now,
    updated_at: now,
  });

  return getPrinterProfileById(id)!;
}

export function updatePrinterProfile(id: string, updates: Partial<PrinterProfile>): PrinterProfile | undefined {
  const current = getPrinterProfileById(id);
  if (!current) return undefined;

  const merged = { ...current, ...updates, updated_at: new Date().toISOString() };
  return upsertPrinterProfile(merged);
}

export function deletePrinterProfile(id: string): boolean {
  const res = db.prepare('DELETE FROM printer_profiles WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getEffectivePricing(): EffectivePricing {
  const profiles = getAllPrinterProfiles();
  const rawRows = db.prepare('SELECT key, value FROM pricing_settings').all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const row of rawRows) {
    map[row.key] = row.value;
  }
  const globalDuplex = map.global_duplex_enabled !== 'false';

  return calculateEffectivePricing(profiles, {
    globalDuplexEnabled: globalDuplex,
    fallbackPricing: {
      bw_price_per_page: Number(map.bw_price_per_page ?? DEFAULT_PRICING.bw_price_per_page),
      color_price_per_page: Number(map.color_price_per_page ?? DEFAULT_PRICING.color_price_per_page),
      duplex_sheet_price_bw: Number(map.duplex_sheet_price_bw ?? DEFAULT_PRICING.duplex_sheet_price_bw),
      duplex_sheet_price_color: Number(map.duplex_sheet_price_color ?? DEFAULT_PRICING.duplex_sheet_price_color),
    },
  });
}

export function getPricingSettings(): PricingSettings {
  const rows = db.prepare('SELECT key, value FROM pricing_settings').all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }

  const effective = getEffectivePricing();

  return {
    bw_price_per_page: Number(map.bw_price_per_page ?? DEFAULT_PRICING.bw_price_per_page),
    color_price_per_page: Number(map.color_price_per_page ?? DEFAULT_PRICING.color_price_per_page),
    duplex_sheet_price_bw: Number(map.duplex_sheet_price_bw ?? DEFAULT_PRICING.duplex_sheet_price_bw),
    duplex_sheet_price_color: Number(map.duplex_sheet_price_color ?? DEFAULT_PRICING.duplex_sheet_price_color),
    default_printer: map.default_printer ?? DEFAULT_PRICING.default_printer,
    retention_hours: Number(map.retention_hours ?? DEFAULT_PRICING.retention_hours),
    global_duplex_enabled: map.global_duplex_enabled !== 'false',
    color_available: effective.color_available,
    duplex_available: effective.duplex_available,
  };
}

export function updatePricingSettings(settings: Partial<PricingSettings>): PricingSettings {
  const upsert = db.prepare('INSERT OR REPLACE INTO pricing_settings (key, value) VALUES (?, ?)');
  const updateTx = db.transaction(() => {
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined) {
        upsert.run(k, String(v));
      }
    }
  });
  updateTx();
  return getPricingSettings();
}

/**
 * Generate sequential human-friendly tokens like #P-101, #P-102
 * Based on today's jobs count or sequence
 */
export function getNextToken(): string {
  const today = new Date().toISOString().split('T')[0];
  const countRow = db.prepare(
    "SELECT COUNT(*) as count FROM jobs WHERE created_at LIKE ? || '%'"
  ).get(today) as { count: number };

  let seq = 101 + (countRow?.count || 0);
  while (db.prepare('SELECT id FROM jobs WHERE token = ?').get(`#P-${seq}`)) {
    seq++;
  }
  return `#P-${seq}`;
}

export function getJobFiles(jobId: string): JobFile[] {
  return db.prepare('SELECT * FROM job_files WHERE job_id = ? ORDER BY file_index ASC').all(jobId) as JobFile[];
}

export function getJobFileById(fileId: string): JobFile | undefined {
  return db.prepare('SELECT * FROM job_files WHERE id = ?').get(fileId) as JobFile | undefined;
}

export function insertJobWithFiles(job: PrintJob, files: JobFile[]): PrintJob {
  const totalFiles = files.length > 0 ? files.length : 1;
  const totalPages = files.reduce((sum, f) => sum + (f.page_count * f.copies), 0);
  const totalCost = files.reduce((sum, f) => sum + f.estimated_cost, 0);

  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (
      id, token, customer_name, original_filename, stored_filename, file_path,
      file_size, mime_type, page_count, color_mode, sides, orientation,
      copies, page_range, effective_pages, estimated_cost, status,
      created_at, printed_at, printer_name, cups_job_id, total_files, total_pages,
      source, whatsapp_jid, whatsapp_sender_name
    ) VALUES (
      @id, @token, @customer_name, @original_filename, @stored_filename, @file_path,
      @file_size, @mime_type, @page_count, @color_mode, @sides, @orientation,
      @copies, @page_range, @effective_pages, @estimated_cost, @status,
      @created_at, @printed_at, @printer_name, @cups_job_id, @total_files, @total_pages,
      @source, @whatsapp_jid, @whatsapp_sender_name
    )
  `);

  const insertFileStmt = db.prepare(`
    INSERT INTO job_files (
      id, job_id, original_filename, stored_filename, file_path, file_size,
      mime_type, page_count, color_mode, sides, orientation, copies,
      page_range, effective_pages, estimated_cost, file_index, status,
      cups_job_id, printed_at
    ) VALUES (
      @id, @job_id, @original_filename, @stored_filename, @file_path, @file_size,
      @mime_type, @page_count, @color_mode, @sides, @orientation, @copies,
      @page_range, @effective_pages, @estimated_cost, @file_index, @status,
      @cups_job_id, @printed_at
    )
  `);

  const tx = db.transaction(() => {
    insertJobStmt.run({
      ...job,
      total_files: totalFiles,
      total_pages: totalPages || job.page_count || 1,
      estimated_cost: totalCost || job.estimated_cost || 0,
      printed_at: job.printed_at || null,
      printer_name: job.printer_name || null,
      cups_job_id: job.cups_job_id || null,
      source: job.source || 'web',
      whatsapp_jid: job.whatsapp_jid || null,
      whatsapp_sender_name: job.whatsapp_sender_name || null,
    });

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      insertFileStmt.run({
        ...f,
        file_index: i,
        status: f.status || 'pending',
        cups_job_id: f.cups_job_id || null,
        printed_at: f.printed_at || null,
      });
    }
  });

  tx();
  return getJobById(job.id)!;
}

export function insertJob(job: PrintJob): PrintJob {
  if (job.files && job.files.length > 0) {
    return insertJobWithFiles(job, job.files);
  }

  // Create single file entry for backward compatibility
  const file: JobFile = {
    id: `file_${job.id}_0`,
    job_id: job.id,
    original_filename: job.original_filename,
    stored_filename: job.stored_filename,
    file_path: job.file_path,
    file_size: job.file_size,
    mime_type: job.mime_type,
    page_count: job.page_count,
    color_mode: job.color_mode,
    sides: job.sides,
    orientation: job.orientation,
    copies: job.copies,
    page_range: job.page_range,
    effective_pages: job.effective_pages,
    estimated_cost: job.estimated_cost,
    file_index: 0,
    status: job.status,
    cups_job_id: job.cups_job_id,
    printed_at: job.printed_at,
  };

  return insertJobWithFiles(job, [file]);
}

export function getAllJobs(): PrintJob[] {
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as PrintJob[];
  const allFiles = db.prepare('SELECT * FROM job_files ORDER BY file_index ASC').all() as JobFile[];
  const filesByJob = new Map<string, JobFile[]>();
  for (const f of allFiles) {
    const list = filesByJob.get(f.job_id) || [];
    list.push(f);
    filesByJob.set(f.job_id, list);
  }

  return jobs.map((j) => {
    const files = filesByJob.get(j.id) || [];
    return {
      ...j,
      files,
      total_files: j.total_files || (files.length > 0 ? files.length : 1),
      total_pages: j.total_pages || (files.length > 0 ? files.reduce((s, f) => s + (f.page_count * f.copies), 0) : j.page_count),
    };
  });
}

export function getJobById(id: string): PrintJob | undefined {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as PrintJob | undefined;
  if (!job) return undefined;
  const files = getJobFiles(id);
  return {
    ...job,
    files,
    total_files: job.total_files || (files.length > 0 ? files.length : 1),
    total_pages: job.total_pages || (files.length > 0 ? files.reduce((s, f) => s + (f.page_count * f.copies), 0) : job.page_count),
  };
}

export function updateJobFile(fileId: string, updates: Partial<JobFile>): JobFile | undefined {
  const current = getJobFileById(fileId);
  if (!current) return undefined;
  const merged = { ...current, ...updates };

  db.prepare(`
    UPDATE job_files SET
      color_mode = @color_mode,
      sides = @sides,
      orientation = @orientation,
      copies = @copies,
      page_range = @page_range,
      effective_pages = @effective_pages,
      estimated_cost = @estimated_cost,
      status = @status,
      cups_job_id = @cups_job_id,
      printed_at = @printed_at
    WHERE id = @id
  `).run({
    ...merged,
    cups_job_id: merged.cups_job_id || null,
    printed_at: merged.printed_at || null,
  });

  // If all files in this job are printed, mark parent job printed as well
  const siblings = getJobFiles(current.job_id);
  const allPrinted = siblings.length > 0 && siblings.every((f) => f.status === 'printed');
  if (allPrinted) {
    updateJob(current.job_id, {
      status: 'printed',
      printed_at: new Date().toISOString(),
    });
  }

  return getJobFileById(fileId);
}

export function updateJob(id: string, updates: Partial<PrintJob>): PrintJob | undefined {
  const current = getJobById(id);
  if (!current) return undefined;

  const merged = { ...current, ...updates };
  const stmt = db.prepare(`
    UPDATE jobs SET
      customer_name = @customer_name,
      page_count = @page_count,
      color_mode = @color_mode,
      sides = @sides,
      orientation = @orientation,
      copies = @copies,
      page_range = @page_range,
      effective_pages = @effective_pages,
      estimated_cost = @estimated_cost,
      status = @status,
      printed_at = @printed_at,
      printer_name = @printer_name,
      cups_job_id = @cups_job_id,
      total_files = @total_files,
      total_pages = @total_pages,
      source = @source,
      whatsapp_jid = @whatsapp_jid,
      whatsapp_sender_name = @whatsapp_sender_name
    WHERE id = @id
  `);

  stmt.run({
    ...merged,
    total_files: merged.total_files || 1,
    total_pages: merged.total_pages || merged.page_count || 1,
    printed_at: merged.printed_at || null,
    printer_name: merged.printer_name || null,
    cups_job_id: merged.cups_job_id || null,
    source: merged.source || 'web',
    whatsapp_jid: merged.whatsapp_jid || null,
    whatsapp_sender_name: merged.whatsapp_sender_name || null,
  });

  return getJobById(id);
}

export function getJobByToken(token: string): PrintJob | undefined {
  const trimmed = token.trim();
  const rawClean = trimmed.replace(/^#/, '');
  const withHash = `#${rawClean}`;
  const numericP = /^\d+$/.test(rawClean) ? `#P-${rawClean}` : withHash;
  const pUpper = `P-${rawClean.replace(/^p-/i, '')}`;

  const job = db.prepare(`
    SELECT * FROM jobs 
    WHERE UPPER(token) = UPPER(?) 
       OR UPPER(token) = UPPER(?) 
       OR UPPER(token) = UPPER(?) 
       OR UPPER(token) = UPPER(?)
       OR UPPER(token) = UPPER(?)
    ORDER BY created_at DESC LIMIT 1
  `).get(trimmed, withHash, numericP, `#${pUpper}`, pUpper) as PrintJob | undefined;
  if (!job) return undefined;
  return getJobById(job.id);
}

export function getLatestPendingJobByWhatsAppJid(jid: string): PrintJob | undefined {
  const job = db.prepare(
    "SELECT * FROM jobs WHERE whatsapp_jid = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
  ).get(jid) as PrintJob | undefined;
  if (!job) return undefined;
  return getJobById(job.id);
}

export function getWhatsAppSettings(): WhatsAppSettings {
  const rows = db.prepare("SELECT key, value FROM pricing_settings WHERE key LIKE 'whatsapp_%'").all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }

  return {
    enabled: map['whatsapp_enabled'] === 'true',
    notifyOnPrint: map['whatsapp_notify_on_print'] !== 'false',
    notifyOnComplete: map['whatsapp_notify_on_complete'] !== 'false',
    welcomeEnabled: map['whatsapp_welcome_enabled'] !== 'false',
    customWelcomeMessage: map['whatsapp_custom_welcome'],
  };
}

export function updateWhatsAppSettings(settings: Partial<WhatsAppSettings>): WhatsAppSettings {
  const upsert = db.prepare('INSERT OR REPLACE INTO pricing_settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    if (settings.enabled !== undefined) upsert.run('whatsapp_enabled', String(settings.enabled));
    if (settings.notifyOnPrint !== undefined) upsert.run('whatsapp_notify_on_print', String(settings.notifyOnPrint));
    if (settings.notifyOnComplete !== undefined) upsert.run('whatsapp_notify_on_complete', String(settings.notifyOnComplete));
    if (settings.welcomeEnabled !== undefined) upsert.run('whatsapp_welcome_enabled', String(settings.welcomeEnabled));
    if (settings.customWelcomeMessage !== undefined) upsert.run('whatsapp_custom_welcome', String(settings.customWelcomeMessage));
  });
  tx();
  return getWhatsAppSettings();
}

export function deleteJob(id: string): boolean {
  db.prepare('DELETE FROM job_files WHERE job_id = ?').run(id);
  const res = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getExpiredJobs(maxAgeMs: number): PrintJob[] {
  const thresholdDate = new Date(Date.now() - maxAgeMs).toISOString();
  return db.prepare('SELECT * FROM jobs WHERE created_at < ?').all(thresholdDate) as PrintJob[];
}
