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
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from 'lucide-react';
import {
  ShopDetails,
  PricingSettings,
  ColorMode,
  SidesMode,
  OrientationMode,
  PrintJob,
  JobFile,
} from '../types.js';
import { PDFDocument } from 'pdf-lib';
import { fetchShopDetails, fetchSettings, fetchEffectivePricing, uploadJob, connectLiveWebSocket, fetchJobByToken } from '../api.js';
import { calculatePrintCost, DEFAULT_PRICING } from '../utils/costCalculator.js';
import { formatCurrency, formatFileSize } from '../utils/formatters.js';
import { useTheme } from '../theme.js';
import { PrintConfigModal } from './PrintConfigModal.js';

interface UploadedFileItem {
  id: string;
  file: File;
  detectedPages: number;
  customOptions?: {
    colorMode?: ColorMode;
    sides?: SidesMode;
    orientation?: OrientationMode;
    copies?: number;
    pageRange?: string;
  };
}

export const CustomerPortal: React.FC = () => {
  const [shop, setShop] = useState<ShopDetails | null>(null);
  const [pricing, setPricing] = useState<PricingSettings>(DEFAULT_PRICING);
  const [theme, toggleTheme] = useTheme();

  // Form states
  const [customerName, setCustomerName] = useState(() => {
    return localStorage.getItem('jmart_customer_name') || '';
  });
  const [files, setFiles] = useState<UploadedFileItem[]>([]);
  const [masterColorMode, setMasterColorMode] = useState<ColorMode>('bw');
  const [masterSides, setMasterSides] = useState<SidesMode>('single');
  const [masterOrientation, setMasterOrientation] = useState<OrientationMode>('auto');
  const [masterCopies, setMasterCopies] = useState<number>(1);
  const [pageRangeMode, setPageRangeMode] = useState<'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');

  // Print Configuration Modal state
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [activeModalFileId, setActiveModalFileId] = useState<string | null>(null);

  // Per-file customization toggle
  const [showPerFileSettings, setShowPerFileSettings] = useState(false);

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

    // Check if customer visited via WhatsApp 1-tap link e.g. /?token=P-101
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      fetchJobByToken(tokenParam)
        .then((job) => {
          setSubmittedJob(job);
        })
        .catch((e) => console.warn('Could not load job by token:', e));
    }
  }, []);

  // Real-time WebSocket sync
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

  // Fallback if capabilities change
  useEffect(() => {
    if (pricing.color_available === false && masterColorMode === 'color') {
      setMasterColorMode('bw');
    }
  }, [pricing.color_available, masterColorMode]);

  useEffect(() => {
    if (pricing.duplex_available === false && masterSides === 'duplex') {
      setMasterSides('single');
    }
  }, [pricing.duplex_available, masterSides]);

  // Helper to detect page count of an uploaded file
  const inspectPageCount = async (selectedFile: File): Promise<number> => {
    if (selectedFile.type.startsWith('image/')) {
      return 1;
    }
    if (
      selectedFile.type === 'application/pdf' ||
      selectedFile.name.toLowerCase().endsWith('.pdf')
    ) {
      try {
        const buffer = await selectedFile.arrayBuffer();
        try {
          const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
          const count = pdfDoc.getPageCount();
          return count && count > 0 ? count : 1;
        } catch {
          const text = new TextDecoder('latin1').decode(buffer);
          const pageMatches = text.match(/\/Type\s*\/Page\b/g);
          return pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;
        }
      } catch (err) {
        console.warn('Could not inspect PDF pages in browser:', err);
        return 1;
      }
    }
    return 1;
  };

  // Add multiple files
  const handleAddFiles = async (newFileList: FileList | File[]) => {
    setErrorMessage(null);
    const newItems: UploadedFileItem[] = [];

    for (let i = 0; i < newFileList.length; i++) {
      const f = newFileList[i];
      const pages = await inspectPageCount(f);
      newItems.push({
        id: `client_file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        file: f,
        detectedPages: pages,
      });
    }

    setFiles((prev) => [...prev, ...newItems]);

    // Automatically pop up visual configuration modal when files are dropped or selected
    if (newItems.length > 0) {
      setActiveModalFileId(newItems[0].id);
      setIsConfigModalOpen(true);
    }
  };

  const handleApplyModalConfig = (config: {
    colorMode: ColorMode;
    sides: SidesMode;
    orientation: OrientationMode;
    copies: number;
    pageRange: string;
    applyToAll: boolean;
    targetFileId?: string;
  }) => {
    if (config.applyToAll) {
      setMasterColorMode(config.colorMode);
      setMasterSides(config.sides);
      setMasterOrientation(config.orientation);
      setMasterCopies(config.copies);
      if (config.pageRange === 'all') {
        setPageRangeMode('all');
        setCustomRange('');
      } else {
        setPageRangeMode('custom');
        setCustomRange(config.pageRange);
      }
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          customOptions: {
            colorMode: config.colorMode,
            sides: config.sides,
            orientation: config.orientation,
            copies: config.copies,
            pageRange: config.pageRange,
          },
        }))
      );
    } else if (config.targetFileId) {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== config.targetFileId) return f;
          return {
            ...f,
            customOptions: {
              ...f.customOptions,
              colorMode: config.colorMode,
              sides: config.sides,
              orientation: config.orientation,
              copies: config.copies,
              pageRange: config.pageRange,
            },
          };
        })
      );
    }
  };

  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpdateFilePages = (id: string, newPages: number) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, detectedPages: Math.max(1, newPages) } : f))
    );
  };

  const handleUpdateFileCustomOption = (
    id: string,
    key: 'colorMode' | 'sides' | 'copies' | 'pageRange',
    value: any
  ) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        return {
          ...f,
          customOptions: {
            ...f.customOptions,
            [key]: value,
          },
        };
      })
    );
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // Cumulative cost calculations across all files
  const activeMasterPageRange = pageRangeMode === 'all' ? 'all' : customRange;

  const costSummary = files.reduce(
    (acc, item) => {
      const fColorMode = item.customOptions?.colorMode || masterColorMode;
      const fSides = item.customOptions?.sides || masterSides;
      const fCopies = item.customOptions?.copies || masterCopies;
      const fRange = item.customOptions?.pageRange || activeMasterPageRange;

      const calc = calculatePrintCost({
        totalPages: item.detectedPages,
        pageRange: fRange,
        colorMode: fColorMode,
        sides: fSides,
        copies: fCopies,
        pricing,
      });

      return {
        totalCost: acc.totalCost + calc.totalCost,
        totalPages: acc.totalPages + calc.effectivePages * fCopies,
        totalSheets: acc.totalSheets + calc.sheets * fCopies,
      };
    },
    { totalCost: 0, totalPages: 0, totalSheets: 0 }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setErrorMessage('Please add at least one document to print.');
      return;
    }

    const trimmedName = customerName.trim() || 'Walk-in Customer';
    localStorage.setItem('jmart_customer_name', trimmedName);

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append('customerName', trimmedName);
      formData.append('colorMode', masterColorMode);
      formData.append('sides', masterSides);
      formData.append('orientation', masterOrientation);
      formData.append('copies', String(masterCopies));
      formData.append('pageRange', activeMasterPageRange);

      // Append all physical files
      for (const item of files) {
        formData.append('files', item.file);
      }

      // Append per-file custom settings
      const fileOptions = files.map((item) => ({
        colorMode: item.customOptions?.colorMode || masterColorMode,
        sides: item.customOptions?.sides || masterSides,
        orientation: item.customOptions?.orientation || masterOrientation,
        copies: item.customOptions?.copies || masterCopies,
        pageRange: item.customOptions?.pageRange || activeMasterPageRange,
        pageCount: item.detectedPages,
      }));
      formData.append('fileOptions', JSON.stringify(fileOptions));

      const res = await uploadJob(formData);
      setSubmittedJob(res.job);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit documents. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmittedJob(null);
    setFiles([]);
    setPageRangeMode('all');
    setCustomRange('');
    setMasterCopies(1);
    setShowPerFileSettings(false);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen py-4 px-3 sm:py-8 sm:px-6 flex flex-col justify-between font-sans text-[var(--ink)]">
      <div className="max-w-2xl mx-auto w-full">
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
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition cursor-pointer"
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
              Documents Uploaded Successfully!
            </h2>
            <p className="text-sm text-[var(--ink3)] mb-6">
              Please mention your Token ID at the counter to collect your prints.
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

            {/* Live Status Tracker & Files Breakdown */}
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

              {/* Uploaded Documents List */}
              <div className="space-y-2 text-sm text-[var(--ink2)] mb-3">
                <span className="text-xs font-mono text-[var(--ink3)] font-bold block mb-1">
                  Uploaded Documents ({submittedJob.files?.length || submittedJob.total_files || 1}):
                </span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {(submittedJob.files && submittedJob.files.length > 0
                    ? submittedJob.files
                    : [
                        {
                          id: 'f1',
                          original_filename: submittedJob.original_filename,
                          page_count: submittedJob.page_count,
                          estimated_cost: submittedJob.estimated_cost,
                        } as JobFile,
                      ]
                  ).map((f, idx) => (
                    <div
                      key={f.id || idx}
                      className="p-2 rounded-lg bg-[var(--panel)] border border-[var(--rule)] flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                        <span className="truncate font-medium text-[var(--ink)]">{f.original_filename}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 text-[var(--ink3)]">
                        <span>{f.page_count} pgs</span>
                        <span className="font-bold text-[var(--ink)]">{formatCurrency(f.estimated_cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between border-t border-[var(--rule)] pt-2 font-bold text-[var(--ink)]">
                  <span className="dc-eyebrow">Estimated Total:</span>
                  <span className="dc-mono text-[var(--accent)] text-base font-bold">
                    {formatCurrency(submittedJob.estimated_cost)}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleReset}
              className="w-full py-3.5 px-5 rounded-xl font-bold bg-[var(--accent)] text-white hover:opacity-90 transition shadow flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Upload More Documents
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

            {/* Multi-File Upload Dropzone & List */}
            <div className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <label className="dc-eyebrow text-[var(--ink3)]">
                  Documents to Print <span className="text-[var(--accent)]">*</span>
                </label>
                <span className="text-xs font-mono text-[var(--ink3)]">
                  {files.length} document{files.length !== 1 ? 's' : ''} selected
                </span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleAddFiles(e.target.files);
                    // Clear input so same file can be chosen again if desired
                    e.target.value = '';
                  }
                }}
              />

              {/* Uploaded Documents List */}
              {files.length > 0 && (
                <div className="space-y-2.5 mb-4">
                  {files.map((item, idx) => {
                    const fColor = item.customOptions?.colorMode || masterColorMode;
                    const fSides = item.customOptions?.sides || masterSides;
                    const fCopies = item.customOptions?.copies || masterCopies;
                    const fRange = item.customOptions?.pageRange || activeMasterPageRange;

                    const itemCost = calculatePrintCost({
                      totalPages: item.detectedPages,
                      pageRange: fRange,
                      colorMode: fColor,
                      sides: fSides,
                      copies: fCopies,
                      pricing,
                    });

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setActiveModalFileId(item.id);
                          setIsConfigModalOpen(true);
                        }}
                        className="group border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft2)] rounded-2xl p-3 sm:p-3.5 transition cursor-pointer shadow-xs"
                        title="Tap to customize print options for this document"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="w-8 h-8 rounded-xl bg-[var(--accent)] text-white flex items-center justify-center shrink-0 text-xs font-bold font-mono shadow-xs">
                              {idx + 1}
                            </div>
                            <div className="truncate">
                              <p className="text-xs sm:text-sm font-bold text-[var(--ink)] truncate" title={item.file.name}>
                                {item.file.name}
                              </p>
                              <p className="font-mono text-[11px] text-[var(--ink3)]">
                                {formatFileSize(item.file.size)} • {item.detectedPages} page{item.detectedPages > 1 ? 's' : ''}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                            {/* Pages counter */}
                            <div className="flex items-center gap-1 text-xs text-[var(--ink2)] bg-[var(--panel)] px-2 py-1 rounded-xl border border-[var(--border)]">
                              <span className="font-mono text-[10px] text-[var(--ink3)]">Pgs:</span>
                              <input
                                type="number"
                                min={1}
                                max={9999}
                                value={item.detectedPages}
                                onChange={(e) => handleUpdateFilePages(item.id, parseInt(e.target.value, 10) || 1)}
                                className="w-10 text-center font-mono font-bold text-[var(--ink)] bg-transparent focus:outline-none"
                                title="Confirm page count"
                              />
                            </div>

                            {/* Remove file button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFile(item.id);
                              }}
                              title="Remove this document"
                              className="p-1.5 rounded-xl text-[var(--ink3)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Active Options Badges Row */}
                        <div className="mt-2.5 pt-2 border-t border-[var(--accent-line)]/50 flex flex-wrap items-center justify-between gap-1.5 text-xs font-mono">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[10px] font-bold text-[var(--ink)] flex items-center gap-1">
                              {fColor === 'color' ? '🎨 Color' : '⬛ B&W'}
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[10px] font-bold text-[var(--ink)] flex items-center gap-1">
                              {fSides === 'duplex' ? '📑 Duplex' : '📄 Single'}
                            </span>
                            {fCopies > 1 && (
                              <span className="px-2 py-0.5 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[10px] font-bold text-[var(--ink)]">
                                ×{fCopies} sets
                              </span>
                            )}
                            {fRange && fRange !== 'all' && (
                              <span className="px-2 py-0.5 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[10px] font-bold text-[var(--ink)]">
                                Pgs: {fRange}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-[var(--ink)]">
                              {formatCurrency(itemCost.totalCost)}
                            </span>
                            <span className="text-[10px] text-[var(--accent)] group-hover:underline flex items-center gap-0.5 font-bold">
                              Change <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Dropzone / Add Button */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-5 sm:p-6 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] scale-[0.99]'
                    : 'border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--sub)]'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-[var(--sub)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center mx-auto mb-2">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-[var(--ink)]">
                  {files.length === 0 ? 'Tap to upload or drag & drop documents' : '+ Add more documents'}
                </p>
                <p className="font-mono text-[11px] text-[var(--ink3)] mt-0.5">
                  Accepts multiple PDF, JPG, PNG files (up to 100MB total)
                </p>
              </div>
            </div>

            {/* Master Print Options */}
            <div className="bg-[var(--panel)] rounded-2xl p-4 sm:p-5 shadow-sm border border-[var(--border)] space-y-4">
              <h2 className="dc-eyebrow text-[var(--ink3)]">
                Print Preferences (Applies to all documents)
              </h2>

              {/* Color Mode */}
              <div>
                <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Color Option</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setMasterColorMode('bw')}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                      masterColorMode === 'bw'
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2 shadow-xs'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full ${masterColorMode === 'bw' ? 'bg-[var(--ink)]' : 'bg-[var(--ink4)]'}`} />
                    <span className="font-mono text-xs sm:text-sm">B&W ({formatCurrency(pricing.bw_price_per_page)}/pg)</span>
                  </button>

                  <button
                    type="button"
                    disabled={pricing.color_available === false}
                    onClick={() => {
                      if (pricing.color_available !== false) setMasterColorMode('color');
                    }}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition relative cursor-pointer ${
                      pricing.color_available === false
                        ? 'border-[var(--rule)] bg-[var(--sub)]/50 text-[var(--ink4)] opacity-50 cursor-not-allowed'
                        : masterColorMode === 'color'
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
                    onClick={() => setMasterSides('single')}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                      masterSides === 'single'
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
                      if (pricing.duplex_available !== false) setMasterSides('duplex');
                    }}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition relative cursor-pointer ${
                      pricing.duplex_available === false
                        ? 'border-[var(--rule)] bg-[var(--sub)]/50 text-[var(--ink4)] opacity-50 cursor-not-allowed'
                        : masterSides === 'duplex'
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

              {/* Orientation & Copies */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Orientation</label>
                  <select
                    value={masterOrientation}
                    onChange={(e) => setMasterOrientation(e.target.value as OrientationMode)}
                    className="w-full py-2.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] font-medium text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none font-mono"
                  >
                    <option value="auto">Auto / Standard</option>
                    <option value="portrait">Portrait (Vertical)</option>
                    <option value="landscape">Landscape (Horizontal)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--ink2)] mb-1.5 font-mono">Copies per Document</label>
                  <div className="flex items-center rounded-xl border border-[var(--border)] bg-[var(--sub)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMasterCopies((prev) => Math.max(1, prev - 1))}
                      className="px-3 py-2 text-[var(--ink2)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={masterCopies}
                      onChange={(e) => setMasterCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full text-center font-mono font-bold text-[var(--ink)] bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMasterCopies((prev) => prev + 1)}
                      className="px-3 py-2 text-[var(--ink2)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition cursor-pointer"
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
                      className={`text-xs px-2.5 py-0.5 rounded font-mono font-medium border cursor-pointer ${
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
                      className={`text-xs px-2.5 py-0.5 rounded font-mono font-medium border cursor-pointer ${
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

              {/* Optional Per-File Customization Accordion */}
              {files.length > 1 && (
                <div className="pt-2 border-t border-[var(--rule)]">
                  <button
                    type="button"
                    onClick={() => setShowPerFileSettings(!showPerFileSettings)}
                    className="text-xs font-bold font-mono text-[var(--accent)] hover:underline flex items-center justify-between w-full py-1 cursor-pointer"
                  >
                    <span>Customize individual documents ({files.length})</span>
                    {showPerFileSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showPerFileSettings && (
                    <div className="mt-3 space-y-3 pl-1">
                      {files.map((f, idx) => (
                        <div key={f.id} className="p-3 bg-[var(--sub)] rounded-xl border border-[var(--rule)] space-y-2">
                          <span className="text-xs font-bold font-mono text-[var(--ink)] truncate block">
                            Doc #{idx + 1}: {f.file.name}
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <select
                              value={f.customOptions?.colorMode || masterColorMode}
                              onChange={(e) =>
                                handleUpdateFileCustomOption(f.id, 'colorMode', e.target.value as ColorMode)
                              }
                              className="px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] font-mono"
                            >
                              <option value="bw">B&W</option>
                              {pricing.color_available !== false && <option value="color">Color</option>}
                            </select>

                            <select
                              value={f.customOptions?.sides || masterSides}
                              onChange={(e) =>
                                handleUpdateFileCustomOption(f.id, 'sides', e.target.value as SidesMode)
                              }
                              className="px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] font-mono"
                            >
                              <option value="single">Single Side</option>
                              {pricing.duplex_available !== false && <option value="duplex">Front & Back</option>}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Live Cumulative Cost Breakdown */}
            <div className="bg-[var(--panel)] border border-[var(--accent-line)] rounded-2xl p-4 sm:p-5 shadow-sm flex items-center justify-between">
              <div>
                <span className="dc-eyebrow text-[var(--accent)] block">
                  Cumulative Total Estimate
                </span>
                <p className="font-mono text-xs text-[var(--ink3)] mt-0.5">
                  {files.length} document{files.length !== 1 ? 's' : ''} • {costSummary.totalPages} total page{costSummary.totalPages !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-right">
                <span className="dc-mono text-2xl sm:text-3xl font-black text-[var(--ink)]">
                  {formatCurrency(costSummary.totalCost)}
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
              disabled={isSubmitting || files.length === 0}
              className="w-full py-4 px-6 rounded-2xl font-bold text-base tracking-wide bg-[var(--accent)] hover:opacity-90 text-white shadow-md disabled:opacity-50 disabled:pointer-events-none transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" /> Uploading & Queuing Documents...
                </>
              ) : (
                <>
                  <Printer className="w-5 h-5" /> Submit Print Order • {formatCurrency(costSummary.totalCost)}
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer info */}
      <footer className="max-w-2xl mx-auto w-full text-center text-xs text-[var(--ink4)] mt-6 pt-4 border-t border-[var(--rule)]">
        <p>
          {shop?.shopName || 'J MART'} Quick Print Station • Fast walk-in printing service
        </p>
        <p className="mt-1 font-mono text-[11px] text-[var(--ink4)]">
          Documents are securely processed and automatically deleted after 24 hours.
        </p>
      </footer>

      {/* Visual Print Configuration Modal */}
      <PrintConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        files={files}
        activeFileId={activeModalFileId}
        onSelectActiveFile={(id) => setActiveModalFileId(id)}
        pricing={pricing}
        masterColorMode={masterColorMode}
        masterSides={masterSides}
        masterOrientation={masterOrientation}
        masterCopies={masterCopies}
        masterPageRange={activeMasterPageRange}
        onApply={handleApplyModalConfig}
      />
    </div>
  );
};
