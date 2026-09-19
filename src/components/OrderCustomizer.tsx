import React, { useState, useEffect } from 'react';
import {
  FileText,
  Printer,
  ArrowLeft,
  Check,
  Copy,
  Layers,
  Eye,
  AlertCircle,
  RefreshCw,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { PrintJob, PricingSettings, EffectivePricing } from '../types.js';
import {
  fetchJobByToken,
  updateJobOptionsByToken,
  fetchEffectivePricing,
  fetchSettings,
  fetchShopDetails,
} from '../api.js';
import {
  MONO,
  NUM,
  EYEBROW,
  PANEL,
  PANEL_HEAD,
  FIELD,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CHIP,
  inr,
} from '../lib/design-system.js';
import { calculatePrintCost, parsePageRange } from '../../shared/costCalculator.js';

interface OrderCustomizerProps {
  token: string;
  onBackToHome?: () => void;
}

export const OrderCustomizer: React.FC<OrderCustomizerProps> = ({ token, onBackToHome }) => {
  const [job, setJob] = useState<PrintJob | null>(null);
  const [pricing, setPricing] = useState<PricingSettings | EffectivePricing | null>(null);
  const [shopName, setShopName] = useState('Print Station');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Form state
  const [colorMode, setColorMode] = useState<'bw' | 'color'>('bw');
  const [sides, setSides] = useState<'single' | 'duplex'>('single');
  const [copies, setCopies] = useState<number>(1);
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');

  // Load job and settings
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jobData, pricingData, shopData] = await Promise.all([
        fetchJobByToken(token),
        fetchEffectivePricing().catch(() => fetchSettings().catch(() => null)),
        fetchShopDetails().catch(() => null),
      ]);

      setJob(jobData);
      setColorMode(jobData.color_mode || 'bw');
      setSides(jobData.sides || 'single');
      setCopies(jobData.copies || 1);

      if (jobData.page_range && jobData.page_range.toLowerCase() !== 'all') {
        setRangeMode('custom');
        setCustomRange(jobData.page_range);
      } else {
        setRangeMode('all');
        setCustomRange('');
      }

      if (pricingData) setPricing(pricingData);
      if (shopData?.shopName) setShopName(shopData.shopName);
    } catch (err: any) {
      setError(err.message || 'Could not find print order. Please verify your token.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  // Derived calculations
  const totalDocPages = job?.page_count || 1;
  const activePageRange = rangeMode === 'all' ? 'all' : (customRange.trim() || 'all');
  const selectedPagesList = parsePageRange(activePageRange, totalDocPages);
  const effectivePagesCount = selectedPagesList.length;

  // Live Cost Calculation
  const costCalculation = calculatePrintCost({
    totalPages: totalDocPages,
    pageRange: activePageRange,
    colorMode,
    sides,
    copies,
    pricing: pricing || undefined,
  });

  const isColorDisabled = pricing?.color_available === false;
  const isDuplexDisabled = pricing?.duplex_available === false;
  const isReadOnly = job?.status === 'printed' || job?.status === 'cancelled';

  const handleTogglePagePill = (pageNum: number) => {
    if (isReadOnly) return;
    const currentList = parsePageRange(rangeMode === 'all' ? 'all' : (customRange.trim() || 'all'), totalDocPages);
    let newList: number[];
    if (currentList.includes(pageNum)) {
      newList = currentList.filter((p) => p !== pageNum);
    } else {
      newList = [...currentList, pageNum].sort((a, b) => a - b);
    }

    if (newList.length === 0) {
      setRangeMode('custom');
      setCustomRange(`${pageNum}`);
      return;
    }
    if (newList.length === totalDocPages) {
      setRangeMode('all');
      setCustomRange('');
      return;
    }

    setRangeMode('custom');
    const parts: string[] = [];
    let start = newList[0];
    let end = start;

    for (let i = 1; i < newList.length; i++) {
      if (newList[i] === end + 1) {
        end = newList[i];
      } else {
        parts.push(start === end ? `${start}` : `${start}-${end}`);
        start = newList[i];
        end = start;
      }
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`);
    setCustomRange(parts.join(', '));
  };

  const handleCopyToken = () => {
    if (!job) return;
    navigator.clipboard?.writeText(job.token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job || isReadOnly) return;

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const finalRange = rangeMode === 'all' ? 'all' : (customRange.trim() || 'all');
      const res = await updateJobOptionsByToken(job.token, {
        color_mode: colorMode,
        sides: sides,
        copies: copies,
        page_range: finalRange,
      });

      setJob(res.job);
      setSuccessMsg(
        `Options updated successfully! Total amount is ${inr(res.job.estimated_cost)}.`
      );
      if (res.warning) {
        setError(res.warning);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--ink)] font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-mono text-[var(--ink3)] uppercase tracking-wider">Loading Order #{token}...</p>
        </div>
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4 font-sans">
        <div style={PANEL} className="max-w-md w-full p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[var(--ink)] mb-2">Order Not Found</h2>
          <p className="text-sm text-[var(--ink3)] mb-6">{error}</p>
          <div className="flex gap-2 justify-center">
            {onBackToHome && (
              <button onClick={onBackToHome} style={BTN_SECONDARY} className="px-4 text-xs">
                Back to Counter
              </button>
            )}
            <button onClick={loadData} style={BTN_PRIMARY} className="px-4 text-xs flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] font-sans pb-16">
      {/* Mobile Top App Bar */}
      <header className="sticky top-0 z-30 bg-[var(--panel)]/95 backdrop-blur-md border-b border-[var(--border)] px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {onBackToHome ? (
              <button
                onClick={onBackToHome}
                className="p-1.5 -ml-1 text-[var(--ink3)] hover:text-[var(--ink)] rounded-md hover:bg-[var(--sub)] transition"
                title="Back to portal"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <a
                href="/"
                className="p-1.5 -ml-1 text-[var(--ink3)] hover:text-[var(--ink)] rounded-md hover:bg-[var(--sub)] transition"
                title="Back to portal"
              >
                <ArrowLeft className="w-5 h-5" />
              </a>
            )}
            <div>
              <div className="text-xs font-bold tracking-tight text-[var(--ink)] flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5 text-[var(--accent)]" />
                {shopName}
              </div>
              <div className="text-[10px] font-mono text-[var(--ink3)] uppercase tracking-wider">
                Mobile Print Customizer
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              style={
                job.status === 'printed'
                  ? CHIP.ok
                  : job.status === 'printing'
                  ? CHIP.accent
                  : job.status === 'cancelled'
                  ? CHIP.danger
                  : CHIP.warn
              }
              className="px-2.5 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider"
            >
              {job.status}
            </span>
          </div>
        </div>
      </header>

      {/* Main Order Customizer Content */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {/* Token and Order Header Card */}
        <div style={PANEL} className="p-4 bg-[var(--panel)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div style={EYEBROW} className="mb-1">Order Token</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black font-mono text-[var(--accent)] tracking-tight">
                  {job.token}
                </span>
                <button
                  type="button"
                  onClick={handleCopyToken}
                  className="p-1.5 text-[var(--ink3)] hover:text-[var(--ink)] bg-[var(--sub)] hover:bg-[var(--rule2)] rounded border border-[var(--border2)] transition"
                  title="Copy Token"
                >
                  {copiedToken ? <Check className="w-3.5 h-3.5 text-[var(--ok)]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <div style={EYEBROW} className="mb-1">Estimated Total</div>
              <div className="text-2xl font-black font-mono text-[var(--ink)]">
                {inr(costCalculation.totalCost)}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--rule2)] flex flex-wrap items-center justify-between text-xs text-[var(--ink3)]">
            <div className="flex items-center gap-1.5">
              <span>Customer:</span>
              <strong className="text-[var(--ink)]">{job.customer_name || 'Counter Customer'}</strong>
            </div>
            {job.source === 'whatsapp' && (
              <div className="flex items-center gap-1 text-[var(--ok)]">
                <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                <span>WhatsApp Order</span>
              </div>
            )}
          </div>
        </div>

        {/* Success Banner */}
        {successMsg && (
          <div className="p-3.5 rounded-lg bg-[var(--ok-soft)] border border-[var(--ok-line)] text-[var(--ok)] text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Warning / Error Banner */}
        {error && (
          <div className="p-3.5 rounded-lg bg-[var(--warn-soft)] border border-[var(--warn-line)] text-[var(--warn)] text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Read-Only Notice if Finished */}
        {isReadOnly && (
          <div className="p-3 rounded-lg bg-[var(--sub)] border border-[var(--border)] text-xs text-[var(--ink2)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--warn)] shrink-0" />
            <span>This job is marked as <strong>{job.status}</strong> and cannot be altered.</span>
          </div>
        )}

        {/* Files & Document Details Card */}
        <div style={PANEL} className="overflow-hidden">
          <div style={PANEL_HEAD} className="justify-between">
            <span style={EYEBROW}>Document Files ({job.files?.length || 1})</span>
            <span className="text-[11px] font-mono text-[var(--ink3)]">
              {totalDocPages} {totalDocPages === 1 ? 'Page' : 'Pages'} Total
            </span>
          </div>

          <div className="p-3.5 space-y-2">
            {(job.files && job.files.length > 0 ? job.files : [job]).map((f: any, idx) => {
              const fileUrl = f.id ? `/api/jobs/${job.id}/files/${f.id}/file` : `/api/jobs/${job.id}/file`;
              const isImage =
                (f.mime_type && f.mime_type.startsWith('image/')) ||
                /\.(jpg|jpeg|png|webp|bmp)$/i.test(f.original_filename);

              return (
                <div
                  key={f.id || idx}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--sub)] border border-[var(--border2)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isImage ? (
                      <img
                        src={fileUrl}
                        alt={f.original_filename}
                        className="w-9 h-9 rounded object-cover border border-[var(--border)] shrink-0 bg-black/10"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded bg-[var(--rule2)] flex items-center justify-center text-[var(--accent)] shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--ink)] truncate max-w-[180px] sm:max-w-xs">
                        {f.original_filename}
                      </div>
                      <div className="text-[10px] font-mono text-[var(--ink3)]">
                        {f.page_count} {f.page_count === 1 ? 'page' : 'pages'} • {(f.file_size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>

                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded bg-[var(--panel)] border border-[var(--border)] hover:bg-[var(--rule2)] text-[11px] font-bold text-[var(--ink)] flex items-center gap-1 transition shrink-0"
                    title="View Document"
                  >
                    <Eye className="w-3 h-3 text-[var(--ink3)]" />
                    <span>Preview</span>
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        {/* Customization Options Form */}
        <form onSubmit={handleSave} className="space-y-4">
          {/* 1. Color Mode Selector */}
          <div style={PANEL} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label style={EYEBROW} className="flex items-center gap-1">
                <span>Color Mode</span>
                <span className="text-[var(--danger)]">*</span>
              </label>
              {pricing && (
                <span className="text-[10px] font-mono text-[var(--ink3)]">
                  B/W: {inr(pricing.bw_price_per_page)}/pg • Color: {inr(pricing.color_price_per_page)}/pg
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => setColorMode('bw')}
                className={`flex flex-col items-center justify-center p-3.5 rounded-xl border-2 text-center transition cursor-pointer min-h-[92px] ${
                  colorMode === 'bw'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)] shadow-xs'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                } ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span className="text-xl mb-1">⬛</span>
                <div className="text-xs font-bold text-[var(--ink)]">Black & White</div>
                <div className="text-[10px] font-mono text-[var(--ink3)] mt-0.5">
                  {inr(pricing?.bw_price_per_page || 2)}/page
                </div>
              </button>

              <button
                type="button"
                disabled={isReadOnly || isColorDisabled}
                onClick={() => setColorMode('color')}
                className={`relative flex flex-col items-center justify-center p-3.5 rounded-xl border-2 text-center transition cursor-pointer min-h-[92px] ${
                  colorMode === 'color'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)] shadow-xs'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                } ${isColorDisabled || isReadOnly ? 'opacity-50 cursor-not-allowed bg-red-950/20' : ''}`}
              >
                {isColorDisabled && (
                  <span className="absolute -top-2 right-2 px-1.5 py-0.5 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] text-[9px] font-mono font-bold border border-[var(--danger-line)] shadow-xs">
                    Unavailable
                  </span>
                )}
                <span className="text-xl mb-1">🎨</span>
                <div className="text-xs font-bold flex items-center gap-1 text-[var(--ink)]">
                  <span>Color Print</span>
                  <Sparkles className="w-3 h-3 text-amber-400" />
                </div>
                <div className="text-[10px] font-mono text-[var(--ink3)] mt-0.5">
                  {isColorDisabled ? 'Unavailable' : `${inr(pricing?.color_price_per_page || 10)}/page`}
                </div>
              </button>
            </div>
          </div>

          {/* 2. Sides (Duplex vs Single Sided) */}
          <div style={PANEL} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label style={EYEBROW} className="flex items-center gap-1">
                <span>Print Sides (Layout)</span>
                <span className="text-[var(--danger)]">*</span>
              </label>
              {pricing && pricing.duplex_available && (
                <span className="text-[10px] font-mono text-[var(--ink3)]">
                  Duplex Sheet: {inr(colorMode === 'color' ? pricing.duplex_sheet_price_color : pricing.duplex_sheet_price_bw)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => setSides('single')}
                className={`flex flex-col items-center justify-center p-3.5 rounded-xl border-2 text-center transition cursor-pointer min-h-[92px] ${
                  sides === 'single'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)] shadow-xs'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                } ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <span className="text-xl mb-1">📄</span>
                <div className="text-xs font-bold text-[var(--ink)]">Single Sided</div>
                <div className="text-[10px] font-mono text-[var(--ink3)] mt-0.5">1 page per sheet</div>
              </button>

              <button
                type="button"
                disabled={isReadOnly || isDuplexDisabled}
                onClick={() => setSides('duplex')}
                className={`relative flex flex-col items-center justify-center p-3.5 rounded-xl border-2 text-center transition cursor-pointer min-h-[92px] ${
                  sides === 'duplex'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)] shadow-xs'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                } ${isDuplexDisabled || isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isDuplexDisabled ? (
                  <span className="absolute -top-2 right-2 px-1.5 py-0.5 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] text-[9px] font-mono font-bold border border-[var(--danger-line)] shadow-xs">
                    Unavailable
                  </span>
                ) : (
                  <span className="absolute -top-2 right-2 px-1.5 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)] text-[9px] font-mono font-bold border border-[var(--ok-line)] shadow-xs">
                    Saves Paper
                  </span>
                )}
                <span className="text-xl mb-1">📑</span>
                <div className="text-xs font-bold flex items-center gap-1 text-[var(--ink)]">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Front & Back</span>
                </div>
                <div className="text-[10px] font-mono text-[var(--ink3)] mt-0.5">Two-sided (Duplex)</div>
              </button>
            </div>
          </div>

          {/* 3. Page Range Selection */}
          <div style={PANEL} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label style={EYEBROW}>Pages to Print</label>
              <span className="text-[11px] font-mono text-[var(--accent)] font-bold">
                {effectivePagesCount} of {totalDocPages} pages selected
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => {
                  setRangeMode('all');
                  setCustomRange('');
                }}
                className={`py-2 px-3 rounded-lg text-xs font-bold border transition ${
                  rangeMode === 'all'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                }`}
              >
                All Pages (1 - {totalDocPages})
              </button>

              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => setRangeMode('custom')}
                className={`py-2 px-3 rounded-lg text-xs font-bold border transition ${
                  rangeMode === 'custom'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                }`}
              >
                Custom Range
              </button>
            </div>

            {rangeMode === 'custom' && (
              <div className="pt-2 space-y-3">
                {/* Visual Page Buttons (if doc has <= 24 pages) */}
                {totalDocPages > 1 && totalDocPages <= 24 && (
                  <div>
                    <div className="text-[10px] font-mono text-[var(--ink3)] uppercase tracking-wider mb-1.5">
                      Tap pages to include/exclude:
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {Array.from({ length: totalDocPages }, (_, i) => i + 1).map((pg) => {
                        const isIncluded = selectedPagesList.includes(pg);
                        return (
                          <button
                            key={pg}
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleTogglePagePill(pg)}
                            className={`w-8 h-8 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                              isIncluded
                                ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-xs'
                                : 'border-[var(--border)] bg-[var(--panel)] text-[var(--ink3)] hover:text-[var(--ink)]'
                            } ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {pg}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className="text-[10px] text-[var(--ink3)] py-0.5 font-mono">Quick:</span>
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setCustomRange('1')}
                    className="px-2 py-0.5 rounded bg-[var(--sub)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer disabled:opacity-50"
                  >
                    Page 1 Only
                  </button>
                  {totalDocPages >= 3 && (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => setCustomRange('1-3')}
                      className="px-2 py-0.5 rounded bg-[var(--sub)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer disabled:opacity-50"
                    >
                      Pages 1-3
                    </button>
                  )}
                  {totalDocPages >= 5 && (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => setCustomRange('1-5')}
                      className="px-2 py-0.5 rounded bg-[var(--sub)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer disabled:opacity-50"
                    >
                      Pages 1-5
                    </button>
                  )}
                  {totalDocPages >= 2 && (
                    <>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => {
                          const odds = Array.from({ length: totalDocPages }, (_, i) => i + 1).filter((p) => p % 2 !== 0);
                          setCustomRange(odds.join(', '));
                        }}
                        className="px-2 py-0.5 rounded bg-[var(--sub)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer disabled:opacity-50"
                      >
                        Odd Pages
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => {
                          const evens = Array.from({ length: totalDocPages }, (_, i) => i + 1).filter((p) => p % 2 === 0);
                          setCustomRange(evens.join(', '));
                        }}
                        className="px-2 py-0.5 rounded bg-[var(--sub)] border border-[var(--border)] text-[10px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer disabled:opacity-50"
                      >
                        Even Pages
                      </button>
                    </>
                  )}
                </div>

                <input
                  type="text"
                  disabled={isReadOnly}
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  placeholder="e.g. 1-5 or 1,3,5"
                  style={FIELD}
                  className="w-full px-3 py-2 text-xs font-mono"
                />
                {customRange.trim() && (
                  <div className="text-[11px] font-mono flex items-center justify-between">
                    <span className="text-[var(--ink3)]">
                      {effectivePagesCount} {effectivePagesCount === 1 ? 'page' : 'pages'} selected
                    </span>
                    {selectedPagesList.length > 0 && Math.max(...selectedPagesList) > totalDocPages && (
                      <span className="text-[var(--warn)]">
                        ⚠️ Clamped to max {totalDocPages} pages
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. Number of Copies */}
          <div style={PANEL} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label style={EYEBROW}>Number of Copies</label>
              <span className="text-[11px] font-mono text-[var(--ink3)]">
                {copies} {copies > 1 ? 'Sets' : 'Set'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center border border-[var(--border2)] rounded-lg bg-[var(--sub)] overflow-hidden">
                <button
                  type="button"
                  disabled={isReadOnly || copies <= 1}
                  onClick={() => setCopies((c) => Math.max(1, c - 1))}
                  className="w-11 h-10 flex items-center justify-center font-bold text-base text-[var(--ink)] hover:bg-[var(--rule2)] transition disabled:opacity-40"
                >
                  -
                </button>
                <input
                  type="number"
                  disabled={isReadOnly}
                  min={1}
                  max={500}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-14 h-10 text-center font-mono font-bold text-sm bg-transparent border-x border-[var(--border2)] text-[var(--ink)] outline-none"
                />
                <button
                  type="button"
                  disabled={isReadOnly || copies >= 500}
                  onClick={() => setCopies((c) => Math.min(500, c + 1))}
                  className="w-11 h-10 flex items-center justify-center font-bold text-base text-[var(--ink)] hover:bg-[var(--rule2)] transition disabled:opacity-40"
                >
                  +
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 5].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setCopies(preset)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition ${
                      copies === preset
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border2)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border)]'
                    }`}
                  >
                    {preset} {preset > 1 ? 'copies' : 'copy'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Order Summary & Total Card */}
          <div style={PANEL} className="p-4 bg-[var(--panel)] border-[var(--accent)]/50">
            <div style={EYEBROW} className="mb-2">Bill Summary</div>
            <div className="space-y-1.5 text-xs text-[var(--ink2)]">
              <div className="flex justify-between">
                <span>Selected Pages:</span>
                <span className="font-mono font-bold text-[var(--ink)]">
                  {costCalculation.effectivePages} {costCalculation.effectivePages === 1 ? 'page' : 'pages'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Paper Sheets Required:</span>
                <span className="font-mono font-bold text-[var(--ink)]">
                  {costCalculation.sheets} {costCalculation.sheets === 1 ? 'sheet' : 'sheets'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Print Mode:</span>
                <span className="font-mono text-[var(--ink)]">
                  {colorMode === 'color' ? 'Color' : 'B/W'} • {sides === 'duplex' ? 'Front & Back' : 'Single'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Copies:</span>
                <span className="font-mono text-[var(--ink)]">× {copies}</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[var(--border2)] flex items-baseline justify-between">
              <div className="text-xs font-bold text-[var(--ink)]">Total Payable:</div>
              <div className="text-right">
                <div className="text-2xl font-black font-mono text-[var(--accent)]">
                  {inr(costCalculation.totalCost)}
                </div>
              </div>
            </div>
          </div>

          {/* Submit Action Button */}
          {!isReadOnly ? (
            <button
              type="submit"
              disabled={saving}
              style={BTN_PRIMARY}
              className="w-full flex items-center justify-center gap-2 text-sm shadow-md hover:opacity-95 transition"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Updating Order...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Confirm & Update Print Order</span>
                </>
              )}
            </button>
          ) : (
            <div className="text-center text-xs font-mono text-[var(--ink3)] py-2">
              This order cannot be edited as it has already been processed.
            </div>
          )}
        </form>

        {/* Counter Instructions Card */}
        <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--sub)]/60 text-xs text-[var(--ink3)] space-y-1">
          <p className="font-bold text-[var(--ink2)]">💡 Counter Collection Info:</p>
          <p>Show your token <strong>{job.token}</strong> at the counter when collecting your prints.</p>
          <p>Any updates made here will notify our printing PC immediately.</p>
        </div>
      </main>
    </div>
  );
};
