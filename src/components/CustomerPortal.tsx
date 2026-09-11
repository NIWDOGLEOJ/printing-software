import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Printer,
  Layers,
  Sparkles,
  MapPin,
  RefreshCw,
  Plus,
  Minus,
  Sun,
  Moon,
} from 'lucide-react';
import {
  ShopDetails,
  PricingSettings,
  ColorMode,
  SidesMode,
  OrientationMode,
  PrintJob,
} from '../types.js';
import { PDFDocument } from 'pdf-lib';
import { fetchShopDetails, fetchSettings, fetchEffectivePricing, uploadJob, connectLiveWebSocket } from '../api.js';
import { calculatePrintCost, DEFAULT_PRICING } from '../utils/costCalculator.js';
import { formatCurrency, formatFileSize } from '../utils/formatters.js';
import { useTheme } from '../theme.js';

export const CustomerPortal: React.FC = () => {
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [pricing, setPricing] = useState<PricingSettings>(DEFAULT_PRICING);
  const [theme, toggleTheme] = useTheme();

  // Form states
  const [customerName, setCustomerName] = useState(() => {
    return localStorage.getItem('jmart_customer_name') || '';
  });
  const [file, setFile] = useState<File | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [sides, setSides] = useState<SidesMode>('single');
  const [orientation, setOrientation] = useState<OrientationMode>('auto');
  const [copies, setCopies] = useState<number>(1);
  const [pageRangeMode, setPageRangeMode] = useState<'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');
  const [detectedPages, setDetectedPages] = useState<number>(1);

  // Status & submission states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedJob, setSubmittedJob] = useState<PrintJob | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load shop & pricing settings
  const loadEffectivePricing = () => {
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
      .catch(() => {
        fetchSettings()
          .then(setPricing)
          .catch((e) => console.warn('Could not load pricing', e));
      });
  };

  useEffect(() => {
    fetchShopDetails()
      .then(setShop)
      .catch((e) => console.warn('Could not load shop details', e));

    loadEffectivePricing();
  }, []);

  // Listen for real-time status updates on submitted job and live pricing/toggle updates
  useEffect(() => {
    const cleanup = connectLiveWebSocket((msg) => {
      if (
        msg.type === 'SETTINGS_UPDATED' ||
        msg.type === 'PRINTER_PROFILES_UPDATED' ||
        msg.type === 'PRICING_UPDATED'
      ) {
        loadEffectivePricing();
      }
      if (submittedJob && msg.type === 'JOB_UPDATED' && msg.job?.id === submittedJob.id) {
        setSubmittedJob(msg.job);
      }
    });

    return cleanup;
  }, [submittedJob?.id]);

  // Auto-fallback if an active option becomes unavailable
  useEffect(() => {
    if (pricing.color_available === false && colorMode === 'color') {
      setColorMode('bw');
    }
  }, [pricing.color_available, colorMode]);

  useEffect(() => {
    if (pricing.duplex_available === false && sides === 'duplex') {
      setSides('single');
    }
  }, [pricing.duplex_available, sides]);

  // When file changes, detect page count
  const handleFileChange = async (selectedFile: File) => {
    setErrorMessage(null);
    setFile(selectedFile);

    if (selectedFile.type.startsWith('image/')) {
      setDetectedPages(1);
    } else if (
      selectedFile.type === 'application/pdf' ||
      selectedFile.name.toLowerCase().endsWith('.pdf')
    ) {
      try {
        const buffer = await selectedFile.arrayBuffer();
        try {
          const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
          const count = pdfDoc.getPageCount();
          setDetectedPages(count && count > 0 ? count : 1);
        } catch {
          const text = new TextDecoder('latin1').decode(buffer);
          const pageMatches = text.match(/\/Type\s*\/Page\b/g);
          if (pageMatches && pageMatches.length > 0) {
            setDetectedPages(pageMatches.length);
          } else {
            setDetectedPages(1);
          }
        }
      } catch (err) {
        console.warn('Could not inspect PDF page count in browser:', err);
        setDetectedPages(1);
      }
    } else {
      setDetectedPages(1);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Live calculated cost
  const activePageRange = pageRangeMode === 'all' ? 'all' : customRange;
  const costEstimate = calculatePrintCost({
    totalPages: detectedPages,
    pageRange: activePageRange,
    colorMode,
    sides,
    copies,
    pricing,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMessage('Please select a PDF or image document to print.');
      return;
    }

    const trimmedName = customerName.trim() || 'Walk-in Customer';
    localStorage.setItem('jmart_customer_name', trimmedName);

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('customerName', trimmedName);
      formData.append('colorMode', colorMode);
      formData.append('sides', sides);
      formData.append('orientation', orientation);
      formData.append('copies', String(copies));
      formData.append('pageRange', activePageRange);
      formData.append('pageCount', String(detectedPages));

      const res = await uploadJob(formData);
      setSubmittedJob(res.job);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit document. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedJob(null);
    setFile(null);
    setPageRangeMode('all');
    setCustomRange('');
    setCopies(1);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen py-4 px-3 sm:py-8 sm:px-6 flex flex-col justify-between font-sans text-[var(--ink)]">
      <div className="max-w-xl mx-auto w-full">
        {/* Shop Header Banner */}
        <header className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)] mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white overflow-hidden shadow-sm shrink-0">
              <img
                src="/api/shop/logo"
                alt="Shop Logo"
                className="w-full h-full object-contain p-1"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <Printer className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[var(--ink)] tracking-tight leading-tight">
                {shop?.shopName || 'J MART'}
              </h1>
              <p className="text-xs text-[var(--ink3)] flex items-center gap-1 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                <span className="truncate max-w-[200px] sm:max-w-xs">{shop?.shopAddress || 'Ramapuram, Chennai'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleTheme()}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]">
              <Sparkles className="w-3 h-3" /> Quick Print Station
            </span>
          </div>
        </header>

        {submittedJob ? (
          /* ================= SUCCESS / TOKEN SCREEN ================= */
          <div className="bg-[var(--panel)] rounded-3xl p-6 sm:p-8 shadow-md border border-[var(--border)] text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)] rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-[var(--ink)] mb-1">
              Document Uploaded Successfully!
            </h2>
            <p className="text-sm text-[var(--ink3)] mb-6">
              Please mention your Token ID at the counter to collect your print.
            </p>

            {/* Token Badge */}
            <div className="bg-[var(--sub)] border-2 border-[var(--accent)] rounded-2xl p-6 text-[var(--ink)] shadow-md mb-6">
              <span className="dc-eyebrow text-[var(--accent)] block mb-1">
                Your Print Queue Token
              </span>
              <div className="dc-mono text-5xl font-black tracking-tight text-[var(--accent)]">{submittedJob.token}</div>
              <div className="mt-2 text-sm text-[var(--ink3)] font-medium">
                Customer: <span className="text-[var(--ink)] font-bold">{submittedJob.customer_name}</span>
              </div>
            </div>

            {/* Live Status Tracker */}
            <div className="bg-[var(--sub)] rounded-2xl p-4 border border-[var(--rule)] mb-6 text-left">
              <div className="flex items-center justify-between mb-3">
                <span className="dc-eyebrow text-[var(--ink3)]">Live Status</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold ${
                    submittedJob.status === 'printed'
                      ? 'bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)]'
                      : submittedJob.status === 'printing'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]'
                      : 'bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)]'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                  {submittedJob.status === 'printed'
                    ? 'Ready / Printed'
                    : submittedJob.status === 'printing'
                    ? 'Printing at Counter'
                    : 'Pending in Queue'}
                </span>
              </div>

              <div className="space-y-2 text-sm text-[var(--ink2)]">
                <div className="flex justify-between">
                  <span className="text-[var(--ink3)]">Document:</span>
                  <span className="font-medium truncate max-w-[200px] text-[var(--ink)]">{submittedJob.original_filename}</span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[var(--ink3)]">Print Mode:</span>
                  <span className="font-medium capitalize text-[var(--ink)]">
                    {submittedJob.color_mode === 'bw' ? 'Black & White' : 'Color'} •{' '}
                    {submittedJob.sides === 'duplex' ? 'Front & Back (Duplex)' : 'Single Sided'}
                  </span>
                </div>
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-[var(--ink3)]">Copies:</span>
                  <span className="font-medium text-[var(--ink)]">{submittedJob.copies}</span>
                </div>
                <div className="flex justify-between border-t border-[var(--rule)] pt-2 font-bold text-[var(--ink)]">
                  <span className="dc-eyebrow">Estimated Total:</span>
                  <span className="dc-mono text-[var(--accent)] text-base font-bold">{formatCurrency(submittedJob.estimated_cost)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleReset}
              className="w-full py-3.5 px-5 rounded-xl font-bold bg-[var(--accent)] text-white hover:opacity-90 transition shadow flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Upload Another Document
            </button>
          </div>
        ) : (
          /* ================= UPLOAD FORM ================= */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Customer Name Input */}
            <div className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)]">
              <label className="dc-eyebrow block mb-2 text-[var(--ink3)]">
                Your Name <span className="text-[var(--accent)]">*</span>
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter your name (e.g. Ramesh)"
                className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] focus:outline-none focus:border-[var(--accent)] font-medium text-[var(--ink)] placeholder:text-[var(--ink4)]"
              />
            </div>

            {/* File Upload Dropzone */}
            <div className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)]">
              <label className="dc-eyebrow block mb-2 text-[var(--ink3)]">
                Select Document <span className="text-[var(--accent)]">*</span>
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />

              {file ? (
                <div className="border border-[var(--accent-line)] bg-[var(--accent-soft)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <p className="text-sm font-bold text-[var(--ink)] truncate">{file.name}</p>
                      <p className="font-mono text-xs text-[var(--ink3)]">
                        {formatFileSize(file.size)} • {detectedPages} {detectedPages === 1 ? 'page' : 'pages'} detected
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--ink2)] bg-[var(--panel)] px-2.5 py-1 rounded-lg border border-[var(--border)]">
                      <span className="font-mono text-[11px]">Pages:</span>
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={detectedPages}
                        onChange={(e) => setDetectedPages(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-12 text-center font-mono font-bold text-[var(--ink)] bg-transparent focus:outline-none border-b border-[var(--accent)]"
                        title="Confirm or edit detected page count"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-[var(--accent)] font-bold hover:underline px-2 py-1"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
                    isDragOver
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] scale-[0.99]'
                      : 'border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--sub)]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-[var(--sub)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-[var(--ink)]">
                    Tap to upload or drag & drop document
                  </p>
                  <p className="font-mono text-xs text-[var(--ink3)] mt-1">
                    Accepts PDF, JPG, PNG files (up to 50MB)
                  </p>
                </div>
              )}
            </div>

            {/* Print Options */}
            <div className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)] space-y-4">
              <h2 className="dc-eyebrow text-[var(--ink3)]">
                Print Preferences
              </h2>

              {/* Color Mode */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Color Option</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setColorMode('bw')}
                    className={`py-3 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition ${
                      colorMode === 'bw'
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2 shadow-xs'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full ${colorMode === 'bw' ? 'bg-[var(--ink)]' : 'bg-[var(--ink4)]'}`} />
                    <span className="font-mono text-xs sm:text-sm">B&W ({formatCurrency(pricing.bw_price_per_page)}/pg)</span>
                  </button>

                  <button
                    type="button"
                    disabled={pricing.color_available === false}
                    onClick={() => {
                      if (pricing.color_available !== false) setColorMode('color');
                    }}
                    className={`py-3 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition relative ${
                      pricing.color_available === false
                        ? 'border-[var(--rule)] bg-[var(--sub)]/50 text-[var(--ink4)] opacity-50 cursor-not-allowed'
                        : colorMode === 'color'
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2 shadow-xs'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                    }`}
                  >
                    <div
                      className={`w-3 h-3 rounded-full ${
                        pricing.color_available === false
                          ? 'bg-[var(--ink4)]'
                          : 'bg-gradient-to-r from-red-400 via-green-400 to-blue-400'
                      }`}
                    />
                    {pricing.color_available === false ? (
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        Color
                        <span className="bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)] text-[10px] px-2 py-0.5 rounded-full font-bold">
                          Unavailable
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs sm:text-sm">Color ({formatCurrency(pricing.color_price_per_page)}/pg)</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Sides: Single vs Duplex */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Print Sides</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSides('single')}
                    className={`py-3 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition ${
                      sides === 'single'
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                    }`}
                  >
                    <FileText className="w-4 h-4 text-[var(--accent)]" /> Single Sided
                  </button>

                  <button
                    type="button"
                    disabled={pricing.duplex_available === false}
                    onClick={() => {
                      if (pricing.duplex_available !== false) setSides('duplex');
                    }}
                    className={`py-3 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition relative ${
                      pricing.duplex_available === false
                        ? 'border-[var(--rule)] bg-[var(--sub)]/50 text-[var(--ink4)] opacity-50 cursor-not-allowed'
                        : sides === 'duplex'
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                    }`}
                  >
                    <Layers className="w-4 h-4 text-[var(--accent)]" /> Front & Back
                    {pricing.duplex_available === false ? (
                      <span className="absolute -top-2 right-2 bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)] text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
                        Unavailable
                      </span>
                    ) : (
                      <span className="absolute -top-2 right-2 bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)] text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
                        Saves Paper
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Orientation & Copies in grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Orientation */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Orientation</label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as OrientationMode)}
                    className="w-full py-2.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] font-medium text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none font-mono"
                  >
                    <option value="auto">Auto / Standard</option>
                    <option value="portrait">Portrait (Vertical)</option>
                    <option value="landscape">Landscape (Horizontal)</option>
                  </select>
                </div>

                {/* Copies Counter */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Copies</label>
                  <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--sub)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCopies((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-2 text-[var(--ink2)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={copies}
                      onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full text-center font-mono font-bold text-[var(--ink)] bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setCopies((prev) => prev + 1)}
                      className="px-3 py-2 text-[var(--ink2)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Page Range Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--ink2)] font-mono">Page Range</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPageRangeMode('all')}
                      className={`text-xs px-2.5 py-0.5 rounded font-mono font-medium border ${
                        pageRangeMode === 'all'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'bg-[var(--sub)] text-[var(--ink3)] border-[var(--border)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      All Pages
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageRangeMode('custom')}
                      className={`text-xs px-2.5 py-0.5 rounded font-mono font-medium border ${
                        pageRangeMode === 'custom'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'bg-[var(--sub)] text-[var(--ink3)] border-[var(--border)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      Specific Pages
                    </button>
                  </div>
                </div>

                {pageRangeMode === 'custom' && (
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    placeholder="e.g. 1-5, 8, 11-14"
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] font-mono text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                )}
              </div>
            </div>

            {/* Live Cost Breakdown */}
            <div className="bg-[var(--panel)] border border-[var(--accent-line)] rounded-2xl p-4 sm:p-5 shadow-sm flex items-center justify-between">
              <div>
                <span className="dc-eyebrow text-[var(--accent)] block">
                  Live Cost Estimate
                </span>
                <p className="font-mono text-xs text-[var(--ink3)] mt-0.5">
                  {costEstimate.breakdownText}
                </p>
              </div>
              <div className="text-right">
                <span className="dc-mono text-2xl sm:text-3xl font-black text-[var(--ink)]">
                  {formatCurrency(costEstimate.totalCost)}
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 bg-[var(--danger-soft)] border border-[var(--danger-line)] rounded-xl text-xs text-[var(--danger)] font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !file}
              className="w-full py-4 px-6 rounded-2xl font-bold text-base tracking-wide bg-[var(--accent)] hover:opacity-90 text-white shadow-md disabled:opacity-50 disabled:pointer-events-none transition flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" /> Uploading & Queuing Document...
                </>
              ) : (
                <>
                  <Printer className="w-5 h-5" /> Submit Print Job • {formatCurrency(costEstimate.totalCost)}
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer info */}
      <footer className="max-w-xl mx-auto w-full text-center text-xs text-[var(--ink4)] mt-6 pt-4 border-t border-[var(--rule)]">
        <p>
          {shop?.shopName || 'J MART'} Quick Print Station • Fast walk-in printing service
        </p>
        <p className="mt-1 font-mono text-[11px] text-[var(--ink4)]">
          Documents are securely processed and automatically deleted after 24 hours.
        </p>
      </footer>
    </div>
  );
};
