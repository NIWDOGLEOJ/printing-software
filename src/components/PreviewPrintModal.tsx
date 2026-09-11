import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Printer,
  Trash2,
  Download,
  ExternalLink,
  RotateCcw,
  Check,
  AlertCircle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
} from 'lucide-react';
import {
  PrintJob,
  PrinterInfo,
  PricingSettings,
  ColorMode,
  SidesMode,
  OrientationMode,
  PrinterProfile,
} from '../types.js';
import { printJob, updateJob, fetchPrinters } from '../api.js';
import { calculatePrintCost, findOptimalPrinter } from '../utils/costCalculator.js';
import { formatCurrency, formatFileSize, formatRelativeTime } from '../utils/formatters.js';

interface PreviewPrintModalProps {
  job: PrintJob;
  printers: PrinterInfo[];
  pricing: PricingSettings;
  printerProfiles?: PrinterProfile[];
  onClose: () => void;
  onJobUpdated: (job: PrintJob) => void;
  onJobDeleted: (id: string) => void;
  onRefreshPrinters: () => void;
}

export const PreviewPrintModal: React.FC<PreviewPrintModalProps> = ({
  job,
  printers,
  pricing,
  printerProfiles = [],
  onClose,
  onJobUpdated,
  onJobDeleted,
  onRefreshPrinters,
}) => {
  const [colorMode, setColorMode] = useState<ColorMode>(job.color_mode);
  const [sides, setSides] = useState<SidesMode>(job.sides);
  const [orientation, setOrientation] = useState<OrientationMode>(job.orientation);
  const [copies, setCopies] = useState<number>(job.copies);
  const [pageRange, setPageRange] = useState<string>(job.page_range || 'all');
  const [isManualOverride, setIsManualOverride] = useState(false);

  // Smart Routing: compute optimal printer matching current color mode and lowest rate
  const optimalPrinter = useMemo(() => {
    return findOptimalPrinter({
      colorMode,
      sides,
      profiles: printerProfiles,
      printers,
    });
  }, [colorMode, sides, printerProfiles, printers]);

  // Selected options state (admin can adjust before printing)
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => {
    if (job.printer_name) return job.printer_name;
    if (optimalPrinter) return optimalPrinter;
    const def = printers.find((p) => p.isDefault);
    return def ? def.name : printers[0]?.name || '';
  });

  // Execution states
  const [isPrinting, setIsPrinting] = useState(false);
  const [printSuccessMsg, setPrintSuccessMsg] = useState<string | null>(null);
  const [printErrorMsg, setPrintErrorMsg] = useState<string | null>(null);

  // Document viewer states
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  const isPdf = job.mime_type === 'application/pdf' || job.original_filename.toLowerCase().endsWith('.pdf');
  const fileUrl = `/api/jobs/${job.id}/file`;

  // Synchronize when job changes
  useEffect(() => {
    setColorMode(job.color_mode);
    setSides(job.sides);
    setOrientation(job.orientation);
    setCopies(job.copies);
    setPageRange(job.page_range || 'all');
    setPrintSuccessMsg(null);
    setPrintErrorMsg(null);
    setIsManualOverride(false);

    if (job.printer_name) {
      setSelectedPrinter(job.printer_name);
    } else if (optimalPrinter) {
      setSelectedPrinter(optimalPrinter);
    } else {
      const def = printers.find((p) => p.isDefault);
      if (def) setSelectedPrinter(def.name);
    }
  }, [job.id, printers]);

  // Auto-switch to optimal printer if options change and admin hasn't manually chosen a specific printer
  useEffect(() => {
    if (!isManualOverride && optimalPrinter && optimalPrinter !== selectedPrinter) {
      setSelectedPrinter(optimalPrinter);
    }
  }, [optimalPrinter, isManualOverride]);

  // Recalculate cost dynamically if admin modifies settings
  const liveCost = calculatePrintCost({
    totalPages: job.page_count,
    pageRange,
    colorMode,
    sides,
    copies,
    pricing,
  });

  // Handle printing
  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintSuccessMsg(null);
    setPrintErrorMsg(null);

    try {
      const res = await printJob(job.id, {
        printerName: selectedPrinter,
        colorMode,
        sides,
        orientation,
        copies,
        pageRange,
      });

      setPrintSuccessMsg(res.message);
      if (res.job) {
        onJobUpdated(res.job);
      }
    } catch (err: any) {
      setPrintErrorMsg(err.message || 'Failed to dispatch print job.');
    } finally {
      setIsPrinting(false);
    }
  };

  // Toggle status
  const handleToggleStatus = async () => {
    const nextStatus = job.status === 'printed' ? 'pending' : 'printed';
    try {
      const updated = await updateJob(job.id, { status: nextStatus });
      onJobUpdated(updated);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-6xl h-[92vh] rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-3.5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono font-black text-sm px-3 py-1 rounded-xl bg-[var(--accent)] text-white shadow-xs shrink-0">
              {job.token}
            </span>
            <div className="truncate">
              <h2 className="font-bold text-[var(--ink)] text-base truncate flex items-center gap-2">
                <span>{job.customer_name}</span>
                <span className="text-xs font-mono font-normal text-[var(--ink3)]">({job.original_filename})</span>
              </h2>
              <p className="font-mono text-[11px] text-[var(--ink4)]">
                Uploaded {formatRelativeTime(job.created_at)} • {formatFileSize(job.file_size)} • {job.page_count} pages
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              title="Open document in new browser tab"
              className="p-2 rounded-xl text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href={fileUrl}
              download={job.original_filename}
              title="Download file"
              className="p-2 rounded-xl text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              title="Close Preview (Esc)"
              className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body (Split View) */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left / Center: Document Viewer */}
          <div className="flex-1 bg-[var(--bg)] relative flex flex-col overflow-hidden">
            {/* Viewer controls bar */}
            <div className="bg-[var(--sub)] px-4 py-2 text-[var(--ink3)] text-xs flex items-center justify-between border-b border-[var(--rule)] font-mono">
              <span className="truncate max-w-sm font-medium text-[var(--ink2)]">{job.original_filename}</span>
              <div className="flex items-center gap-2">
                {!isPdf && (
                  <>
                    <button
                      onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
                      className="p-1 hover:bg-[var(--panel)] rounded text-[var(--ink2)]"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-mono">{zoomLevel}%</span>
                    <button
                      onClick={() => setZoomLevel((z) => Math.min(300, z + 25))}
                      className="p-1 hover:bg-[var(--panel)] rounded text-[var(--ink2)]"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setZoomLevel(100)}
                      className="p-1 hover:bg-[var(--panel)] rounded ml-1 text-[var(--ink2)]"
                      title="Reset Zoom"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Document Content View */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-4">
              {isPdf ? (
                <iframe
                  src={`${fileUrl}#toolbar=1&navpanes=1`}
                  className="w-full h-full rounded-lg bg-white border-0 shadow-lg"
                  title="PDF Preview"
                />
              ) : (
                <div className="overflow-auto max-h-full max-w-full flex items-center justify-center">
                  <img
                    src={fileUrl}
                    alt={job.original_filename}
                    style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'center center' }}
                    className="max-h-[80vh] max-w-full object-contain rounded shadow-lg transition-transform duration-100"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: Print & Admin Control Panel */}
          <div className="w-full md:w-96 bg-[var(--panel)] border-l border-[var(--border)] flex flex-col justify-between overflow-y-auto p-5">
            <div className="space-y-4">
              {/* Messages / Alerts */}
              {printSuccessMsg && (
                <div className="p-3 bg-[var(--ok-soft)] border border-[var(--ok-line)] rounded-xl text-xs text-[var(--ok)] font-medium flex items-start gap-2 animate-in fade-in">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)] mt-1.5 shrink-0" />
                  <span>{printSuccessMsg}</span>
                </div>
              )}

              {printErrorMsg && (
                <div className="p-3 bg-[var(--danger-soft)] border border-[var(--danger-line)] rounded-xl text-xs text-[var(--danger)] font-medium flex items-start gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0 mt-0.5" />
                  <span>{printErrorMsg}</span>
                </div>
              )}

              {/* Printer Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="dc-eyebrow text-[var(--ink3)] flex items-center gap-1.5">
                      <Printer className="w-3.5 h-3.5 text-[var(--accent)]" /> Target Network Printer
                    </label>
                    {selectedPrinter === optimalPrinter && optimalPrinter ? (
                      <span className="text-[10px] text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] px-2 py-0.5 rounded-full font-mono font-bold flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Smart Routed
                      </span>
                    ) : (
                      optimalPrinter && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsManualOverride(false);
                            setSelectedPrinter(optimalPrinter);
                          }}
                          className="text-[10px] text-[var(--accent)] hover:underline font-mono font-bold cursor-pointer"
                        >
                          Auto-Route to Lowest
                        </button>
                      )
                    )}
                  </div>
                  <button
                    onClick={onRefreshPrinters}
                    title="Refresh printers"
                    className="text-[11px] text-[var(--accent)] font-mono hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                <select
                  value={selectedPrinter}
                  onChange={(e) => {
                    setSelectedPrinter(e.target.value);
                    setIsManualOverride(true);
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] font-mono font-bold text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                >
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.isDefault ? '(Default)' : ''} [{p.status}]
                    </option>
                  ))}
                </select>
                <p className="text-[11px] font-mono text-[var(--ink4)] mt-1">
                  CUPS auto-discovers network printers (e.g. Canon, HP, Epson).
                </p>
              </div>

              {/* Print Preferences (Admin overrides) */}
              <div className="border-t border-[var(--rule)] pt-3 space-y-3">
                <span className="dc-eyebrow text-[var(--ink3)] block">
                  Print Settings
                </span>

                {/* Color Mode */}
                <div>
                  <label className="block text-xs font-mono text-[var(--ink2)] mb-1">Color Mode</label>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <button
                      type="button"
                      onClick={() => setColorMode('bw')}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                        colorMode === 'bw'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
                          : 'bg-[var(--sub)] text-[var(--ink2)] border-[var(--border)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      B&W (Gray)
                    </button>
                    <button
                      type="button"
                      onClick={() => setColorMode('color')}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                        colorMode === 'color'
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
                          : 'bg-[var(--sub)] text-[var(--ink2)] border-[var(--border)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      Color (RGB)
                    </button>
                  </div>
                </div>

                {/* Duplex / Sides */}
                <div>
                  <label className="block text-xs font-mono text-[var(--ink2)] mb-1">Sides</label>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    <button
                      type="button"
                      onClick={() => setSides('single')}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                        sides === 'single'
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2'
                          : 'bg-[var(--sub)] border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      Single-sided
                    </button>
                    <button
                      type="button"
                      onClick={() => setSides('duplex')}
                      className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                        sides === 'duplex'
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] border-2'
                          : 'bg-[var(--sub)] border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--rule)]'
                      }`}
                    >
                      Duplex (2-sided)
                    </button>
                  </div>
                </div>

                {/* Copies & Orientation */}
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div>
                    <label className="block text-xs text-[var(--ink2)] mb-1">Copies</label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={copies}
                      onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full py-1.5 px-3 rounded-lg border border-[var(--border)] bg-[var(--sub)] text-[var(--ink)] font-bold text-sm focus:border-[var(--accent)] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--ink2)] mb-1">Orientation</label>
                    <select
                      value={orientation}
                      onChange={(e) => setOrientation(e.target.value as OrientationMode)}
                      className="w-full py-1.5 px-2 rounded-lg border border-[var(--border)] bg-[var(--sub)] text-[var(--ink)] text-xs font-semibold focus:border-[var(--accent)] focus:outline-none"
                    >
                      <option value="auto">Auto</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>

                {/* Page Range */}
                <div>
                  <label className="block text-xs font-mono text-[var(--ink2)] mb-1">Page Range</label>
                  <input
                    type="text"
                    value={pageRange}
                    onChange={(e) => setPageRange(e.target.value)}
                    placeholder="all or 1-3, 5"
                    className="w-full py-1.5 px-3 rounded-lg border border-[var(--border)] bg-[var(--sub)] text-[var(--ink)] font-mono text-xs focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Price & Specs Summary Box */}
              <div className="bg-[var(--sub)] p-3.5 rounded-xl border border-[var(--border)] text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-[var(--ink3)]">
                  <span>Document Pages:</span>
                  <span className="font-semibold text-[var(--ink)]">{job.page_count}</span>
                </div>
                <div className="flex justify-between text-[var(--ink3)]">
                  <span>Effective Sheets:</span>
                  <span className="font-semibold text-[var(--ink)]">{liveCost.sheets} sheet(s)</span>
                </div>
                <div className="flex justify-between text-[var(--ink3)]">
                  <span className="dc-eyebrow">Total Calculated:</span>
                  <span className="dc-mono font-black text-[var(--ink)] text-sm">{formatCurrency(liveCost.totalCost)}</span>
                </div>
                {job.cups_job_id && (
                  <div className="flex justify-between text-[11px] text-[var(--ink4)] pt-1 border-t border-[var(--rule)] font-mono">
                    <span>CUPS Job ID:</span>
                    <span className="truncate max-w-[150px]">{job.cups_job_id}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="space-y-2 pt-4 border-t border-[var(--rule)]">
              {/* Primary Print / Reprint Button */}
              <button
                onClick={handlePrint}
                disabled={isPrinting}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white bg-[var(--accent)] hover:opacity-90 shadow-md disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {isPrinting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Dispatching to Printer...
                  </>
                ) : job.status === 'printed' ? (
                  <>
                    <RotateCcw className="w-4 h-4" /> Reprint Now • {formatCurrency(liveCost.totalCost)}
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" /> Print Now • {formatCurrency(liveCost.totalCost)}
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition ${
                    job.status === 'printed'
                      ? 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)] hover:opacity-90'
                      : 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)] hover:opacity-90'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{job.status === 'printed' ? 'Mark Pending' : 'Mark Printed'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete document job for ${job.customer_name}?`)) {
                      onJobDeleted(job.id);
                      onClose();
                    }
                  }}
                  className="py-2 px-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] hover:opacity-90 text-[var(--danger)] text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
