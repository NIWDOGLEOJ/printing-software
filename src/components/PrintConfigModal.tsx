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

export interface SinglePrintConfig {
  colorMode: ColorMode;
  sides: SidesMode;
  orientation: OrientationMode;
  copies: number;
  rangeMode: 'all' | 'custom';
  customRange: string;
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
    perFileConfigs?: Record<
      string,
      {
        colorMode: ColorMode;
        sides: SidesMode;
        orientation: OrientationMode;
        copies: number;
        pageRange: string;
      }
    >;
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
  const [fileConfigs, setFileConfigs] = useState<Record<string, SinglePrintConfig>>({});

  // Initialize or re-sync per-file configurations map when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const initialConfigs: Record<string, SinglePrintConfig> = {};
    for (const f of files) {
      const opts = f.customOptions;
      const activeRange = opts?.pageRange || masterPageRange || 'all';
      const isCustomRange = Boolean(activeRange && activeRange.toLowerCase() !== 'all');
      initialConfigs[f.id] = {
        colorMode: opts?.colorMode || masterColorMode || 'bw',
        sides: opts?.sides || masterSides || 'single',
        orientation: opts?.orientation || masterOrientation || 'auto',
        copies: opts?.copies || masterCopies || 1,
        rangeMode: isCustomRange ? 'custom' : 'all',
        customRange: isCustomRange ? activeRange : '',
      };
    }
    setFileConfigs(initialConfigs);

    const activeCfg = (activeFile && initialConfigs[activeFile.id]) || {
      colorMode: masterColorMode || 'bw',
      sides: masterSides || 'single',
      orientation: masterOrientation || 'auto',
      copies: masterCopies || 1,
      rangeMode: masterPageRange && masterPageRange !== 'all' ? 'custom' : 'all',
      customRange: masterPageRange && masterPageRange !== 'all' ? masterPageRange : '',
    };

    setColorMode(activeCfg.colorMode);
    setSides(activeCfg.sides);
    setOrientation(activeCfg.orientation);
    setCopies(activeCfg.copies);
    setRangeMode(activeCfg.rangeMode);
    setCustomRange(activeCfg.customRange);

