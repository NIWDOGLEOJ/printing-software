import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Settings,
  Printer,
  Clock,
  Database,
  Check,
  RefreshCw,
  Layers,
  Sparkles,
  Wifi,
  Usb,
} from 'lucide-react';
import {
  PricingSettings,
  ShopDetails,
  PrinterInfo,
  PrinterProfile,
  EffectivePricing,
  DiscoveredPrinter,
} from '../types.js';
import { updateSettings, testPrint, fetchPrinterProfiles, updatePrinterProfile, resetPrinterProfiles } from '../api.js';
import { calculateEffectivePricing } from '../utils/costCalculator.js';
import { formatCurrency } from '../utils/formatters.js';

interface SettingsModalProps {
  pricing: PricingSettings;
  shop: ShopDetails | null;
  printers: PrinterInfo[];
  printerProfiles?: PrinterProfile[];
  discoveredPrinters?: DiscoveredPrinter[];
  onClose: () => void;
  onPricingUpdated: (updated: PricingSettings) => void;
  onProfilesUpdated?: (updatedProfiles: PrinterProfile[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  pricing,
  shop,
  printers,
  printerProfiles = [],
  discoveredPrinters = [],
  onClose,
  onPricingUpdated,
  onProfilesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'profiles' | 'general'>('profiles');
  const [form, setForm] = useState<PricingSettings>(pricing);
  const [profiles, setProfiles] = useState<PrinterProfile[]>(printerProfiles);

  const [isSaving, setIsSaving] = useState(false);
  const [isTestingPrint, setIsTestingPrint] = useState(false);
  const [testResultMsg, setTestResultMsg] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load profiles if not provided
  useEffect(() => {
    if (profiles.length === 0) {
      fetchPrinterProfiles()
        .then(setProfiles)
        .catch((e) => console.warn('Could not load printer profiles', e));
    }
  }, []);

  // Update profile field in local state
  const handleProfileChange = (id: string, updates: Partial<PrinterProfile>) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  };

  // Compute live effective pricing based on current edited state
  const liveEffective = useMemo<EffectivePricing>(() => {
    return calculateEffectivePricing(profiles, {
      globalDuplexEnabled: form.global_duplex_enabled !== false,
      fallbackPricing: form,
    });
  }, [profiles, form]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      // 1. Save all printer profiles
      const savedProfiles: PrinterProfile[] = [];
      for (const p of profiles) {
        const updated = await updatePrinterProfile(p.id, {
          name: p.name,
          cups_printer_name: p.cups_printer_name,
          supports_color: p.supports_color,
          supports_duplex: p.supports_duplex,
          duplex_enabled: p.duplex_enabled,
          is_active: p.is_active,
          bw_single_price: p.bw_single_price,
          bw_duplex_price: p.bw_duplex_price,
          color_single_price: p.color_single_price,
          color_duplex_price: p.color_duplex_price,
        });
        savedProfiles.push(updated);
      }

      if (onProfilesUpdated) {
        onProfilesUpdated(savedProfiles);
      }

      // 2. Save global settings
      const updatedSettings = await updateSettings(form);
      onPricingUpdated(updatedSettings);

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTestingPrint(true);
    setTestResultMsg(null);
    try {
      const targetPrinter =
        form.default_printer || printers[0]?.name || 'Virtual / Mock Printer (Simulated)';
      const res = await testPrint(targetPrinter);
      setTestResultMsg(res.message);
    } catch (err: any) {
      setTestResultMsg(`Test print failed: ${err.message}`);
    } finally {
      setIsTestingPrint(false);
    }
  };

  const handleResetProfiles = async () => {
    if (confirm('Reset printer profiles to standard hardware defaults (Canon IR4225 + Canon GX4070)?')) {
      try {
        const res = await resetPrinterProfiles();
        setProfiles(res.profiles);
        if (onProfilesUpdated) {
          onProfilesUpdated(res.profiles);
        }
      } catch (err: any) {
        alert(`Failed to reset profiles: ${err.message}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)] flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent)] text-white flex items-center justify-center shadow-xs">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Printer Profiles & Configuration</h3>
              <p className="font-mono text-xs text-[var(--ink3)]">Manage hardware profiles, availability, and customer rates</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-[var(--border)] bg-[var(--panel)] flex gap-4 shrink-0 font-mono">
          <button
            type="button"
            onClick={() => setActiveTab('profiles')}
            className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'profiles'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink)]'
            }`}
          >
            <Printer className="w-4 h-4" /> Printer Profiles ({profiles.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-2.5 text-xs font-bold border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'general'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink)]'
            }`}
          >
            <Settings className="w-4 h-4" /> General & Connectivity
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1">
          {activeTab === 'profiles' ? (
            <>
              {/* Live Effective Pricing Preview Banner */}
              <div className="bg-[var(--sub)] text-[var(--ink)] p-4 rounded-2xl shadow-sm border border-[var(--accent-line)]">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--rule)]">
                  <span className="dc-eyebrow text-[var(--accent)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Effective Customer Rates (Lowest Available)
                  </span>
                  <span className="font-mono text-[10px] bg-[var(--panel)] border border-[var(--border)] px-2 py-0.5 rounded-full font-bold text-[var(--ink2)]">
                    {liveEffective.active_printers_count} Active Printer{liveEffective.active_printers_count === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
                  <div className="bg-[var(--panel)] p-2.5 rounded-xl border border-[var(--border)]">
                    <span className="text-[var(--ink3)] text-[10px] block">B&W Single</span>
                    <span className="text-sm font-black text-[var(--ink)]">
                      {formatCurrency(liveEffective.bw_price_per_page)}/pg
                    </span>
                  </div>

                  <div className="bg-[var(--panel)] p-2.5 rounded-xl border border-[var(--border)]">
                    <span className="text-[var(--ink3)] text-[10px] block">B&W Duplex</span>
                    <span className="text-sm font-black text-[var(--ink)]">
                      {liveEffective.duplex_available
                        ? `${formatCurrency(liveEffective.duplex_sheet_price_bw)}/sht`
                        : <span className="text-[var(--ink4)] text-xs font-semibold">Unavailable</span>}
                    </span>
                  </div>

                  <div className="bg-[var(--panel)] p-2.5 rounded-xl border border-[var(--border)]">
                    <span className="text-[var(--ink3)] text-[10px] block">Color Single</span>
                    <span className="text-sm font-black text-[var(--ink)]">
                      {liveEffective.color_available
                        ? `${formatCurrency(liveEffective.color_price_per_page)}/pg`
                        : <span className="text-[var(--ink4)] text-xs font-semibold">Unavailable</span>}
                    </span>
                  </div>

                  <div className="bg-[var(--panel)] p-2.5 rounded-xl border border-[var(--border)]">
                    <span className="text-[var(--ink3)] text-[10px] block">Color Duplex</span>
                    <span className="text-sm font-black text-[var(--ink)]">
                      {liveEffective.color_available && liveEffective.duplex_available
                        ? `${formatCurrency(liveEffective.duplex_sheet_price_color)}/sht`
                        : <span className="text-[var(--ink4)] text-xs font-semibold">Unavailable</span>}
                    </span>
                  </div>
                </div>
              </div>

              {/* Global Front & Back (Duplex) Master Switch */}
              <div className="p-3.5 rounded-2xl bg-[var(--sub)] border border-[var(--accent-line)] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[var(--ink)]">Global Customer Front & Back (Duplex) Option</p>
                    <p className="text-[11px] text-[var(--ink3)]">
                      Enable or disable 2-sided duplex printing option on customer portal
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      global_duplex_enabled: !(form.global_duplex_enabled !== false),
                    })
                  }
                  className={`px-3 py-1.5 rounded-xl font-mono font-bold text-xs transition flex items-center gap-1.5 ${
                    form.global_duplex_enabled !== false
                      ? 'bg-[var(--accent)] text-white shadow-xs'
                      : 'bg-[var(--panel)] text-[var(--ink3)] border border-[var(--border)]'
                  }`}
                >
                  {form.global_duplex_enabled !== false ? 'Enabled (ON)' : 'Disabled (OFF)'}
                </button>
              </div>

              {/* Individual Printer Profiles Editor */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="dc-eyebrow text-[var(--ink3)] flex items-center gap-1.5">
                    <Printer className="w-3.5 h-3.5 text-[var(--accent)]" /> Configured Printer Hardware Profiles
                  </h4>
                  <button
                    type="button"
                    onClick={handleResetProfiles}
                    className="text-[11px] font-mono font-bold text-[var(--accent)] hover:underline bg-[var(--accent-soft)] border border-[var(--accent-line)] px-2.5 py-1 rounded-lg transition flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Reset Default Profiles
                  </button>
                </div>

                {profiles.map((prof) => (
                  <div
                    key={prof.id}
                    className={`rounded-2xl border transition p-4 sm:p-5 space-y-4 ${
                      prof.is_active
                        ? 'border-[var(--ok-line)] bg-[var(--sub)] shadow-xs'
                        : 'border-[var(--warn-line)] bg-[var(--sub)]/80'
                    }`}
                  >
                    {/* Top Row: Profile Name & Active Status Toggle */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--rule)]">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-black text-xs ${
                            prof.is_active
                              ? 'bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)]'
                              : 'bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)]'
                          }`}
                        >
                          <Printer className="w-4 h-4" />
                        </div>
                        <div>
                          <input
                            type="text"
                            value={prof.name}
                            onChange={(e) => handleProfileChange(prof.id, { name: e.target.value })}
                            className="font-bold text-sm text-[var(--ink)] bg-transparent border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] focus:outline-none"
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-mono text-[11px] text-[var(--ink3)]">
                              {prof.supports_color ? 'B&W + Color' : 'B&W Only'} •{' '}
                              {prof.supports_duplex ? 'Duplex Capable' : 'Single-sided Only'}
                            </p>
                            {(() => {
                              const dp = discoveredPrinters.find(
                                (d) =>
                                  d.matchedProfileId === prof.id ||
                                  (d.cupsPrinterName && d.cupsPrinterName === prof.cups_printer_name) ||
                                  d.name.toLowerCase().includes(prof.name.toLowerCase().replace('canon ', ''))
                              );
                              if (!dp) return null;
                              return (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)] flex items-center gap-1">
                                  {dp.connectionType === 'usb_direct' ? (
                                    <Usb className="w-2.5 h-2.5 text-[var(--warn)]" />
                                  ) : (
                                    <Wifi className="w-2.5 h-2.5 text-[var(--accent)]" />
                                  )}
                                  <span>
                                    {dp.connectionType === 'usb_direct'
                                      ? 'Connected via USB'
                                      : `Detected on LAN (${dp.ipAddress || dp.hostname})`}
                                  </span>
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Operational Status Pill */}
                      <button
                        type="button"
                        onClick={() => handleProfileChange(prof.id, { is_active: !prof.is_active })}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-black transition flex items-center gap-1.5 ${
                          prof.is_active
                            ? 'bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)] hover:opacity-90'
                            : 'bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)] hover:opacity-90'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            prof.is_active ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--warn)]'
                          }`}
                        />
                        {prof.is_active ? 'Active (Operational)' : 'In Maintenance'}
                      </button>
                    </div>

                    {/* Hardware Capabilities & Duplex Toggles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {/* Color Capability */}
                      <div className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-between">
                        <div>
                          <span className="font-bold text-[var(--ink)] block">Color Printing</span>
                          <span className="text-[11px] text-[var(--ink3)]">Supports color documents</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleProfileChange(prof.id, { supports_color: !prof.supports_color })}
                          className={`px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] transition ${
                            prof.supports_color
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)]'
                          }`}
                        >
                          {prof.supports_color ? 'Yes' : 'No'}
                        </button>
                      </div>

                      {/* Per-Printer Duplex Capability Toggle */}
                      <div className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] flex items-center justify-between">
                        <div>
                          <span className="font-bold text-[var(--ink)] block">Duplex (Front & Back)</span>
                          <span className="text-[11px] text-[var(--ink3)]">Hardware duplex enabled</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleProfileChange(prof.id, { duplex_enabled: !prof.duplex_enabled })}
                          className={`px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] transition ${
                            prof.duplex_enabled
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)]'
                          }`}
                        >
                          {prof.duplex_enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    </div>

                    {/* Rates Per Printer */}
                    <div>
                      <span className="dc-eyebrow text-[var(--ink3)] block mb-2">
                        Per-Printer Pricing Rates (₹ INR)
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                        <div>
                          <label className="block text-[11px] font-medium text-[var(--ink3)] mb-1">
                            B&W Single
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs font-bold text-[var(--ink4)]">₹</span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={prof.bw_single_price}
                              onChange={(e) =>
                                handleProfileChange(prof.id, {
                                  bw_single_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] font-bold text-xs focus:border-[var(--accent)] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[var(--ink3)] mb-1">
                            B&W Duplex
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs font-bold text-[var(--ink4)]">₹</span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              value={prof.bw_duplex_price}
                              onChange={(e) =>
                                handleProfileChange(prof.id, {
                                  bw_duplex_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] font-bold text-xs focus:border-[var(--accent)] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[var(--ink3)] mb-1">
                            Color Single
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs font-bold text-[var(--ink4)]">₹</span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              disabled={!prof.supports_color}
                              value={prof.color_single_price}
                              onChange={(e) =>
                                handleProfileChange(prof.id, {
                                  color_single_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] font-bold text-xs disabled:opacity-40 focus:border-[var(--accent)] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-[var(--ink3)] mb-1">
                            Color Duplex
                          </label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-2 text-xs font-bold text-[var(--ink4)]">₹</span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              disabled={!prof.supports_color}
                              value={prof.color_duplex_price}
                              onChange={(e) =>
                                handleProfileChange(prof.id, {
                                  color_duplex_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-6 pr-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] font-bold text-xs disabled:opacity-40 focus:border-[var(--accent)] focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Target CUPS Queue Mapping */}
                    <div>
                      <label className="dc-eyebrow text-[var(--ink3)] block mb-1">
                        Target CUPS Queue Destination
                      </label>
                      <select
                        value={prof.cups_printer_name}
                        onChange={(e) =>
                          handleProfileChange(prof.id, { cups_printer_name: e.target.value })
                        }
                        className="w-full py-1.5 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                      >
                        <option value="">Manual / Assigned: {prof.cups_printer_name || 'None'}</option>
                        {discoveredPrinters.length > 0 && (
                          <optgroup label="Auto-Detected Network & USB Hardware">
                            {discoveredPrinters.map((dp) => (
                              <option
                                key={dp.id}
                                value={dp.cupsPrinterName || dp.name.replace(/\s+/g, '_')}
                              >
                                {dp.name} (
                                {dp.connectionType === 'usb_direct'
                                  ? 'USB Cable'
                                  : dp.ipAddress
                                  ? `LAN: ${dp.ipAddress}`
                                  : 'Network'}
                                )
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Installed CUPS Queues">
                          {printers.map((pr) => (
                            <option key={pr.name} value={pr.name}>
                              {pr.name} {pr.isDefault ? '(System Default)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <p className="font-mono text-[10px] text-[var(--ink4)] mt-1">
                        Matches CUPS queue name when sending print jobs. Current mapping: <code className="bg-[var(--panel)] px-1 py-0.5 rounded border border-[var(--border)]">{prof.cups_printer_name || 'unassigned'}</code>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* General Settings Tab */
            <>
              {/* Shop details integration status badge */}
              <div className="p-3.5 bg-[var(--sub)] rounded-2xl border border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Database className="w-4 h-4 text-[var(--accent)]" />
                  <div>
                    <p className="text-xs font-bold text-[var(--ink)]">{shop?.shopName || 'J MART'}</p>
                    <p className="text-[11px] text-[var(--ink3)]">{shop?.shopAddress}</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    shop?.source === 'pos_db'
                      ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)]'
                      : 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]'
                  }`}
                >
                  {shop?.source === 'pos_db' ? 'Read-only POS DB' : 'Fallback Defaults'}
                </span>
              </div>

              {/* Retention & Printer settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[var(--rule)] pt-3">
                <div>
                  <label className="dc-eyebrow text-[var(--ink3)] mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[var(--accent)]" /> Retention Schedule
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="168"
                      value={form.retention_hours}
                      onChange={(e) =>
                        setForm({ ...form, retention_hours: parseInt(e.target.value, 10) || 24 })
                      }
                      className="w-24 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-[var(--ink)] font-mono font-bold text-sm focus:border-[var(--accent)] focus:outline-none"
                    />
                    <span className="text-xs text-[var(--ink3)] font-mono">Hours (auto clean)</span>
                  </div>
                </div>

                <div>
                  <label className="dc-eyebrow text-[var(--ink3)] mb-1.5 flex items-center gap-1.5">
                    <Printer className="w-3.5 h-3.5 text-[var(--accent)]" /> Default Printer Destination
                  </label>
                  <select
                    value={form.default_printer}
                    onChange={(e) => setForm({ ...form, default_printer: e.target.value })}
                    className="w-full py-2 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    <option value="">System Default</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Test Print Box */}
              <div className="p-3.5 rounded-2xl bg-[var(--sub)] border border-[var(--border)] flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-[var(--ink)]">Test Printer Connectivity</p>
                  <p className="text-[11px] text-[var(--ink3)]">Dispatch a test alignment page to CUPS</p>
                </div>
                <button
                  type="button"
                  disabled={isTestingPrint}
                  onClick={handleTestPrint}
                  className="px-3 py-1.5 rounded-xl font-bold text-xs bg-[var(--accent)] text-white shadow-sm transition flex items-center gap-1.5 disabled:opacity-50 hover:opacity-90"
                >
                  {isTestingPrint ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Printer className="w-3.5 h-3.5" />
                  )}
                  Send Test Page
                </button>
              </div>

              {testResultMsg && (
                <p className="text-xs text-[var(--ink2)] bg-[var(--sub)] p-2.5 rounded-xl font-mono border border-[var(--border)]">
                  {testResultMsg}
                </p>
              )}
            </>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-[var(--rule)] flex items-center justify-between shrink-0">
            {saveSuccess && (
              <span className="text-xs font-mono font-bold text-[var(--ok)] flex items-center gap-1">
                <Check className="w-4 h-4" /> All Profiles & Settings Saved!
              </span>
            )}
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="py-2 px-4 rounded-xl border border-[var(--border)] font-mono font-bold text-xs text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--sub)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="py-2 px-5 rounded-xl font-mono font-bold text-xs bg-[var(--accent)] text-white hover:opacity-90 shadow"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
