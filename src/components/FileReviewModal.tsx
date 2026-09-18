import React, { useState, useEffect } from 'react';
import { JobFile, PrintJob, PrinterInfo, ColorMode, SidesMode, OrientationMode, EffectivePricing, PricingSettings } from '../types.js';
import { getFilePreviewUrl, printJobFile, updateJobFileOptions } from '../api.js';
import { calculatePrintCost } from '../../shared/costCalculator.js';
import {
  MONO,
  NUM,
  EYEBROW,
  PANEL,
  FIELD,
  BTN_ACCENT,
  BTN_SECONDARY,
  CHIP,
  inr,
} from '../lib/design-system.js';

interface FileReviewModalProps {
  job: PrintJob;
  file: JobFile;
  printers: PrinterInfo[];
  pricing: PricingSettings | EffectivePricing;
  onClose: () => void;
  onFileUpdated?: (updatedJob: PrintJob) => void;
}

export const FileReviewModal: React.FC<FileReviewModalProps> = ({
  job,
  file,
  printers,
  pricing,
  onClose,
  onFileUpdated,
}) => {
  const [colorMode, setColorMode] = useState<ColorMode>(file.color_mode);
  const [sides, setSides] = useState<SidesMode>(file.sides);
  const [orientation, setOrientation] = useState<OrientationMode>(file.orientation);
  const [copies, setCopies] = useState<number>(file.copies || 1);
  const [pageRange, setPageRange] = useState<string>(file.page_range || 'all');
  const [selectedPrinter, setSelectedPrinter] = useState<string>(
    job.printer_name || printers.find((p) => p.isDefault)?.name || printers[0]?.name || ''
  );

  const [isPrinting, setIsPrinting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Synchronize with active capability limits
  useEffect(() => {
    if (!pricing.color_available && colorMode === 'color') {
      setColorMode('bw');
    }
    if (!pricing.duplex_available && sides === 'duplex') {
      setSides('single');
    }
  }, [pricing]);

  // Recalculate cost dynamically for this file
  const costEst = calculatePrintCost({
    totalPages: file.page_count,
    pageRange,
    colorMode,
    sides,
    copies,
    pricing,
  });

  const previewUrl = getFilePreviewUrl(job.id, file.id);
  const isPdf = file.mime_type.includes('pdf') || file.original_filename.toLowerCase().endsWith('.pdf');
  const isImage = file.mime_type.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(file.original_filename);

  const handleSaveOptions = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await updateJobFileOptions(job.id, file.id, {
        color_mode: colorMode,
        sides,
        orientation,
        copies,
        page_range: pageRange,
      });
      if (res.success && res.job && onFileUpdated) {
        onFileUpdated(res.job);
      }
      setStatusMessage({ type: 'success', text: 'Document options updated successfully.' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrintFile = async () => {
    setIsPrinting(true);
    setStatusMessage(null);
    try {
      const res = await printJobFile(file.id, {
        printerName: selectedPrinter,
        copies,
        colorMode,
        sides,
        orientation,
        pageRange,
      });
      if (res.success && res.job && onFileUpdated) {
        onFileUpdated(res.job);
      }
      setStatusMessage({ type: 'success', text: `Printed: ${res.message}` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to print document.' });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      <div
        className="relative rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        style={{
          ...PANEL,
          boxShadow: '0 12px 40px var(--paper-shadow)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between border-b shrink-0"
          style={{
            background: 'var(--sub)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 border"
              style={{
                background: 'var(--panel)',
                borderColor: 'var(--border2)',
              }}
            >
              {isPdf ? '📄' : isImage ? '🖼️' : '📁'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[var(--ink)] truncate" title={file.original_filename}>
                  {file.original_filename}
                </h3>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-mono font-medium shrink-0"
                  style={CHIP.neutral}
                >
                  #{file.file_index + 1}
                </span>
                {file.status === 'printed' ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0"
                    style={CHIP.ok}
                  >
                    ✓ Printed
                  </span>
                ) : (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0"
                    style={CHIP.warn}
                  >
                    Pending
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 truncate text-[var(--ink3)]">
                Order: <span className="font-mono font-semibold text-[var(--ink)]">{job.token}</span> • Customer:{' '}
                <span className="font-medium text-[var(--ink)]">{job.customer_name}</span> • Size:{' '}
                {(file.file_size / 1024).toFixed(1)} KB • {file.page_count} page{file.page_count > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
              style={{
                ...FIELD,
                color: 'var(--ink)',
              }}
              title="Open raw file in new tab"
            >
              <span>↗</span> Open New Tab
            </a>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm transition cursor-pointer"
              style={{
                ...FIELD,
                color: 'var(--ink2)',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            className="px-6 py-2.5 text-xs font-medium flex items-center justify-between border-b"
            style={
              statusMessage.type === 'success'
                ? { background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'var(--ok-line)' }
                : { background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'var(--danger-line)' }
            }
          >
            <span>{statusMessage.text}</span>
            <button onClick={() => setStatusMessage(null)} className="text-xs font-bold opacity-70 hover:opacity-100 cursor-pointer">
              ✕
            </button>
          </div>
        )}

        {/* Content Body: Split view Preview (Left) + Options (Right) */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Document Preview Pane */}
          <div
            className="flex-1 p-4 flex items-center justify-center overflow-auto border-b md:border-b-0 md:border-r"
            style={{
              background: 'var(--bg)',
              borderColor: 'var(--border)',
            }}
          >
            {isPdf ? (
              <iframe
                src={`${previewUrl}#toolbar=1&view=FitH`}
                title={file.original_filename}
                className="w-full h-full rounded-xl border shadow-sm"
                style={{
                  borderColor: 'var(--border2)',
                  background: 'var(--panel)',
                }}
              />
            ) : isImage ? (
              <div className="max-w-full max-h-full flex items-center justify-center p-2">
                <img
                  src={previewUrl}
                  alt={file.original_filename}
                  className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-lg border"
                  style={{
                    borderColor: 'var(--border2)',
                    background: 'var(--panel)',
                  }}
                />
              </div>
            ) : (
              <div
                className="text-center p-8 rounded-2xl border shadow-sm max-w-sm"
                style={{
                  ...PANEL,
                  padding: 24,
                }}
              >
                <div className="text-4xl mb-3">📁</div>
                <h4 className="text-sm font-bold text-[var(--ink)] mb-1">Preview not supported inline</h4>
                <p className="text-xs text-[var(--ink3)] mb-4">
                  This file format cannot be rendered directly in the viewer.
                </p>
                <a
                  href={previewUrl}
                  download={file.original_filename}
                  className="inline-block px-4 py-2 text-xs font-bold rounded-xl transition"
                  style={{
                    ...BTN_ACCENT,
                    height: 36,
                    lineHeight: '36px',
                  }}
                >
                  Download to Inspect
                </a>
              </div>
            )}
          </div>

          {/* Document Print Options Pane */}
          <div
            className="w-full md:w-84 p-5 flex flex-col justify-between overflow-y-auto shrink-0 border-l"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="space-y-4">
              <div>
                <div style={EYEBROW} className="mb-3">
                  Print Configuration
                </div>

                {/* Color Mode */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-[var(--ink2)]">Color Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setColorMode('bw')}
                      className="px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer"
                      style={
                        colorMode === 'bw'
                          ? { background: 'var(--ink)', color: 'var(--panel)', borderColor: 'var(--ink)' }
                          : { ...FIELD, color: 'var(--ink)' }
                      }
                    >
                      B/W ({inr(pricing.bw_price_per_page)}/p)
                    </button>
                    <button
                      type="button"
                      disabled={!pricing.color_available}
                      onClick={() => setColorMode('color')}
                      className="px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={
                        colorMode === 'color'
                          ? { background: 'var(--accent)', color: 'var(--primary-foreground)', borderColor: 'var(--accent)' }
                          : { ...FIELD, color: 'var(--ink)' }
                      }
                    >
                      Color ({inr(pricing.color_price_per_page)}/p)
                    </button>
                  </div>
                </div>

                {/* Sides */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-[var(--ink2)]">Print Sides</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSides('single')}
                      className="px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer"
                      style={
                        sides === 'single'
                          ? { background: 'var(--ink)', color: 'var(--panel)', borderColor: 'var(--ink)' }
                          : { ...FIELD, color: 'var(--ink)' }
                      }
                    >
                      Single Side
                    </button>
                    <button
                      type="button"
                      disabled={!pricing.duplex_available}
                      onClick={() => setSides('duplex')}
                      className="px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      style={
                        sides === 'duplex'
                          ? { background: 'var(--ink)', color: 'var(--panel)', borderColor: 'var(--ink)' }
                          : { ...FIELD, color: 'var(--ink)' }
                      }
                    >
                      Front & Back
                    </button>
                  </div>
                </div>

                {/* Orientation */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-[var(--ink2)]">Orientation</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['portrait', 'landscape', 'auto'] as OrientationMode[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setOrientation(o)}
                        className="py-1.5 text-xs font-bold rounded-lg border capitalize transition cursor-pointer"
                        style={
                          orientation === o
                            ? { background: 'var(--ink)', color: 'var(--panel)', borderColor: 'var(--ink)' }
                            : { ...FIELD, color: 'var(--ink2)' }
                        }
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Copies & Page Range */}
                <div className="grid grid-cols-2 gap-2 mb-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--ink2)] mb-1">Copies</label>
                    <div className="flex items-center rounded-xl overflow-hidden" style={FIELD}>
                      <button
                        type="button"
                        onClick={() => setCopies(Math.max(1, copies - 1))}
                        className="px-2.5 py-1.5 font-bold text-sm transition cursor-pointer hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={copies}
                        onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full text-center text-xs font-bold py-1.5 focus:outline-none bg-transparent"
                        style={{ ...NUM, color: 'var(--ink)' }}
                      />
                      <button
                        type="button"
                        onClick={() => setCopies(copies + 1)}
                        className="px-2.5 py-1.5 font-bold text-sm transition cursor-pointer hover:opacity-80"
                        style={{ color: 'var(--ink)' }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--ink2)] mb-1">Page Range</label>
                    <input
                      type="text"
                      placeholder="all (e.g. 1-3)"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-medium rounded-xl focus:border-[var(--accent)]"
                      style={{ ...FIELD, ...NUM }}
                    />
                  </div>
                </div>

                {/* Target Printer Destination */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-[var(--ink2)]">Target Printer</label>
                  <select
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-medium rounded-xl focus:border-[var(--accent)] cursor-pointer"
                    style={{ ...FIELD, color: 'var(--ink)' }}
                  >
                    {printers.map((p) => (
                      <option key={p.name} value={p.name} style={{ background: 'var(--panel)', color: 'var(--ink)' }}>
                        {p.name} {p.isDefault ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cost Summary Box */}
              <div
                className="p-3.5 rounded-xl border"
                style={{
                  background: 'var(--sub)',
                  borderColor: 'var(--border2)',
                }}
              >
                <div className="flex items-center justify-between text-xs text-[var(--ink3)] mb-1">
                  <span>Document Cost</span>
                  <span className="font-mono text-[var(--ink2)]" style={NUM}>{costEst.breakdownText}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--ink)]">Calculated Price</span>
                  <span className="text-lg font-black" style={{ ...NUM, color: 'var(--ok)' }}>
                    {inr(costEst.totalCost)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t space-y-2" style={{ borderColor: 'var(--rule2)' }}>
              <button
                type="button"
                disabled={isPrinting}
                onClick={handlePrintFile}
                className="w-full flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                style={{
                  ...BTN_ACCENT,
                  height: 44,
                }}
              >
                {isPrinting ? (
                  <span>Printing document...</span>
                ) : (
                  <>
                    <span>🖨️</span>
                    <span>Print This Document</span>
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSaveOptions}
                  className="transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-50"
                  style={{
                    ...BTN_SECONDARY,
                    height: 38,
                    fontSize: 12,
                  }}
                >
                  {isSaving ? 'Saving...' : 'Save Options'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="transition-all hover:opacity-90 active:scale-[0.99]"
                  style={{
                    ...BTN_SECONDARY,
                    height: 38,
                    fontSize: 12,
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