    // Default applyToAll to true
    setApplyToAll(true);
  }, [isOpen]);

  // Adjust options if capabilities disable them
  useEffect(() => {
    if (pricing.color_available === false && colorMode === 'color') {
      updateOption('colorMode', 'bw');
    }
  }, [pricing.color_available, colorMode]);

  useEffect(() => {
    if (pricing.duplex_available === false && sides === 'duplex') {
      updateOption('sides', 'single');
    }
  }, [pricing.duplex_available, sides]);

  // Helper to switch active file tab without losing any tab's customizations
  const handleSelectFile = (fileId: string) => {
    onSelectActiveFile(fileId);
    const targetCfg = fileConfigs[fileId];
    if (targetCfg) {
      setColorMode(targetCfg.colorMode);
      setSides(targetCfg.sides);
      setOrientation(targetCfg.orientation);
      setCopies(targetCfg.copies);
      setRangeMode(targetCfg.rangeMode);
      setCustomRange(targetCfg.customRange);
    }
  };

  // Helper to mutate any option, keeping active view and fileConfigs in sync
  const updateOption = <K extends keyof SinglePrintConfig>(key: K, value: SinglePrintConfig[K]) => {
    if (key === 'colorMode') setColorMode(value as ColorMode);
    else if (key === 'sides') setSides(value as SidesMode);
    else if (key === 'orientation') setOrientation(value as OrientationMode);
    else if (key === 'copies') setCopies(value as number);
    else if (key === 'rangeMode') setRangeMode(value as 'all' | 'custom');
    else if (key === 'customRange') setCustomRange(value as string);

    setFileConfigs((prev) => {
      const next = { ...prev };
      const currentActiveId = activeFile?.id;
      if (applyToAll || files.length <= 1) {
        for (const f of files) {
          next[f.id] = {
            colorMode: key === 'colorMode' ? (value as ColorMode) : (next[f.id]?.colorMode ?? colorMode),
            sides: key === 'sides' ? (value as SidesMode) : (next[f.id]?.sides ?? sides),
            orientation: key === 'orientation' ? (value as OrientationMode) : (next[f.id]?.orientation ?? orientation),
            copies: key === 'copies' ? (value as number) : (next[f.id]?.copies ?? copies),
            rangeMode: key === 'rangeMode' ? (value as 'all' | 'custom') : (next[f.id]?.rangeMode ?? rangeMode),
            customRange: key === 'customRange' ? (value as string) : (next[f.id]?.customRange ?? customRange),
          };
        }
      } else if (currentActiveId) {
        next[currentActiveId] = {
          colorMode: key === 'colorMode' ? (value as ColorMode) : (next[currentActiveId]?.colorMode ?? colorMode),
          sides: key === 'sides' ? (value as SidesMode) : (next[currentActiveId]?.sides ?? sides),
          orientation: key === 'orientation' ? (value as OrientationMode) : (next[currentActiveId]?.orientation ?? orientation),
          copies: key === 'copies' ? (value as number) : (next[currentActiveId]?.copies ?? copies),
          rangeMode: key === 'rangeMode' ? (value as 'all' | 'custom') : (next[currentActiveId]?.rangeMode ?? rangeMode),
          customRange: key === 'customRange' ? (value as string) : (next[currentActiveId]?.customRange ?? customRange),
        };
      }
      return next;
    });
  };

  const handleToggleApplyToAll = (checked: boolean) => {
    setApplyToAll(checked);
    if (checked) {
      setFileConfigs((prev) => {
        const next = { ...prev };
        for (const f of files) {
          next[f.id] = {
            colorMode,
            sides,
            orientation,
            copies,
            rangeMode,
            customRange,
          };
        }
        return next;
      });
    }
  };

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

  // Live Cost Calculations across all files or active file
  let calculatedTotalCost = 0;
  let calculatedTotalSheets = 0;
  let calculatedEffectivePages = 0;

  for (const item of files) {
    const itemPages = item.detectedPages || 1;
    let itemColor = colorMode;
    let itemSides = sides;
    let itemCopies = copies;
    let itemRange = activePageRange;

    if (!applyToAll && files.length > 1 && fileConfigs[item.id]) {
      const cfg = fileConfigs[item.id];
      itemColor = cfg.colorMode;
      itemSides = cfg.sides;
      itemCopies = cfg.copies;
      itemRange = cfg.rangeMode === 'all' ? 'all' : (cfg.customRange.trim() || 'all');
    }

    const res = calculatePrintCost({
      totalPages: itemPages,
      pageRange: itemRange,
      colorMode: itemColor,
      sides: itemSides,
      copies: itemCopies,
      pricing,
    });
    calculatedTotalCost += res.totalCost;
    calculatedTotalSheets += res.sheets * itemCopies;
    calculatedEffectivePages += res.effectivePages * itemCopies;
  }

  // Quick page toggle helper for interactive pill selector
  const handleTogglePagePill = (pageNum: number) => {
    const currentList = parsePageRange(rangeMode === 'all' ? 'all' : (customRange.trim() || 'all'), totalDocPages);
    let newList: number[];
    if (currentList.includes(pageNum)) {
      newList = currentList.filter((p) => p !== pageNum);
    } else {
      newList = [...currentList, pageNum].sort((a, b) => a - b);
    }

    if (newList.length === 0) {
      updateOption('rangeMode', 'custom');
      updateOption('customRange', `${pageNum}`);
      return;
    }
    if (newList.length === totalDocPages) {
      updateOption('rangeMode', 'all');
      updateOption('customRange', '');
      return;
    }

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
    updateOption('rangeMode', 'custom');
    updateOption('customRange', parts.join(', '));
  };

  const handleConfirm = () => {
    const finalRange = rangeMode === 'all' ? 'all' : (customRange.trim() || 'all');
    const isAll = Boolean(applyToAll || files.length <= 1);

    const perFileExport: Record<
      string,
      {
        colorMode: ColorMode;
        sides: SidesMode;
        orientation: OrientationMode;
        copies: number;
        pageRange: string;
      }
    > = {};

    for (const item of files) {
      if (isAll) {
        perFileExport[item.id] = {
          colorMode,
          sides,
          orientation,
          copies,
          pageRange: finalRange,
        };
      } else {
        const cfg = fileConfigs[item.id] || {
          colorMode,
          sides,
          orientation,
          copies,
          rangeMode,
          customRange,
        };
        perFileExport[item.id] = {
          colorMode: cfg.colorMode,
          sides: cfg.sides,
          orientation: cfg.orientation,
          copies: cfg.copies,
          pageRange: cfg.rangeMode === 'all' ? 'all' : (cfg.customRange.trim() || 'all'),
        };
      }
    }

    onApply({
      colorMode,
      sides,
      orientation,
      copies,
      pageRange: finalRange,
      applyToAll: isAll,
      targetFileId: activeFile?.id,
      perFileConfigs: perFileExport,
    });
    onClose();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
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
                      onClick={() => handleSelectFile(f.id)}
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
                  onChange={(e) => handleToggleApplyToAll(e.target.checked)}
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
                onClick={() => updateOption('colorMode', 'bw')}
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
                  if (!isColorDisabled) updateOption('colorMode', 'color');
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
                onClick={() => updateOption('sides', 'single')}
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
                  if (!isDuplexDisabled) updateOption('sides', 'duplex');
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
                  onClick={() => updateOption('copies', Math.max(1, copies - 1))}
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
                  onChange={(e) => updateOption('copies', Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-16 h-12 text-center font-mono font-black text-lg text-[var(--ink)] bg-transparent focus:outline-none"
                  aria-label="Copies input"
                />
                <button
                  type="button"
                  disabled={copies >= 500}
                  onClick={() => updateOption('copies', Math.min(500, copies + 1))}
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
                    onClick={() => updateOption('copies', num)}
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
                  updateOption('rangeMode', 'all');
                  updateOption('customRange', '');
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
                onClick={() => updateOption('rangeMode', 'custom')}
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
                    onClick={() => {
                      updateOption('rangeMode', 'custom');
                      updateOption('customRange', '1');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    Page 1 Only
                  </button>
                  {totalDocPages >= 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        updateOption('rangeMode', 'custom');
                        updateOption('customRange', '1-3');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      Pages 1-3
                    </button>
                  )}
                  {totalDocPages >= 5 && (
                    <button
                      type="button"
                      onClick={() => {
                        updateOption('rangeMode', 'custom');
                        updateOption('customRange', '1-5');
                      }}
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
                          updateOption('rangeMode', 'custom');
                          updateOption('customRange', odds.join(', '));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--ink2)] hover:text-[var(--ink)] cursor-pointer"
                      >
                        Odd Pages
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const evens = Array.from({ length: totalDocPages }, (_, i) => i + 1).filter((p) => p % 2 === 0);
                          updateOption('rangeMode', 'custom');
                          updateOption('customRange', evens.join(', '));
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
                    onChange={(e) => updateOption('customRange', e.target.value)}
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
                {files.length > 1 ? `Total for All ${files.length} Documents` : 'Live Cost Calculation'}
              </span>
              <p className="font-mono text-xs text-[var(--ink2)] mt-0.5">
                {files.length > 1
                  ? `${files.length} documents • ${calculatedEffectivePages} pages (${calculatedTotalSheets} ${calculatedTotalSheets === 1 ? 'sheet' : 'sheets'})${applyToAll ? ` • ${colorMode === 'color' ? 'Color' : 'B&W'} • ${sides === 'duplex' ? 'Duplex' : 'Single'}` : ' • Customized individually'}`
                  : `${effectivePagesCount} ${effectivePagesCount === 1 ? 'page' : 'pages'} (${calculatedTotalSheets} ${calculatedTotalSheets === 1 ? 'sheet' : 'sheets'}) • ${colorMode === 'color' ? 'Color' : 'B&W'} • ${sides === 'duplex' ? 'Duplex' : 'Single'}${copies > 1 ? ` × ${copies} copies` : ''}`}
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
