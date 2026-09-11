import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PrintJob, PricingSettings, PrinterProfile, EffectivePricing } from '../shared/types.js';
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
    id                TEXT PRIMARY KEY,
    token             TEXT NOT NULL,
    customer_name     TEXT NOT NULL,
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
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL,
    printed_at        TEXT,
    printer_name      TEXT,
    cups_job_id       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
`);

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

  const seq = 101 + (countRow?.count || 0);
  return `#P-${seq}`;
}

export function insertJob(job: PrintJob): PrintJob {
  const stmt = db.prepare(`
    INSERT INTO jobs (
      id, token, customer_name, original_filename, stored_filename, file_path,
      file_size, mime_type, page_count, color_mode, sides, orientation,
      copies, page_range, effective_pages, estimated_cost, status,
      created_at, printed_at, printer_name, cups_job_id
    ) VALUES (
      @id, @token, @customer_name, @original_filename, @stored_filename, @file_path,
      @file_size, @mime_type, @page_count, @color_mode, @sides, @orientation,
      @copies, @page_range, @effective_pages, @estimated_cost, @status,
      @created_at, @printed_at, @printer_name, @cups_job_id
    )
  `);

  stmt.run({
    ...job,
    printed_at: job.printed_at || null,
    printer_name: job.printer_name || null,
    cups_job_id: job.cups_job_id || null,
  });

  return job;
}

export function getAllJobs(): PrintJob[] {
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as PrintJob[];
}

export function getJobById(id: string): PrintJob | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as PrintJob | undefined;
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
      cups_job_id = @cups_job_id
    WHERE id = @id
  `);

  stmt.run({
    ...merged,
    printed_at: merged.printed_at || null,
    printer_name: merged.printer_name || null,
    cups_job_id: merged.cups_job_id || null,
  });

  return getJobById(id);
}

export function deleteJob(id: string): boolean {
  const res = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return res.changes > 0;
}

export function getExpiredJobs(maxAgeMs: number): PrintJob[] {
  const thresholdDate = new Date(Date.now() - maxAgeMs).toISOString();
  return db.prepare('SELECT * FROM jobs WHERE created_at < ?').all(thresholdDate) as PrintJob[];
}
