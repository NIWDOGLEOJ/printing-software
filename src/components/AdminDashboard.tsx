import React, { useState, useEffect, useMemo } from 'react';
import {
  Printer,
  QrCode,
  Globe,
  Settings,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  Layers,
  ExternalLink,
  Trash2,
  Sun,
  Moon,
  Wifi,
} from 'lucide-react';
import {
  PrintJob,
  PrinterInfo,
  PrinterProfile,
  PricingSettings,
  ShopDetails,
  TunnelStatus,
  DiscoveredPrinter,
} from '../types.js';
import {
  fetchJobs,
  fetchPrinters,
  fetchSettings,
  fetchEffectivePricing,
  fetchShopDetails,
  fetchTunnelStatus,
  fetchPrinterProfiles,
  fetchDiscoveredPrinters,
  updatePrinterProfile,
  updateSettings,
  deleteJob,
  updateJob,
  printJob,
  cleanupExpiredJobs,
  connectLiveWebSocket,
} from '../api.js';
import { JobCard } from './JobCard.js';
import { PreviewPrintModal } from './PreviewPrintModal.js';
import { CounterQrModal } from './CounterQrModal.js';
import { TunnelModal } from './TunnelModal.js';
import { SettingsModal } from './SettingsModal.js';
import { DiscoveredPrintersModal } from './DiscoveredPrintersModal.js';
import { chime } from './audioChime.js';
import { DEFAULT_PRICING } from '../utils/costCalculator.js';
import { formatCurrency } from '../utils/formatters.js';
import { useTheme } from '../theme.js';

