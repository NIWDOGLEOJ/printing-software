import React, { useState, useEffect } from 'react';
import { JobFile, PrintJob, PrinterInfo, ColorMode, SidesMode, OrientationMode, EffectivePricing, PricingSettings } from '../types.js';
import { getFilePreviewUrl, printJobFile, updateJobFileOptions } from '../api.js';
import { calculatePrintCost } from '../../shared/costCalculator.js';

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-lg shrink-0">
              {isPdf ? '📄' : isImage ? '🖼️' : '📁'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 truncate" title={file.original_filename}>
                  {file.original_filename}
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono font-medium shrink-0">
                  #{file.file_index + 1}
                </span>
                {file.status === 'printed' ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold shrink-0">
                    ✓ Printed
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0">
                    Pending
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                Order: <span className="font-mono font-semibold text-slate-700">{job.token}</span> • Customer:{' '}
                <span className="font-medium text-slate-700">{job.customer_name}</span> • Size:{' '}
                {(file.file_size / 1024).toFixed(1)} KB • {file.page_count} page{file.page_count > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition flex items-center gap-1.5"
              title="Open raw file in new tab"
            >
              <span>↗</span> Open New Tab
            </a>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center font-bold text-sm transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            className={`px-6 py-2.5 text-xs font-medium flex items-center justify-between ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-b border-rose-200'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button onClick={() => setStatusMessage(null)} className="text-xs font-bold opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* Content Body: Split view Preview (Left) + Options (Right) */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Document Preview Pane */}
          <div className="flex-1 bg-slate-900/5 p-4 flex items-center justify-center overflow-auto border-b md:border-b-0 md:border-r border-slate-200">
            {isPdf ? (
              <iframe
                src={`${previewUrl}#toolbar=1&view=FitH`}
                title={file.original_filename}
                className="w-full h-full rounded-xl border border-slate-300 bg-white shadow-sm"
              />
            ) : isImage ? (
              <div className="max-w-full max-h-full flex items-center justify-center p-2">
                <img
                  src={previewUrl}
                  alt={file.original_filename}
                  className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-lg border border-slate-200 bg-white"
                />
              </div>
            ) : (
              <div className="text-center p-8 bg-white rounded-2xl border border-slate-200 shadow-sm max-w-sm">
                <div className="text-4xl mb-3">📁</div>
                <h4 className="text-sm font-bold text-slate-800 mb-1">Preview not supported inline</h4>
                <p className="text-xs text-slate-500 mb-4">
                  This file format cannot be rendered directly in the viewer.
                </p>
                <a
                  href={previewUrl}
                  download={file.original_filename}
                  className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition"
                >
                  Download to Inspect
                </a>
              </div>
            )}
          </div>

          {/* Document Print Options Pane */}
          <div className="w-full md:w-84 bg-white p-5 flex flex-col justify-between overflow-y-auto shrink-0 border-l border-slate-100">
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Print Configuration
                </h4>

                {/* Color Mode */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-slate-700">Color Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setColorMode('bw')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                        colorMode === 'bw'
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      B/W (₹{pricing.bw_price_per_page}/p)
                    </button>
                    <button
                      type="button"
                      disabled={!pricing.color_available}
                      onClick={() => setColorMode('color')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                        !pricing.color_available
                          ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                          : colorMode === 'color'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Color (₹{pricing.color_price_per_page}/p)
                    </button>
                  </div>
                </div>

                {/* Sides */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-slate-700">Print Sides</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSides('single')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                        sides === 'single'
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Single Side
                    </button>
                    <button
                      type="button"
                      disabled={!pricing.duplex_available}
                      onClick={() => setSides('duplex')}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition text-center cursor-pointer ${
                        !pricing.duplex_available
                          ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                          : sides === 'duplex'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      Front & Back
                    </button>
                  </div>
                </div>

                {/* Orientation */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-slate-700">Orientation</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['portrait', 'landscape', 'auto'] as OrientationMode[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setOrientation(o)}
                        className={`py-1.5 text-xs font-bold rounded-lg border capitalize transition cursor-pointer ${
                          orientation === o
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Copies & Page Range */}
                <div className="grid grid-cols-2 gap-2 mb-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Copies</label>
                    <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setCopies(Math.max(1, copies - 1))}
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-sm transition"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={copies}
                        onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full text-center text-xs font-bold py-1.5 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setCopies(copies + 1)}
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-sm transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Page Range</label>
                    <input
                      type="text"
                      placeholder="all (e.g. 1-3)"
                      value={pageRange}
                      onChange={(e) => setPageRange(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-medium rounded-xl border border-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {/* Target Printer Destination */}
                <div className="space-y-1.5 mb-3.5">
                  <label className="block text-xs font-semibold text-slate-700">Target Printer</label>
                  <select
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} {p.isDefault ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cost Summary Box */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Document Cost</span>
                  <span className="font-mono text-slate-700">{costEst.breakdownText}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">Calculated Price</span>
                  <span className="text-lg font-black font-mono text-emerald-700">₹{costEst.totalCost}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <button
                type="button"
                disabled={isPrinting}
                onClick={handlePrintFile}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-98 shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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
                  className="py-2 px-3 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Options'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2 px-3 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 transition cursor-pointer"
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
