export type ColorMode = 'bw' | 'color';
export type SidesMode = 'single' | 'duplex';
export type OrientationMode = 'portrait' | 'landscape' | 'auto';
export type JobStatus = 'pending' | 'printing' | 'printed' | 'cancelled';

export interface JobFile {
  id: string;
  job_id: string;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  page_count: number;
  color_mode: ColorMode;
  sides: SidesMode;
  orientation: OrientationMode;
  copies: number;
  page_range: string;
  effective_pages: number;
  estimated_cost: number;
  file_index: number;
  status: JobStatus;
  cups_job_id: string | null;
  printed_at: string | null;
}

export type JobSource = 'web' | 'whatsapp';

export interface PrintJob {
  id: string;
  token: string;
  customer_name: string;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  page_count: number;
  color_mode: ColorMode;
  sides: SidesMode;
  orientation: OrientationMode;
  copies: number;
  page_range: string;
  effective_pages: number;
  estimated_cost: number;
  status: JobStatus;
  created_at: string;
  printed_at: string | null;
  printer_name: string | null;
  cups_job_id: string | null;
  files?: JobFile[];
  total_files?: number;
  total_pages?: number;
  source?: JobSource;
  whatsapp_jid?: string | null;
  whatsapp_sender_name?: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
  source: 'billing_db' | 'fallback_admin';
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

export interface PrinterProfile {
  id: string;
  name: string;
  cups_printer_name: string;
  supports_color: boolean;
  supports_duplex: boolean;
  duplex_enabled: boolean;
  is_active: boolean; // true = operational, false = in maintenance
  bw_single_price: number;
  bw_duplex_price: number;
  color_single_price: number;
  color_duplex_price: number;
  created_at: string;
  updated_at: string;
}

export interface EffectivePricing {
  bw_price_per_page: number;
  color_price_per_page: number;
  duplex_sheet_price_bw: number;
  duplex_sheet_price_color: number;
  color_available: boolean;
  duplex_available: boolean;
  global_duplex_enabled: boolean;
  active_printers_count: number;
  has_active_printers: boolean;
  active_printers: string[];
}

export interface PricingSettings {
  bw_price_per_page: number;
  color_price_per_page: number;
  duplex_sheet_price_bw: number;
  duplex_sheet_price_color: number;
  default_printer: string;
  retention_hours: number;
  global_duplex_enabled?: boolean;
  color_available?: boolean;
  duplex_available?: boolean;
}

export interface ShopDetails {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  shopEmail: string;
  gstNumber: string;
  hasLogo: boolean;
  logoUrl: string;
  source: 'pos_db' | 'fallback';
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: 'idle' | 'printing' | 'disabled' | 'unknown';
  rawStatus: string;
  isMock?: boolean;
}

export interface CostCalculation {
  effectivePages: number;
  sheets: number;
  perCopyCost: number;
  totalCost: number;
  copies: number;
  breakdownText: string;
}

export interface TunnelStatus {
  isRunning: boolean;
  tunnelUrl: string | null;
  localUrls: string[];
  activeUrl: string;
  qrCodeDataUrl: string;
  provider: 'cloudflare' | 'ssh' | 'custom' | 'none';
  autoStart: boolean;
  error?: string | null;
}

export interface TunnelSettings {
  auto_start: boolean;
  preferred_provider: 'auto' | 'cloudflare' | 'ssh' | 'custom';
  manual_url?: string;
}

export type PrinterConnectionType = 'network_bonjour' | 'usb_direct' | 'cups_queue' | 'network_ip';

export interface DiscoveredPrinter {
  id: string;
  name: string;
  model: string;
  manufacturer: string;
  connectionType: PrinterConnectionType;
  cupsPrinterName?: string;
  ipAddress?: string;
  hostname?: string;
  port?: number;
  deviceUri: string;
  supportsColor: boolean;
  supportsDuplex: boolean;
  isOnline: boolean;
  status: 'online' | 'idle' | 'printing' | 'offline';
  adminUrl?: string;
  matchedProfileId?: string;
  matchedProfileName?: string;
  lastSeen: string;
}

export interface WhatsAppStatus {
  state: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  phoneNumber?: string | null;
  pushName?: string | null;
  qrCodeDataUrl?: string | null;
  lastConnected?: string | null;
  error?: string | null;
}

export interface WhatsAppSettings {
  enabled: boolean;
  notifyOnPrint: boolean;
  notifyOnComplete: boolean;
  welcomeEnabled: boolean;
  customWelcomeMessage?: string;
}

export interface WsMessage {
  type:
    | 'CONNECTED'
    | 'PING'
    | 'PONG'
    | 'NEW_JOB'
    | 'JOB_UPDATED'
    | 'JOB_DELETED'
    | 'PRINTERS_UPDATED'
    | 'PRINTERS_DISCOVERED'
    | 'PRINTER_PROFILES_UPDATED'
    | 'PRICING_UPDATED'
    | 'SETTINGS_UPDATED'
    | 'TUNNEL_UPDATED'
    | 'WHATSAPP_STATUS_UPDATED';
  job?: PrintJob;
  jobId?: string;
  status?: TunnelStatus;
  profiles?: PrinterProfile[];
  pricing?: PricingSettings;
  printers?: PrinterInfo[];
  discoveredPrinters?: DiscoveredPrinter[];
  whatsappStatus?: WhatsAppStatus;
  message?: string;
}