interface AdminDashboardProps {
  onSwitchToCustomerView?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onSwitchToCustomerView,
}) => {
  const [theme, toggleTheme] = useTheme();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>([]);
  const [pricing, setPricing] = useState<PricingSettings>(DEFAULT_PRICING);
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);

  // Connection & audio states
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isChimeMuted, setIsChimeMuted] = useState(() => chime.getMuted());
  const [newJobToast, setNewJobToast] = useState<string | null>(null);

  // Filters & search
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'printed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickPrintingId, setQuickPrintingId] = useState<string | null>(null);

  // Modals
  const [previewJob, setPreviewJob] = useState<PrintJob | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showTunnelModal, setShowTunnelModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDiscoveredModal, setShowDiscoveredModal] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredPrinter[]>([]);

  // Load initial data
  const loadAllData = async () => {
    setIsRefreshing(true);
    try {
      const [
        loadedJobs,
        loadedPrinters,
        loadedProfiles,
        loadedDiscovered,
        loadedSettings,
        effectivePricing,
        loadedShop,
        loadedTunnel,
      ] = await Promise.all([
        fetchJobs().catch(() => []),
        fetchPrinters().catch(() => []),
        fetchPrinterProfiles().catch(() => []),
        fetchDiscoveredPrinters().catch(() => []),
        fetchSettings().catch(() => DEFAULT_PRICING),
        fetchEffectivePricing().catch(() => null),
        fetchShopDetails().catch(() => null),
        fetchTunnelStatus().catch(() => null),
      ]);

      setJobs(loadedJobs);
      setPrinters(loadedPrinters);
      setPrinterProfiles(loadedProfiles);
      setDiscoveredPrinters(loadedDiscovered);
      if (effectivePricing) {
        setPricing({
          ...loadedSettings,
          bw_price_per_page: effectivePricing.bw_price_per_page,
          color_price_per_page: effectivePricing.color_price_per_page,
          duplex_sheet_price_bw: effectivePricing.duplex_sheet_price_bw,
          duplex_sheet_price_color: effectivePricing.duplex_sheet_price_color,
          color_available: effectivePricing.color_available,
          duplex_available: effectivePricing.duplex_available,
          global_duplex_enabled: effectivePricing.global_duplex_enabled,
        });
      } else {
        setPricing(loadedSettings);
      }
      setShop(loadedShop);
      setTunnel(loadedTunnel);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Connect to live WebSocket for instant order arrivals and setting changes
  useEffect(() => {
    const disconnect = connectLiveWebSocket(
      (message) => {
        if (message.type === 'NEW_JOB') {
          chime.play();
          setJobs((prev) => [message.job, ...prev]);
          setNewJobToast(`New print order from ${message.job.customer_name} (${message.job.token})`);
          setTimeout(() => setNewJobToast(null), 5000);
        } else if (message.type === 'JOB_UPDATED') {
          setJobs((prev) =>
            prev.map((j) => (j.id === message.job.id ? message.job : j))
          );
          if (previewJob && previewJob.id === message.job.id) {
            setPreviewJob(message.job);
          }
        } else if (message.type === 'JOB_DELETED') {
          setJobs((prev) => prev.filter((j) => j.id !== message.id));
          if (previewJob && previewJob.id === message.id) {
            setPreviewJob(null);
          }
        } else if (message.type === 'JOBS_REFRESH') {
          fetchJobs().then(setJobs).catch(() => {});
        } else if (message.type === 'PRINTER_PROFILES_UPDATED') {
          setPrinterProfiles(message.profiles);
        } else if (message.type === 'PRICING_UPDATED') {
          setPricing((prev) => ({
            ...prev,
            bw_price_per_page: message.pricing.bw_price_per_page,
            color_price_per_page: message.pricing.color_price_per_page,
            duplex_sheet_price_bw: message.pricing.duplex_sheet_price_bw,
            duplex_sheet_price_color: message.pricing.duplex_sheet_price_color,
            color_available: message.pricing.color_available,
            duplex_available: message.pricing.duplex_available,
            global_duplex_enabled: message.pricing.global_duplex_enabled,
          }));
        } else if (message.type === 'SETTINGS_UPDATED') {
          setPricing((prev) => ({
            ...prev,
            ...message.settings,
          }));
        } else if (message.type === 'TUNNEL_UPDATED') {
          setTunnel(message.tunnel);
        } else if (message.type === 'PRINTERS_DISCOVERED') {
          setDiscoveredPrinters(message.discoveredPrinters);
        }
      },
      (status) => {
        setIsWsConnected(status);
      }
    );

    return disconnect;
  }, [previewJob?.id]);

  // 1-Click Toggle for Printer Status (Active / Maintenance)
  const handleTogglePrinterActive = async (profileId: string) => {
    const prof = printerProfiles.find((p) => p.id === profileId);
    if (!prof) return;
    const nextStatus = !prof.is_active;

    // Optimistic UI update
    setPrinterProfiles((prev) =>
      prev.map((p) => (p.id === profileId ? { ...p, is_active: nextStatus } : p))
    );

    try {
      const updated = await updatePrinterProfile(profileId, { is_active: nextStatus });
      setPrinterProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      // Reload pricing to sync effective rates immediately
      fetchEffectivePricing()
        .then((eff) => {
          setPricing((prev) => ({
            ...prev,
            bw_price_per_page: eff.bw_price_per_page,
            color_price_per_page: eff.color_price_per_page,
            duplex_sheet_price_bw: eff.duplex_sheet_price_bw,
            duplex_sheet_price_color: eff.duplex_sheet_price_color,
            color_available: eff.color_available,
            duplex_available: eff.duplex_available,
            global_duplex_enabled: eff.global_duplex_enabled,
          }));
        })
        .catch(() => {});
    } catch (err: any) {
      alert(`Failed to update printer status: ${err.message}`);
      loadAllData();
    }
  };

  // 1-Click Toggle for Global Duplex (Front & Back)
  const handleToggleGlobalDuplex = async () => {
    const currentEnabled = pricing.global_duplex_enabled !== false;
    const nextEnabled = !currentEnabled;

    // Optimistic update
    setPricing((prev) => ({
      ...prev,
      global_duplex_enabled: nextEnabled,
      duplex_available: nextEnabled,
    }));

    try {
      const updated = await updateSettings({ global_duplex_enabled: nextEnabled });
      setPricing(updated);
    } catch (err: any) {
      alert(`Failed to toggle Duplex: ${err.message}`);
      loadAllData();
    }
  };

  // Handle Quick Print (uses default printer)
  const handleQuickPrint = async (job: PrintJob) => {
    setQuickPrintingId(job.id);
    try {
      const defPrinter = printers.find((p) => p.isDefault)?.name || printers[0]?.name;
      const res = await printJob(job.id, {
        printerName: defPrinter,
        copies: job.copies,
        colorMode: job.color_mode,
        sides: job.sides,
        orientation: job.orientation,
        pageRange: job.page_range,
      });

      if (res.job) {
        setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      }
    } catch (err: any) {
      alert(`Quick Print Error: ${err.message}`);
    } finally {
      setQuickPrintingId(null);
    }
  };

  // Mark job printed / pending
  const handleMarkPrinted = async (job: PrintJob) => {
    const nextStatus = job.status === 'printed' ? 'pending' : 'printed';
    try {
      const updated = await updateJob(job.id, { status: nextStatus });
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Delete job
  const handleDelete = async (job: PrintJob) => {
    if (!confirm(`Delete order for ${job.customer_name} (${job.token})?`)) return;
    try {
      await deleteJob(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (err: any) {
      alert(`Failed to delete order: ${err.message}`);
    }
  };

  // Sweep >24h files manually
  const handleSweepExpired = async () => {
    try {
      const res = await cleanupExpiredJobs();
      alert(`Cleaned up ${res.deletedCount} expired jobs`);
      loadAllData();
    } catch (err: any) {
      alert(`Sweep failed: ${err.message}`);
    }
  };

  const handleToggleMute = () => {
    const nextMuted = chime.toggleMute();
    setIsChimeMuted(nextMuted);
  };

  // Filter and search
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (activeTab === 'pending' && j.status !== 'pending') return false;
      if (activeTab === 'printed' && j.status !== 'printed') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          j.customer_name.toLowerCase().includes(q) ||
          j.token.toLowerCase().includes(q) ||
          j.original_filename.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [jobs, activeTab, searchQuery]);

  // Daily statistics
  const stats = useMemo(() => {
    const total = jobs.length;
    const pending = jobs.filter((j) => j.status === 'pending').length;
    const printed = jobs.filter((j) => j.status === 'printed').length;
    const revenue = jobs
      .filter((j) => j.status === 'printed')
      .reduce((acc, curr) => acc + (curr.estimated_cost || 0), 0);

    return { total, pending, printed, revenue };
  }, [jobs]);

  return (
    <div className="min-h-screen flex flex-col font-sans text-[var(--ink)]">
      {/* Top Navbar */}
      <header className="bg-[var(--panel)] border-b border-[var(--border)] sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white overflow-hidden shadow-sm shrink-0">
              <img
                src="/api/shop/logo"
                alt="Logo"
                className="w-full h-full object-contain p-1"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <Printer className="w-5 h-5 text-white" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-[var(--ink)] leading-tight">
                  {shop?.shopName || 'J MART'}
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] hidden sm:inline-block uppercase tracking-wider">
                  Print Queue Station
                </span>
              </div>
              <p className="text-[11px] text-[var(--ink3)] flex items-center gap-1.5 font-mono">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isWsConnected ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--danger)]'
                  }`}
                />
                <span>{isWsConnected ? 'Live Real-time Sync' : 'Reconnecting Sync...'}</span>
                <span>•</span>
                <span className="truncate max-w-xs">{shop?.shopAddress || 'Ramapuram, Chennai'}</span>
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Theme Toggle (Dark / Light) */}
            <button
              onClick={() => toggleTheme()}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Audio Chime Toggle */}
            <button
              onClick={handleToggleMute}
              title={isChimeMuted ? 'Unmute Audio Chime' : 'Mute Audio Chime'}
              className={`p-2 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition ${
                isChimeMuted
                  ? 'bg-[var(--sub)] text-[var(--ink4)] border-[var(--border)] hover:bg-[var(--rule)]'
                  : 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)] hover:opacity-90'
              }`}
            >
              {isChimeMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span className="hidden md:inline">{isChimeMuted ? 'Muted' : 'Chime On'}</span>
            </button>

            {/* Counter QR Code */}
            <button
              onClick={() => setShowQrModal(true)}
              className="py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs"
            >
              <QrCode className="w-4 h-4 text-[var(--accent)]" />
              <span>Counter QR</span>
            </button>

            {/* Cloudflare Tunnel Status */}
            <button
              onClick={() => setShowTunnelModal(true)}
              className={`py-2 px-3 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs ${
                tunnel?.tunnelUrl
                  ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent)]'
                  : 'bg-[var(--sub)] border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--panel)]'
              }`}
            >
              <Globe className="w-4 h-4 text-[var(--accent)]" />
              <span className="hidden sm:inline">Tunnel</span>
              <span className={`w-1.5 h-1.5 rounded-full ${tunnel?.tunnelUrl ? 'bg-[var(--accent)]' : 'bg-[var(--ink4)]'}`} />
            </button>

            {/* Auto-Detected Printers Modal Trigger */}
            <button
              onClick={() => setShowDiscoveredModal(true)}
              title="Auto-Detected Network & USB Printers"
              className="py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs"
            >
              <Printer className="w-4 h-4 text-[var(--accent)]" />
              <span className="hidden sm:inline">Printers</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
            </button>

            {/* Pricing Settings */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs"
            >
              <Settings className="w-4 h-4 text-[var(--ink3)]" />
              <span className="hidden sm:inline">Rates</span>
            </button>

            {/* Manual Refresh */}
            <button
              onClick={loadAllData}
              disabled={isRefreshing}
              title="Refresh Queue"
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[var(--accent)]' : ''}`} />
            </button>

            {/* Customer Portal Link */}
            {onSwitchToCustomerView && (
              <button
                onClick={onSwitchToCustomerView}
                className="py-2 px-3 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-xs font-bold flex items-center gap-1.5 transition shadow"
              >
                <span>Customer View</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Header Quick Bar: 1-Click Status Controls for IR4225, GX4070 & Duplex */}
      <div className="bg-[var(--sub)] text-[var(--ink)] border-b border-[var(--border)] px-4 sm:px-6 py-2 shadow-inner">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="dc-eyebrow text-[var(--ink3)] flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5 text-[var(--accent)]" />
              Quick Printer Controls:
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-2 sm:gap-3">
            {printerProfiles.map((prof) => (
              <button
                key={prof.id}
                onClick={() => handleTogglePrinterActive(prof.id)}
                title={`Click to toggle ${prof.name} status`}
                className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition shadow-xs border cursor-pointer ${
                  prof.is_active
                    ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)] hover:opacity-90'
                    : 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)] hover:opacity-90'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    prof.is_active ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--warn)]'
                  }`}
                />
                <span className="text-[var(--ink)]">
                  {prof.name.replace('Canon ', '')}:
                </span>
                <span
                  className={`uppercase text-[10px] tracking-wide font-black px-1.5 py-0.5 rounded border ${
                    prof.is_active
                      ? 'bg-[var(--panel)] text-[var(--ok)] border-[var(--ok-line)]'
                      : 'bg-[var(--panel)] text-[var(--warn)] border-[var(--warn-line)]'
                  }`}
                >
                  {prof.is_active ? 'Active' : 'In Maintenance'}
                </span>
              </button>
            ))}

            {/* Global Duplex Toggle */}
            <button
              onClick={handleToggleGlobalDuplex}
              title="Click to toggle Front & Back (Duplex) customer availability"
              className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition shadow-xs border cursor-pointer ${
                pricing.global_duplex_enabled !== false
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)] hover:opacity-90'
                  : 'bg-[var(--panel)] text-[var(--ink4)] border-[var(--border)] hover:text-[var(--ink)]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="text-[var(--ink)]">Front & Back (Duplex):</span>
              <span
                className={`uppercase text-[10px] tracking-wide font-black px-1.5 py-0.5 rounded border ${
                  pricing.global_duplex_enabled !== false
                    ? 'bg-[var(--panel)] text-[var(--accent)] border-[var(--accent-line)]'
                    : 'bg-[var(--sub)] text-[var(--ink4)] border-[var(--border)]'
                }`}
              >
                {pricing.global_duplex_enabled !== false ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Auto-Detected Network & USB Printers Pill */}
            <button
              onClick={() => setShowDiscoveredModal(true)}
              title="Click to view all auto-detected network (Wi-Fi/LAN) and USB printers"
              className="px-3 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition shadow-xs border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)] hover:opacity-90 cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5" />
              <span className="text-[var(--ink)]">Hardware / LAN:</span>
              <span className="bg-[var(--panel)] text-[var(--accent)] border border-[var(--accent-line)] uppercase text-[10px] tracking-wide font-black px-1.5 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
                {discoveredPrinters.filter((p) => p.isOnline).length} Detected
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* New Job Arrival Toast */}
      {newJobToast && (
        <div className="fixed top-20 right-5 z-40 bg-[var(--accent)] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 font-mono text-xs font-bold animate-in slide-in-from-top-5 duration-200">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>{newJobToast}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex-1 flex flex-col">
        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-[var(--panel)] p-4 rounded-2xl border border-[var(--border)] shadow-xs">
            <span className="dc-eyebrow block">Total Jobs</span>
            <span className="dc-mono text-2xl font-black text-[var(--ink)]">{stats.total}</span>
          </div>

          <div className="bg-[var(--panel)] p-4 rounded-2xl border border-[var(--warn-line)] shadow-xs">
            <span className="dc-eyebrow text-[var(--warn)] block">Pending Print</span>
            <span className="dc-mono text-2xl font-black text-[var(--warn)]">{stats.pending}</span>
          </div>

          <div className="bg-[var(--panel)] p-4 rounded-2xl border border-[var(--ok-line)] shadow-xs">
            <span className="dc-eyebrow text-[var(--ok)] block">Completed</span>
            <span className="dc-mono text-2xl font-black text-[var(--ok)]">{stats.printed}</span>
          </div>

          <div className="bg-[var(--panel)] p-4 rounded-2xl border border-[var(--accent-line)] shadow-xs">
            <span className="dc-eyebrow text-[var(--accent)] block">Printed Revenue</span>
            <span className="dc-mono text-2xl font-black text-[var(--accent)]">{formatCurrency(stats.revenue)}</span>
          </div>
        </div>

        {/* Toolbar: Search, Filter Tabs, Sweeper */}
        <div className="bg-[var(--panel)] p-3 rounded-2xl border border-[var(--border)] mb-6 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          {/* Filter Tabs */}
          <div className="flex bg-[var(--sub)] p-1 rounded-xl border border-[var(--rule)] font-mono">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'all'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-[var(--ink3)] hover:text-[var(--ink)]'
              }`}
            >
              All ({jobs.length})
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'pending'
                  ? 'bg-[var(--warn)] text-white shadow-xs'
                  : 'text-[var(--ink3)] hover:text-[var(--ink)]'
              }`}
            >
              Pending ({stats.pending})
            </button>
            <button
              onClick={() => setActiveTab('printed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'printed'
                  ? 'bg-[var(--ok)] text-white shadow-xs'
                  : 'text-[var(--ink3)] hover:text-[var(--ink)]'
              }`}
            >
              Printed ({stats.printed})
            </button>
          </div>

          {/* Search Box & Retention Sweeper */}
          <div className="flex items-center gap-2 flex-1 sm:flex-initial max-w-sm">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--ink3)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, token #P-101..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            <button
              onClick={handleSweepExpired}
              title="Sweep documents older than 24h"
              className="px-2.5 py-1.5 rounded-xl border border-[var(--border)] text-[11px] font-mono font-bold text-[var(--ink3)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] hover:border-[var(--danger-line)] transition whitespace-nowrap flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Sweep &gt;24h
            </button>
          </div>
        </div>

        {/* Live Queue Cards Grid */}
        {filteredJobs.length === 0 ? (
          <div className="flex-1 bg-[var(--panel)] rounded-3xl border border-dashed border-[var(--border)] p-12 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-[var(--sub)] border border-[var(--border)] text-[var(--ink3)] flex items-center justify-center mb-4">
              <Printer className="w-8 h-8 text-[var(--accent)]" />
            </div>
            <h3 className="text-lg font-bold text-[var(--ink)] mb-1">
              {searchQuery ? 'No documents match your search' : 'Print queue is currently empty'}
            </h3>
            <p className="text-xs text-[var(--ink3)] max-w-sm mb-6">
              When walk-in customers scan your counter QR code and upload files, their print jobs will immediately appear here with sound chimes.
            </p>
            <button
              onClick={() => setShowQrModal(true)}
              className="py-2.5 px-5 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-bold text-xs shadow transition flex items-center gap-2"
            >
              <QrCode className="w-4 h-4" /> Open Counter QR Code
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isPrinting={quickPrintingId === job.id}
                onOpenPreview={(j) => setPreviewJob(j)}
                onQuickPrint={handleQuickPrint}
                onMarkPrinted={handleMarkPrinted}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* Full Preview & Print Modal */}
      {previewJob && (
        <PreviewPrintModal
          job={previewJob}
          printers={printers}
          pricing={pricing}
          printerProfiles={printerProfiles}
          onClose={() => setPreviewJob(null)}
          onJobUpdated={(updated) => {
            setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
            setPreviewJob(updated);
          }}
          onJobDeleted={(id) => {
            setJobs((prev) => prev.filter((j) => j.id !== id));
            setPreviewJob(null);
          }}
          onRefreshPrinters={() => {
            fetchPrinters().then(setPrinters);
          }}
        />
      )}

      {/* Counter QR Standee Modal */}
      {showQrModal && (
        <CounterQrModal
          tunnel={tunnel}
          shop={shop}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {/* Cloudflare Tunnel Modal */}
      {showTunnelModal && (
        <TunnelModal
          tunnel={tunnel}
          onClose={() => setShowTunnelModal(false)}
          onTunnelUpdated={(updated) => setTunnel(updated)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          pricing={pricing}
          shop={shop}
          printers={printers}
          printerProfiles={printerProfiles}
          discoveredPrinters={discoveredPrinters}
          onClose={() => setShowSettingsModal(false)}
          onPricingUpdated={(updated) => setPricing(updated)}
          onProfilesUpdated={(updatedProfiles) => setPrinterProfiles(updatedProfiles)}
        />
      )}

      {/* Auto-Detected Printers Modal */}
      {showDiscoveredModal && (
        <DiscoveredPrintersModal
          discoveredPrinters={discoveredPrinters}
          printerProfiles={printerProfiles}
          onClose={() => setShowDiscoveredModal(false)}
          onPrintersUpdated={(updated) => setDiscoveredPrinters(updated)}
          onProfilesUpdated={() => {
            fetchPrinterProfiles().then(setPrinterProfiles).catch(() => {});
          }}
        />
      )}
    </div>
  );
};
