import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Layers,
  Sparkles,
  Plus,
  Minus,
  Check,
  Printer,
  ChevronRight,
} from 'lucide-react';
import {
  ColorMode,
  SidesMode,
  OrientationMode,
  PricingSettings,
  EffectivePricing,
} from '../types.js';
import { calculatePrintCost, parsePageRange } from '../utils/costCalculator.js';
import { inr, MONO, EYEBROW } from '../lib/design-system.js';
import { formatFileSize } from '../utils/formatters.js';

export interface UploadedFileModalItem {
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

export interface PrintConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: UploadedFileModalItem[];
  activeFileId: string | null;
  onSelectActiveFile: (fileId: string) => void;
  pricing: PricingSettings | EffectivePricing;
  masterColorMode: ColorMode;
  masterSides: SidesMode;
  masterOrientation: OrientationMode;
  masterCopies: number;
  masterPageRange: string;
  onApply: (config: {
    colorMode: ColorMode;
    sides: SidesMode;
    orientation: OrientationMode;
    copies: number;
    pageRange: string;
    applyToAll: boolean;
    targetFileId?: string;
  }) => void;
}

export const PrintConfigModal: React.FC<PrintConfigModalProps> = ({
  isOpen,
  onClose,
  files,
  activeFileId,
  onSelectActiveFile,
  pricing,
  masterColorMode,
  masterSides,
  masterOrientation,
  masterCopies,
  masterPageRange,
  onApply,
}) => {
  const activeFile = files.find((f) => f.id === activeFileId) || files[0] || null;

  // Local state for options
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [sides, setSides] = useState<SidesMode>('single');
  const [orientation, setOrientation] = useState<OrientationMode>('auto');
  const [copies, setCopies] = useState<number>(1);
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');
  const [applyToAll, setApplyToAll] = useState<boolean>(true);

  // Sync state when modal opens or active file changes
  useEffect(() => {
    if (!isOpen) return;

    if (activeFile) {
      const opts = activeFile.customOptions;
      setColorMode(opts?.colorMode || masterColorMode || 'bw');
      setSides(opts?.sides || masterSides || 'single');
      setOrientation(opts?.orientation || masterOrientation || 'auto');
      setCopies(opts?.copies || masterCopies || 1);

      const activeRange = opts?.pageRange || masterPageRange || 'all';
      if (activeRange && activeRange.toLowerCase() !== 'all') {
        setRangeMode('custom');
        setCustomRange(activeRange);
      } else {
        setRangeMode('all');
        setCustomRange('');
      }
    } else {
      setColorMode(masterColorMode || 'bw');
      setSides(masterSides || 'single');
      setOrientation(masterOrientation || 'auto');
      setCopies(masterCopies || 1);
      setRangeMode(masterPageRange && masterPageRange !== 'all' ? 'custom' : 'all');
      setCustomRange(masterPageRange && masterPageRange !== 'all' ? masterPageRange : '');
    }

    // Default applyToAll to true if all files currently have uniform options or multiple files
    setApplyToAll(files.length > 1);
  }, [isOpen, activeFile?.id]);

  // Adjust options if capabilities disable them
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

  // Keyboard accessibility: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const totalDocPages = activeFile?.detectedPages || 1;
  const activePageRange = rangeMode === 'all' ? 'all' : (customRange.trim() || 'all');
  const selectedPagesList = parsePageRange(activePageRange, totalDocPages);
  const effectivePagesCount = selectedPagesList.length;

  const isColorDisabled = pricing.color_available === false;
  const isDuplexDisabled = pricing.duplex_available === false;

  // Live Cost Calculations
  // If applyToAll is true, calculate cumulative across all files. Otherwise for activeFile.
  let calculatedTotalCost = 0;
  let calculatedTotalSheets = 0;
  let calculatedEffectivePages = 0;

  if (applyToAll && files.length > 0) {
    for (const item of files) {
      const itemPages = item.detectedPages || 1;
      const res = calculatePrintCost({
        totalPages: itemPages,
        pageRange: activePageRange,
        colorMode,
        sides,
        copies,
        pricing,
      });
      calculatedTotalCost += res.totalCost;
      calculatedTotalSheets += res.sheets * copies;
      calculatedEffectivePages += res.effectivePages * copies;
    }
  } else {
    const res = calculatePrintCost({
      totalPages: totalDocPages,
      pageRange: activePageRange,
      colorMode,
      sides,
      copies,
      pricing,
    });
    calculatedTotalCost = res.totalCost;
    calculatedTotalSheets = res.sheets * copies;
    calculatedEffectivePages = res.effectivePages * copies;
  }

  // Quick page toggle helper for interactive pill selector
  const handleTogglePagePill = (pageNum: number) => {
    const currentList = parsePageRange(customRange.trim() || 'all', totalDocPages);
    let newList: number[];
    if (currentList.includes(pageNum)) {
      newList = currentList.filter((p) => p !== pageNum);
    } else {
      newList = [...currentList, pageNum].sort((a, b) => a - b);
    }

    if (newList.length === 0) {
      setCustomRange(`${pageNum}`);
    } else if (newList.length === totalDocPages) {
      setRangeMode('all');
      setCustomRange('');
    } else {
      // Group consecutive numbers into ranges e.g. "1-3, 5"
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
    }
  };

  const handleConfirm = () => {
    const finalRange = rangeMode === 'all' ? 'all' : (customRange.trim() || 'all');
    onApply({
      colorMode,
      sides,
      orientation,
      copies,
      pageRange: finalRange,
      applyToAll,
      targetFileId: activeFile?.id,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-[var(--panel)] border border-[var(--border)] rounded-3xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans text-[var(--ink)] animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-config-modal-title"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 id="print-config-modal-title" className="text-base font-bold text-[var(--ink)] tracking-tight">
                Configure Print Options
              </h2>
              <p className="text-[11px] font-mono text-[var(--ink3)]">
                1-tap visual customization • No typing needed
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-xl text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Multi-File Context Bar / Tabs */}
          {files.length > 1 && (
            <div className="space-y-2 p-3 bg-[var(--sub)] rounded-2xl border border-[var(--border)]">
              <div className="flex items-center justify-between">
                <span style={EYEBROW}>Select Document to Configure</span>
                <span className="text-[11px] font-mono text-[var(--ink3)]">
                  {files.length} documents uploaded
                </span>
              </div>

              {/* Document Pills */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {files.map((f, idx) => {
                  const isSelected = f.id === activeFile?.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onSelectActiveFile(f.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium border flex items-center gap-1.5 shrink-0 transition cursor-pointer ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] font-bold shadow-xs'
                          : 'border-[var(--border)] bg-[var(--panel)] text-[var(--ink2)] hover:border-[var(--border2)]'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-[var(--ink)]/10 text-[10px] flex items-center justify-center font-bold">
                        {idx + 1}
                      </span>
                      <span className="truncate max-w-[120px]" title={f.file.name}>
                        {f.file.name}
                      </span>
                      <span className="opacity-70 text-[10px]">({f.detectedPages}p)</span>
                    </button>
                  );
                })}
              </div>

              {/* Apply to All documents checkbox */}
              <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] bg-[var(--panel)] cursor-pointer"
                />
                <span className="text-xs font-medium text-[var(--ink)]">
                  Apply these print options to all <strong>{files.length} documents</strong>
                </span>
              </label>
            </div>
          )}

          {/* Active File Summary (when single file or inspecting current) */}
          {activeFile && (
            <div className="p-3 bg-[var(--sub)]/60 rounded-xl border border-[var(--rule2)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span className="font-bold text-[var(--ink)] truncate max-w-[240px] sm:max-w-xs">
                  {activeFile.file.name}
                </span>
              </div>
              <div className="shrink-0 font-mono text-[11px] text-[var(--ink3)]">
                {totalDocPages} {totalDocPages === 1 ? 'page' : 'pages'} • {formatFileSize(activeFile.file.size)}
              </div>
            </div>
          )}

          {/* 1. Color Mode: Large Visual Cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={EYEBROW} className="flex items-center gap-1">
                <span>Color Option</span>
                <span className="text-[var(--danger)]">*</span>
              </label>
              <span className="text-[11px] font-mono text-[var(--ink3)]">
                B/W: {inr(pricing.bw_price_per_page || 2)} • Color: {inr(pricing.color_price_per_page || 10)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Black & White Card */}
              <button
                type="button"
                onClick={() => setColorMode('bw')}
                className={`p-3.5 rounded-2xl border-2 text-left flex flex-col justify-between min-h-[96px] transition cursor-pointer ${
                  colorMode === 'bw'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] text-[var(--ink)] shadow-sm'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-xl bg-neutral-900 border border-neutral-700 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    ⬛
                  </div>
                  {colorMode === 'bw' && (
                    <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">Black & White</div>
                  <div className="font-mono text-xs text-[var(--ink3)] mt-0.5">
                    {inr(pricing.bw_price_per_page || 2)} / page
                  </div>
                </div>
              </button>

              {/* Color Print Card */}
              <button
                type="button"
                disabled={isColorDisabled}
                onClick={() => {
                  if (!isColorDisabled) setColorMode('color');
                }}
                className={`relative p-3.5 rounded-2xl border-2 text-left flex flex-col justify-between min-h-[96px] transition cursor-pointer ${
                  isColorDisabled
                    ? 'border-[var(--rule2)] bg-[var(--sub)]/50 opacity-50 cursor-not-allowed text-[var(--ink4)]'
                    : colorMode === 'color'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] text-[var(--ink)] shadow-sm'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                {isColorDisabled && (
                  <span className="absolute -top-2.5 right-2 px-2 py-0.5 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] text-[10px] font-mono font-bold border border-[var(--danger-line)] shadow-xs">
                    Unavailable
                  </span>
                )}
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-rose-500 via-amber-400 to-blue-500 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    🎨
                  </div>
                  {!isColorDisabled && colorMode === 'color' && (
                    <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold flex items-center gap-1.5 text-[var(--ink)]">
                    <span>Color Print</span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  </div>
                  <div className="font-mono text-xs text-[var(--ink3)] mt-0.5">
                    {isColorDisabled ? 'Printer in maintenance' : `${inr(pricing.color_price_per_page || 10)} / page`}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Sides / Duplex: Large Visual Cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={EYEBROW} className="flex items-center gap-1">
                <span>Print Sides</span>
                <span className="text-[var(--danger)]">*</span>
              </label>
              {pricing.duplex_available && (
                <span className="text-[11px] font-mono text-[var(--ok)] font-medium">
                  {inr(colorMode === 'color' ? pricing.duplex_sheet_price_color : pricing.duplex_sheet_price_bw)} / sheet
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Single Sided Card */}
              <button
                type="button"
                onClick={() => setSides('single')}
                className={`p-3.5 rounded-2xl border-2 text-left flex flex-col justify-between min-h-[96px] transition cursor-pointer ${
                  sides === 'single'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] text-[var(--ink)] shadow-sm'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-xl bg-[var(--sub)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center text-sm shadow-xs">
                    📄
                  </div>
                  {sides === 'single' && (
                    <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">Single Sided</div>
                  <div className="font-mono text-xs text-[var(--ink3)] mt-0.5">1 page per sheet</div>
                </div>
              </button>

              {/* Front & Back (Duplex) Card */}
              <button
                type="button"
                disabled={isDuplexDisabled}
                onClick={() => {
                  if (!isDuplexDisabled) setSides('duplex');
                }}
                className={`relative p-3.5 rounded-2xl border-2 text-left flex flex-col justify-between min-h-[96px] transition cursor-pointer ${
                  isDuplexDisabled
                    ? 'border-[var(--rule2)] bg-[var(--sub)]/50 opacity-50 cursor-not-allowed text-[var(--ink4)]'
                    : sides === 'duplex'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)] text-[var(--ink)] shadow-sm'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                {isDuplexDisabled ? (
                  <span className="absolute -top-2.5 right-2 px-2 py-0.5 rounded-full bg-[var(--danger-soft)] text-[var(--danger)] text-[10px] font-mono font-bold border border-[var(--danger-line)] shadow-xs">
                    Unavailable
                  </span>
                ) : (
                  <span className="absolute -top-2.5 right-2 px-2 py-0.5 rounded-full bg-[var(--ok-soft)] text-[var(--ok)] text-[10px] font-mono font-bold border border-[var(--ok-line)] shadow-xs">
                    Saves Paper
                  </span>
                )}
                <div className="flex items-start justify-between">
                  <div className="w-8 h-8 rounded-xl bg-[var(--sub)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center text-sm shadow-xs">
                    📑
                  </div>
                  {!isDuplexDisabled && sides === 'duplex' && (
                    <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-[var(--ink)]">Front & Back</div>
                  <div className="font-mono text-xs text-[var(--ink3)] mt-0.5">Two-sided (Duplex)</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. Copies: Large Stepper with 1-Tap Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={EYEBROW}>Number of Copies</label>
              <span className="text-[11px] font-mono text-[var(--ink3)]">
                {copies} {copies > 1 ? 'sets' : 'set'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Stepper controls */}
              <div className="flex items-center rounded-2xl border-2 border-[var(--border)] bg-[var(--sub)] overflow-hidden shrink-0 self-start">
                <button
                  type="button"
                  disabled={copies <= 1}
                  onClick={() => setCopies((c) => Math.max(1, c - 1))}
                  className="w-12 h-12 flex items-center justify-center text-[var(--ink)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition disabled:opacity-30 cursor-pointer"
                  aria-label="Decrease copies"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-16 h-12 text-center font-mono font-black text-lg text-[var(--ink)] bg-transparent focus:outline-none"
                  aria-label="Copies input"
                />
                <button
                  type="button"
                  disabled={copies >= 500}
                  onClick={() => setCopies((c) => Math.min(500, c + 1))}
                  className="w-12 h-12 flex items-center justify-center text-[var(--ink)] hover:bg-[var(--rule)] active:bg-[var(--border)] transition disabled:opacity-30 cursor-pointer"
                  aria-label="Increase copies"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              {/* 1-Tap Preset Chips */}
              <div className="flex flex-wrap gap-1.5 items-center">
                {[1, 2, 3, 5, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setCopies(num)}
                    className={`px-3 py-2 rounded-xl border text-xs font-mono font-bold transition cursor-pointer ${
                      copies === num
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                    }`}
                  >
                    {num} {num > 1 ? 'copies' : 'copy'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Page Range: Visual Mode + Interactive Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label style={EYEBROW}>Pages to Print</label>
              <span className="text-[11px] font-mono text-[var(--accent)] font-bold">
                {effectivePagesCount} of {totalDocPages} pages
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-2.5">
              <button
                type="button"
                onClick={() => {
                  setRangeMode('all');
                  setCustomRange('');
                }}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold font-mono transition cursor-pointer ${
                  rangeMode === 'all'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] border-2'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                📄 All Pages (1 - {totalDocPages})
              </button>

              <button
                type="button"
                onClick={() => setRangeMode('custom')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold font-mono transition cursor-pointer ${
                  rangeMode === 'custom'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] border-2'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                🔢 Custom Range
              </button>
            </div>

            {/* Custom Range Sub-view with Visual Page Pills */}
            {rangeMode === 'custom' && (
              <div className="p-3 bg-[var(--sub)] rounded-2xl border border-[var(--border)] space-y-3">
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
                            onClick={() => handleTogglePagePill(pg)}
                            className={`w-8 h-8 rounded-lg text-xs font-mono font-bold border transition cursor-pointer ${
                              isIncluded
                                ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-xs'
                                : 'border-[var(--border)] bg-[var(--panel)] text-[var(--ink3)] hover:text-[var(--ink)]'
                            }`}
                          >
                            {pg}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick Selection Shortcuts */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-mono text-[var(--ink3)]">Quick:</span>
                  <button
                    type="button"
                    onClick={() => setCustomRange('1')}
                    className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    Page 1 Only
                  </button>
                  {totalDocPages >= 3 && (
                    <button
                      type="button"
                      onClick={() => setCustomRange('1-3')}
                      className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      Pages 1-3
                    </button>
                  )}
                  {totalDocPages >= 5 && (
                    <button
                      type="button"
                      onClick={() => setCustomRange('1-5')}
                      className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      Pages 1-5
                    </button>
                  )}
                  {totalDocPages >= 2 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const odds = Array.from({ length: totalDocPages }, (_, i) => i + 1).filter((p) => p % 2 !== 0);
                          setCustomRange(odds.join(', '));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                      >
                        Odd Pages
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const evens = Array.from({ length: totalDocPages }, (_, i) => i + 1).filter((p) => p % 2 === 0);
                          setCustomRange(evens.join(', '));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                      >
                        Even Pages
                      </button>
                    </>
                  )}
                </div>

                {/* Range Input Field */}
                <div>
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    placeholder="e.g. 1-5, 8, 11-14"
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  {customRange.trim() && (
                    <div className="flex items-center justify-between text-[11px] font-mono mt-1 text-[var(--ink3)]">
                      <span>{effectivePagesCount} pages selected</span>
                      {selectedPagesList.length > 0 && Math.max(...selectedPagesList) > totalDocPages && (
                        <span className="text-[var(--warn)] font-bold">
                          ⚠️ Clamped to max {totalDocPages} pages
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 5. Live Cost Calculation Card */}
          <div className="p-4 rounded-2xl bg-[var(--sub)] border-2 border-[var(--accent-line)] flex items-center justify-between">
            <div>
              <span style={EYEBROW} className="text-[var(--accent)] block">
                {applyToAll && files.length > 1 ? `Total for All ${files.length} Documents` : 'Live Cost Calculation'}
              </span>
              <p className="font-mono text-xs text-[var(--ink2)] mt-0.5">
                {calculatedEffectivePages} {calculatedEffectivePages === 1 ? 'page' : 'pages'} • {calculatedTotalSheets} {calculatedTotalSheets === 1 ? 'sheet' : 'sheets'} ({sides === 'duplex' ? 'Duplex' : 'Single'}) • {colorMode === 'color' ? 'Color' : 'B&W'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl sm:text-3xl font-black font-mono text-[var(--ink)]">
                {inr(calculatedTotalCost)}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Sticky Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-sm flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-bold text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--rule)] transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-3.5 px-5 rounded-xl font-bold text-sm bg-[var(--accent)] text-white hover:opacity-90 active:scale-[0.99] transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Apply & Proceed • {inr(calculatedTotalCost)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
