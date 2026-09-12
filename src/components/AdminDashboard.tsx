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
  Eye,
  CheckCircle2,
  Clock,
  FileText,
  LogOut,
  UserCheck,
} from 'lucide-react';
import {
  PrintJob,
  JobFile,
  PrinterInfo,
  PrinterProfile,
  PricingSettings,
  ShopDetails,
  TunnelStatus,
  DiscoveredPrinter,
  AuthUser,
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
  printJobFile,
  cleanupExpiredJobs,
  connectLiveWebSocket,
} from '../api.js';
import { FileReviewModal } from './FileReviewModal.js';
import { CounterQrModal } from './CounterQrModal.js';
import { TunnelModal } from './TunnelModal.js';
import { SettingsModal } from './SettingsModal.js';
import { DiscoveredPrintersModal } from './DiscoveredPrintersModal.js';
import { chime } from './audioChime.js';
import { DEFAULT_PRICING, findOptimalPrinter } from '../utils/costCalculator.js';
import { formatCurrency, formatFileSize, formatRelativeTime } from '../utils/formatters.js';
import { useTheme } from '../theme.js';

interface AdminDashboardProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
  onSwitchToCustomerView?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onLogout,
  onSwitchToCustomerView,
}) => {
  const [theme, toggleTheme] = useTheme();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>([]);
  const [pricing, setPricing] = useState<PricingSettings>(DEFAULT_PRICING);
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);

  // Selected Order for WhatsApp-style Right Pane
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Connection & audio states
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isChimeMuted, setIsChimeMuted] = useState(() => chime.getMuted());
  const [newJobToast, setNewJobToast] = useState<string | null>(null);

  // Filters & search
  const [activeTab, setActiveTab] = useState<'pending' | 'printed' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [printingFileId, setPrintingFileId] = useState<string | null>(null);

  // Modals
  const [reviewModalState, setReviewModalState] = useState<{ job: PrintJob; file: JobFile } | null>(null);
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

      // Auto-select first job if none selected
      if (!selectedJobId && loadedJobs.length > 0) {
        setSelectedJobId(loadedJobs[0].id);
      }
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
        if (message.type === 'NEW_JOB' || message.type === 'JOB_CREATED') {
          chime.play();
          setJobs((prev) => [message.job, ...prev.filter((j) => j.id !== message.job.id)]);
          setNewJobToast(`New print order from ${message.job.customer_name} (${message.job.token})`);
          setTimeout(() => setNewJobToast(null), 5000);
          // Auto-select newly arrived job
          setSelectedJobId(message.job.id);
        } else if (message.type === 'JOB_UPDATED') {
          setJobs((prev) =>
            prev.map((j) => (j.id === message.job.id ? message.job : j))
          );
          if (reviewModalState && reviewModalState.job.id === message.job.id) {
            const updatedFile = message.job.files?.find((f: JobFile) => f.id === reviewModalState.file.id) || reviewModalState.file;
            setReviewModalState({ job: message.job, file: updatedFile });
          }
        } else if (message.type === 'JOB_DELETED') {
          setJobs((prev) => prev.filter((j) => j.id !== message.id));
          if (selectedJobId === message.id) {
            setSelectedJobId(null);
          }
          if (reviewModalState && reviewModalState.job.id === message.id) {
            setReviewModalState(null);
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
  }, [selectedJobId, reviewModalState]);

  // Selected active job object
  const selectedJob = useMemo(() => {
    return jobs.find((j) => j.id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  // Optimal target printer for selected job
  const optimalPrinter = useMemo(() => {
    if (!selectedJob) return '';
    return findOptimalPrinter({
      colorMode: selectedJob.color_mode,
      sides: selectedJob.sides,
      profiles: printerProfiles,
      printers,
    });
  }, [selectedJob, printerProfiles, printers]);

  // 1-Click Toggle for Printer Status (Active / Maintenance)
  const handleTogglePrinterActive = async (profileId: string) => {
    const prof = printerProfiles.find((p) => p.id === profileId);
    if (!prof) return;
    const nextStatus = !prof.is_active;

    setPrinterProfiles((prev) =>
      prev.map((p) => (p.id === profileId ? { ...p, is_active: nextStatus } : p))
    );

    try {
      const updated = await updatePrinterProfile(profileId, { is_active: nextStatus });
      setPrinterProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
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

  // 1-Click "Print All Documents" in selected order
  const handlePrintAll = async (targetPrinterName?: string) => {
    if (!selectedJob) return;
    setIsPrintingAll(true);
    try {
      const printerToUse =
        targetPrinterName ||
        selectedJob.printer_name ||
        optimalPrinter ||
        printers.find((p) => p.isDefault)?.name ||
        printers[0]?.name;

      const res = await printJob(selectedJob.id, {
        printerName: printerToUse,
      });

      if (res.job) {
        setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      }
    } catch (err: any) {
      alert(`Print error: ${err.message}`);
    } finally {
      setIsPrintingAll(false);
    }
  };

  // 1-Click Print Single Document File
  const handlePrintSingleFile = async (file: JobFile) => {
    if (!selectedJob) return;
    setPrintingFileId(file.id);
    try {
      const printerToUse =
        selectedJob.printer_name ||
        optimalPrinter ||
        printers.find((p) => p.isDefault)?.name ||
        printers[0]?.name;

      const res = await printJobFile(file.id, {
        printerName: printerToUse,
        copies: file.copies,
        colorMode: file.color_mode,
        sides: file.sides,
        orientation: file.orientation,
        pageRange: file.page_range,
      });

      if (res.job) {
        setJobs((prev) => prev.map((j) => (j.id === res.job.id ? res.job : j)));
      }
    } catch (err: any) {
      alert(`Failed to print file: ${err.message}`);
    } finally {
      setPrintingFileId(null);
    }
  };

  // Mark job printed / pending toggle
  const handleToggleJobStatus = async (job: PrintJob) => {
    const nextStatus = job.status === 'printed' ? 'pending' : 'printed';
    try {
      const updated = await updateJob(job.id, { status: nextStatus });
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Delete job
  const handleDeleteJob = async (job: PrintJob) => {
    if (!confirm(`Delete order for ${job.customer_name} (${job.token}) and all documents?`)) return;
    try {
      await deleteJob(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (selectedJobId === job.id) {
        setSelectedJobId(null);
      }
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

  // Statistics
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
    <div className="h-screen flex flex-col font-sans text-[var(--ink)] overflow-hidden bg-[var(--sub)]">
      {/* Top Navigation Bar */}
      <header className="bg-[var(--panel)] border-b border-[var(--border)] z-30 shrink-0 shadow-xs">
        <div className="max-w-full px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Shop Identification */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white overflow-hidden shadow-sm shrink-0">
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
                <h1 className="text-base font-bold text-[var(--ink)] leading-tight">
                  {shop?.shopName || 'J MART'}
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] uppercase tracking-wider">
                  Print Station
                </span>
              </div>
              <p className="text-[11px] text-[var(--ink3)] flex items-center gap-1.5 font-mono">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isWsConnected ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--danger)]'
                  }`}
                />
                <span>{isWsConnected ? 'Live Real-time' : 'Reconnecting...'}</span>
                <span>•</span>
                <span className="truncate max-w-xs">{shop?.shopAddress || 'Ramapuram, Chennai'}</span>
              </p>
            </div>
          </div>

          {/* Quick Action Tools */}
          <div className="flex items-center flex-wrap gap-2">
            {/* Operator Badge & Logout */}
            {currentUser && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono">
                <UserCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
                <span className="font-bold text-[var(--ink)]">{currentUser.name || currentUser.username}</span>
                <span className="text-[10px] uppercase font-bold text-[var(--ink3)] bg-[var(--panel)] px-1.5 py-0.5 rounded border border-[var(--rule)]">
                  {currentUser.role}
                </span>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Sign Out"
                    className="ml-1 text-[var(--ink3)] hover:text-[var(--danger)] transition cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Theme Toggle */}
            <button
              onClick={() => toggleTheme()}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Audio Chime Toggle */}
            <button
              onClick={handleToggleMute}
              title={isChimeMuted ? 'Unmute Audio Chime' : 'Mute Audio Chime'}
              className={`p-2 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition cursor-pointer ${
                isChimeMuted
                  ? 'bg-[var(--sub)] text-[var(--ink4)] border-[var(--border)] hover:bg-[var(--rule)]'
                  : 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)] hover:opacity-90'
              }`}
            >
              {isChimeMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span className="hidden lg:inline">{isChimeMuted ? 'Muted' : 'Chime On'}</span>
            </button>

            {/* Counter QR */}
            <button
              onClick={() => setShowQrModal(true)}
              className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
            >
              <QrCode className="w-4 h-4 text-[var(--accent)]" />
              <span>Counter QR</span>
            </button>

            {/* Cloudflare Tunnel Status */}
            <button
              onClick={() => setShowTunnelModal(true)}
              className={`py-1.5 px-3 rounded-xl border text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs cursor-pointer ${
                tunnel?.tunnelUrl
                  ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent)]'
                  : 'bg-[var(--sub)] border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--panel)]'
              }`}
            >
              <Globe className="w-4 h-4 text-[var(--accent)]" />
              <span className="hidden sm:inline">Tunnel</span>
              <span className={`w-1.5 h-1.5 rounded-full ${tunnel?.tunnelUrl ? 'bg-[var(--accent)]' : 'bg-[var(--ink4)]'}`} />
            </button>

            {/* Auto-Detected Hardware Printers */}
            <button
              onClick={() => setShowDiscoveredModal(true)}
              title="Auto-Detected Network & USB Printers"
              className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
            >
              <Wifi className="w-4 h-4 text-[var(--accent)]" />
              <span className="hidden sm:inline">Printers</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
            </button>

            {/* Pricing / Rates Settings */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
            >
              <Settings className="w-4 h-4 text-[var(--ink3)]" />
              <span className="hidden sm:inline">Rates</span>
            </button>

            {/* Refresh */}
            <button
              onClick={loadAllData}
              disabled={isRefreshing}
              title="Refresh Queue"
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[var(--accent)]' : ''}`} />
            </button>

            {/* Customer Portal Link */}
            {onSwitchToCustomerView && (
              <button
                onClick={onSwitchToCustomerView}
                className="py-1.5 px-3 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-xs font-bold flex items-center gap-1.5 transition shadow cursor-pointer"
              >
                <span>Customer View</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Hardware & Duplex Bar */}
        <div className="bg-[var(--sub)] border-t border-[var(--border)] px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[var(--ink3)] flex items-center gap-1">
              <Printer className="w-3 h-3 text-[var(--accent)]" />
              Printers:
            </span>
            {printerProfiles.map((prof) => (
              <button
                key={prof.id}
                onClick={() => handleTogglePrinterActive(prof.id)}
                className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1.5 transition border cursor-pointer ${
                  prof.is_active
                    ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)]'
                    : 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${prof.is_active ? 'bg-[var(--ok)]' : 'bg-[var(--warn)]'}`} />
                <span>{prof.name.replace('Canon ', '')}:</span>
                <span className="uppercase text-[9px] font-black">{prof.is_active ? 'Active' : 'Maintenance'}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleGlobalDuplex}
              className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1.5 transition border cursor-pointer ${
                pricing.global_duplex_enabled !== false
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]'
                  : 'bg-[var(--panel)] text-[var(--ink4)] border-[var(--border)]'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Front & Back:</span>
              <span className="uppercase text-[9px] font-black">
                {pricing.global_duplex_enabled !== false ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              onClick={handleSweepExpired}
              title="Sweep documents older than 24 hours"
              className="text-[10px] font-mono font-bold text-[var(--ink3)] hover:text-[var(--danger)] flex items-center gap-1 cursor-pointer transition px-2 py-1"
            >
              <Trash2 className="w-3 h-3" /> Sweep &gt;24h
            </button>
          </div>
        </div>
      </header>

      {/* New Job Arrival Toast Notification */}
      {newJobToast && (
        <div className="fixed top-24 right-5 z-50 bg-[var(--accent)] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 font-mono text-xs font-bold animate-in slide-in-from-top-5 duration-200">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
          <span>{newJobToast}</span>
        </div>
      )}

      {/* WHATSAPP-ON-DESKTOP SPLIT VIEW CONTAINER */}
      <div className="flex-1 flex overflow-hidden">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: Pending / Completed Queue List (WhatsApp Chat List Style)     */}
        {/* ========================================================================= */}
        <aside className="w-full sm:w-88 md:w-96 lg:w-[380px] bg-[var(--panel)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-hidden">
          {/* Search Box & Tabs */}
          <div className="p-3 border-b border-[var(--border)] bg-[var(--panel)] space-y-2 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--ink3)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, token #P-101..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2 text-xs font-bold text-[var(--ink3)] hover:text-[var(--ink)]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex bg-[var(--sub)] p-1 rounded-xl border border-[var(--rule)] font-mono text-xs">
              <button
                onClick={() => setActiveTab('pending')}
                className={`flex-1 py-1.5 rounded-lg font-bold transition text-center cursor-pointer ${
                  activeTab === 'pending'
                    ? 'bg-[var(--warn)] text-white shadow-xs'
                    : 'text-[var(--ink3)] hover:text-[var(--ink)]'
                }`}
              >
                Pending ({stats.pending})
              </button>
              <button
                onClick={() => setActiveTab('printed')}
                className={`flex-1 py-1.5 rounded-lg font-bold transition text-center cursor-pointer ${
                  activeTab === 'printed'
                    ? 'bg-[var(--ok)] text-white shadow-xs'
                    : 'text-[var(--ink3)] hover:text-[var(--ink)]'
                }`}
              >
                Printed ({stats.printed})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`flex-1 py-1.5 rounded-lg font-bold transition text-center cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'text-[var(--ink3)] hover:text-[var(--ink)]'
                }`}
              >
                All ({jobs.length})
              </button>
            </div>
          </div>

          {/* Scrollable Order Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--rule)]">
            {filteredJobs.length === 0 ? (
              <div className="p-8 text-center text-[var(--ink3)]">
                <Printer className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-semibold">
                  {searchQuery ? 'No matching print orders' : 'No orders in this queue'}
                </p>
                <p className="text-[11px] mt-1 opacity-70">
                  New uploads from walk-in customers will arrive here automatically.
                </p>
              </div>
            ) : (
              filteredJobs.map((job) => {
                const isSelected = selectedJobId === job.id;
                const fileCount = job.total_files || (job.files && job.files.length > 0 ? job.files.length : 1);
                const pageCount = job.total_pages || job.page_count;

                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`p-3.5 cursor-pointer transition flex items-start justify-between gap-3 border-l-4 ${
                      isSelected
                        ? 'bg-[var(--accent-soft)] border-l-[var(--accent)] shadow-2xs'
                        : 'border-l-transparent hover:bg-[var(--sub)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {/* Customer Name & Token */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-xs text-[var(--ink)] truncate">
                          {job.customer_name}
                        </span>
                        <span className="font-mono text-[10px] font-bold text-[var(--accent)] bg-[var(--panel)] px-1.5 py-0.5 rounded border border-[var(--border)] shrink-0">
                          {job.token}
                        </span>
                      </div>

                      {/* File count and pages summary */}
                      <p className="text-[11px] text-[var(--ink3)] truncate mb-1.5 flex items-center gap-1.5 font-medium">
                        <FileText className="w-3 h-3 shrink-0 text-[var(--ink4)]" />
                        <span>
                          {fileCount} {fileCount === 1 ? 'document' : 'documents'}
                        </span>
                        <span>•</span>
                        <span>{pageCount} pages</span>
                      </p>

                      {/* Status and Cost */}
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold text-[10px] uppercase tracking-wide ${
                            job.status === 'printed'
                              ? 'bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)]'
                              : 'bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)]'
                          }`}
                        >
                          {job.status === 'printed' ? '✓ Printed' : 'Pending'}
                        </span>

                        <span className="font-bold text-[var(--ink)]">
                          {formatCurrency(job.estimated_cost)}
                        </span>
                      </div>
                    </div>

                    {/* Relative timestamp */}
                    <span className="text-[10px] font-mono text-[var(--ink4)] shrink-0 mt-0.5">
                      {formatRelativeTime(job.created_at)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ========================================================================= */}
        {/* RIGHT PANE: Selected Order Details, 1-Click Print All, & Documents Grid   */}
        {/* ========================================================================= */}
        <main className="flex-1 bg-[var(--sub)] flex flex-col overflow-hidden">
          {!selectedJob ? (
            /* Empty State when no job is selected */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--ink3)]">
              <div className="w-20 h-20 rounded-3xl bg-[var(--panel)] border border-[var(--border)] flex items-center justify-center mb-4 shadow-sm">
                <Printer className="w-10 h-10 text-[var(--accent)] opacity-80" />
              </div>
              <h3 className="text-base font-bold text-[var(--ink)] mb-1">Select an order to review</h3>
              <p className="text-xs text-[var(--ink3)] max-w-sm">
                Choose any customer print job from the left queue column to review documents, adjust settings, and dispatch printing.
              </p>
            </div>
          ) : (
            /* Active Order Pane */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Selected Order Top Header Bar */}
              <div className="bg-[var(--panel)] border-b border-[var(--border)] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-xs">
                {/* Order Identity & Customer Info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent-line)] text-[var(--accent)] flex items-center justify-center font-mono font-black text-sm shrink-0">
                    {selectedJob.token}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-black text-[var(--ink)] truncate">
                        {selectedJob.customer_name}
                      </h2>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider font-black px-2 py-0.5 rounded-full border ${
                          selectedJob.status === 'printed'
                            ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)]'
                            : 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]'
                        }`}
                      >
                        {selectedJob.status === 'printed' ? '✓ Printed' : '● Pending'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ink3)] font-mono mt-0.5">
                      Submitted {formatRelativeTime(selectedJob.created_at)} • Total:{' '}
                      <span className="font-bold text-[var(--ink)]">{formatCurrency(selectedJob.estimated_cost)}</span>
                      {selectedJob.printer_name && (
                        <span> • Printed on: {selectedJob.printer_name}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Top Action Buttons for this Order */}
                <div className="flex items-center flex-wrap gap-2">
                  {/* 1-Click "Print All Documents" */}
                  <button
                    onClick={() => handlePrintAll()}
                    disabled={isPrintingAll}
                    className="py-2.5 px-4 rounded-xl text-xs font-bold font-mono text-white bg-[var(--ok)] hover:opacity-90 active:scale-98 shadow-md shadow-[var(--ok)]/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Printer className="w-4 h-4" />
                    <span>
                      {isPrintingAll
                        ? 'Printing all...'
                        : `Print All (${selectedJob.files?.length || selectedJob.total_files || 1})`}
                    </span>
                  </button>

                  {/* Mark as Printed / Pending toggle */}
                  <button
                    onClick={() => handleToggleJobStatus(selectedJob)}
                    className="py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--sub)] text-[var(--ink)] text-xs font-bold font-mono flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[var(--ok)]" />
                    <span>{selectedJob.status === 'printed' ? 'Mark Pending' : 'Mark Printed'}</span>
                  </button>

                  {/* Delete Order */}
                  <button
                    onClick={() => handleDeleteJob(selectedJob)}
                    title="Delete entire order"
                    className="p-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--danger-soft)] text-[var(--ink3)] hover:text-[var(--danger)] hover:border-[var(--danger-line)] transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Documents Area (Requirement 4 & 5: Multiple file cards, click opens review popup) */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-[var(--ink3)]">
                      Order Documents ({selectedJob.files?.length || 1} files • {selectedJob.total_pages || selectedJob.page_count} pages)
                    </h3>
                    <p className="text-xs text-[var(--ink4)] mt-0.5">
                      Click any file card below to open high-resolution document preview and adjust print options.
                    </p>
                  </div>

                  {optimalPrinter && (
                    <span className="text-[11px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 rounded-lg border border-[var(--accent-line)]">
                      Auto-Target: {optimalPrinter}
                    </span>
                  )}
                </div>

                {/* Files Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {(selectedJob.files && selectedJob.files.length > 0
                    ? selectedJob.files
                    : [
                        {
                          id: `file_${selectedJob.id}_0`,
                          job_id: selectedJob.id,
                          original_filename: selectedJob.original_filename,
                          stored_filename: selectedJob.stored_filename,
                          file_path: selectedJob.file_path,
                          file_size: selectedJob.file_size,
                          mime_type: selectedJob.mime_type,
                          page_count: selectedJob.page_count,
                          color_mode: selectedJob.color_mode,
                          sides: selectedJob.sides,
                          orientation: selectedJob.orientation,
                          copies: selectedJob.copies,
                          page_range: selectedJob.page_range,
                          effective_pages: selectedJob.effective_pages,
                          estimated_cost: selectedJob.estimated_cost,
                          file_index: 0,
                          status: selectedJob.status,
                          cups_job_id: selectedJob.cups_job_id,
                          printed_at: selectedJob.printed_at,
                        } as JobFile,
                      ]
                  ).map((file) => {
                    const isPdf = file.mime_type.includes('pdf') || file.original_filename.toLowerCase().endsWith('.pdf');
                    const isImage = file.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(file.original_filename);

                    return (
                      <div
                        key={file.id}
                        className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-4 shadow-2xs hover:shadow-md hover:border-[var(--accent)] transition flex flex-col justify-between group cursor-pointer"
                        onClick={() => setReviewModalState({ job: selectedJob, file })}
                      >
                        <div>
                          {/* File Header */}
                          <div className="flex items-start gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-[var(--sub)] border border-[var(--rule)] flex items-center justify-center text-lg shrink-0 group-hover:scale-105 transition">
                              {isPdf ? '📄' : isImage ? '🖼️' : '📁'}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <h4
                                  className="text-xs font-bold text-[var(--ink)] truncate"
                                  title={file.original_filename}
                                >
                                  {file.original_filename}
                                </h4>
                                <span className="text-[10px] font-mono text-[var(--ink4)] shrink-0">
                                  #{file.file_index + 1}
                                </span>
                              </div>
                              <p className="text-[11px] font-mono text-[var(--ink3)] mt-0.5">
                                {formatFileSize(file.file_size)} • {file.page_count} page{file.page_count > 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>

                          {/* Print Option Pills */}
                          <div className="flex flex-wrap gap-1.5 mb-3 text-[10px] font-mono">
                            <span
                              className={`px-2 py-0.5 rounded border font-bold uppercase ${
                                file.color_mode === 'color'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {file.color_mode === 'color' ? 'Color' : 'B/W'}
                            </span>

                            <span className="px-2 py-0.5 rounded border border-[var(--rule)] bg-[var(--sub)] text-[var(--ink2)] font-bold">
                              {file.sides === 'duplex' ? 'Front & Back' : 'Single Sided'}
                            </span>

                            {file.copies > 1 && (
                              <span className="px-2 py-0.5 rounded border border-[var(--rule)] bg-[var(--sub)] text-[var(--ink2)] font-bold">
                                {file.copies} copies
                              </span>
                            )}

                            {file.page_range && file.page_range !== 'all' && (
                              <span className="px-2 py-0.5 rounded border border-[var(--rule)] bg-[var(--sub)] text-[var(--ink2)] font-bold">
                                p.{file.page_range}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* File Card Bottom: Price, Status & Actions */}
                        <div className="pt-3 border-t border-[var(--rule)] flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-mono text-[var(--ink4)] block">Cost</span>
                            <span className="text-xs font-black font-mono text-[var(--ink)]">
                              {formatCurrency(file.estimated_cost)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {/* Review Button */}
                            <button
                              type="button"
                              onClick={() => setReviewModalState({ job: selectedJob, file })}
                              title="Click to review document preview and edit options"
                              className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--sub)] text-[var(--ink2)] hover:text-[var(--accent)] text-xs font-mono font-bold flex items-center gap-1 transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Review</span>
                            </button>

                            {/* 1-Click Print this file */}
                            <button
                              type="button"
                              disabled={printingFileId === file.id}
                              onClick={() => handlePrintSingleFile(file)}
                              title="Print this individual document"
                              className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold text-white bg-[var(--accent)] hover:opacity-90 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{printingFileId === file.id ? 'Printing...' : 'Print'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* POPUP FILE REVIEW MODAL (Requirement 5) */}
      {reviewModalState && (
        <FileReviewModal
          job={reviewModalState.job}
          file={reviewModalState.file}
          printers={printers}
          pricing={pricing}
          onClose={() => setReviewModalState(null)}
          onFileUpdated={(updatedJob) => {
            setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
            const updatedFile = updatedJob.files?.find((f) => f.id === reviewModalState.file.id) || reviewModalState.file;
            setReviewModalState({ job: updatedJob, file: updatedFile });
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

      {/* Auto-Detected Hardware Printers Modal */}
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
