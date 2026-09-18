import React from 'react';
import {
  FileText,
  Printer,
  Trash2,
  Eye,
  Check,
  MessageSquare,
} from 'lucide-react';
import { PrintJob } from '../types.js';
import { formatCurrency, formatFileSize, formatRelativeTime } from '../utils/formatters.js';

interface JobCardProps {
  job: PrintJob;
  onOpenPreview: (job: PrintJob) => void;
  onQuickPrint: (job: PrintJob) => void;
  onMarkPrinted: (job: PrintJob) => void;
  onDelete: (job: PrintJob) => void;
  isPrinting?: boolean;
}

export const JobCard: React.FC<JobCardProps> = ({
  job,
  onOpenPreview,
  onQuickPrint,
  onMarkPrinted,
  onDelete,
  isPrinting,
}) => {
  const isPrinted = job.status === 'printed';
  const isPending = job.status === 'pending';

  return (
    <div
      onClick={() => onOpenPreview(job)}
      className={`group relative rounded-2xl p-4 sm:p-5 border transition-all cursor-pointer shadow-sm hover:shadow-md ${
        isPending
          ? 'bg-[var(--panel)] border-[var(--accent-line)] hover:border-[var(--accent)]'
          : isPrinted
          ? 'bg-[var(--panel)]/80 border-[var(--border)] opacity-85 hover:opacity-100'
          : 'bg-[var(--panel)] border-[var(--border)]'
      }`}
    >
      {/* Top row: Token, Customer Name, Status badge, Timestamp */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`font-mono font-black text-sm px-2.5 py-0.5 rounded-lg tracking-tight shrink-0 ${
              isPending
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'bg-[var(--sub)] text-[var(--ink2)] border border-[var(--border)]'
            }`}
          >
            {job.token}
          </span>
          {job.source === 'whatsapp' && (
            <span
              title="Submitted via WhatsApp"
              className="px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1 shrink-0"
            >
              <MessageSquare className="w-3 h-3 fill-emerald-500/20" />
              WA
            </span>
          )}
          <h3 className="font-bold text-[var(--ink)] text-base truncate">
            {job.customer_name}
          </h3>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 font-mono ${
              isPrinted
                ? 'bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)]'
                : isPending
                ? 'bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)]'
                : 'bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isPrinted ? 'bg-[var(--ok)]' : 'bg-[var(--warn)] animate-pulse'
              }`}
            />
            {isPrinted ? 'Printed' : 'Pending'}
          </span>
          <span className="font-mono text-[11px] text-[var(--ink4)] whitespace-nowrap">
            {formatRelativeTime(job.created_at)}
          </span>
        </div>
      </div>

      {/* File info row */}
      <div className="flex items-center gap-2.5 text-sm text-[var(--ink2)] mb-3 bg-[var(--sub)] p-2.5 rounded-xl border border-[var(--rule)]">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4" />
        </div>
        <div className="truncate flex-1">
          <div
            className="font-medium truncate text-xs sm:text-sm text-[var(--ink)]"
            title={job.original_filename}
          >
            {job.original_filename}
          </div>
          <div className="font-mono text-[11px] text-[var(--ink3)] flex items-center gap-2">
            <span>{formatFileSize(job.file_size)}</span>
            <span>•</span>
            <span className="font-semibold text-[var(--ink2)]">
              {job.page_count} {job.page_count === 1 ? 'page' : 'pages'}
            </span>
          </div>
        </div>
      </div>

      {/* Badges: Options */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs font-mono">
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
            job.color_mode === 'color'
              ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
              : 'bg-[var(--sub)] text-[var(--ink2)] border-[var(--border)]'
          }`}
        >
          {job.color_mode === 'color' ? 'Color' : 'B&W'}
        </span>

        <span className="px-2 py-0.5 rounded text-[11px] bg-[var(--sub)] text-[var(--ink3)] border border-[var(--border)] font-medium">
          {job.sides === 'duplex' ? 'Duplex (2-sided)' : 'Single sided'}
        </span>

        {job.copies > 1 && (
          <span className="px-2 py-0.5 rounded text-[11px] bg-[var(--warn-soft)] text-[var(--warn)] border border-[var(--warn-line)] font-bold">
            {job.copies} Copies
          </span>
        )}

        {job.page_range && job.page_range !== 'all' && (
          <span className="px-2 py-0.5 rounded text-[11px] bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] font-medium">
            Pages: {job.page_range}
          </span>
        )}
      </div>

      {/* Bottom row: Price & Quick Action buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--rule)]">
        <div>
          <span className="dc-eyebrow block leading-tight">Total</span>
          <span className="dc-mono text-lg font-black text-[var(--ink)] leading-tight">
            {formatCurrency(job.estimated_cost)}
          </span>
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            title="Preview Document & Options"
            onClick={() => onOpenPreview(job)}
            className="p-2 rounded-xl text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
          >
            <Eye className="w-4 h-4" />
          </button>

          <button
            title="Quick Print with Default Printer"
            disabled={isPrinting}
            onClick={() => onQuickPrint(job)}
            className="px-3 py-1.5 rounded-xl font-bold text-xs bg-[var(--accent)] hover:opacity-90 text-white shadow-sm flex items-center gap-1.5 transition disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isPrinted ? 'Reprint' : 'Print'}</span>
          </button>

          <button
            title={isPrinted ? 'Mark Pending' : 'Mark as Printed'}
            onClick={() => onMarkPrinted(job)}
            className={`p-2 rounded-xl border transition ${
              isPrinted
                ? 'text-[var(--ok)] bg-[var(--ok-soft)] border-[var(--ok-line)] hover:opacity-90'
                : 'text-[var(--ink3)] hover:text-[var(--ink)] bg-[var(--sub)] border-[var(--border)] hover:bg-[var(--panel)]'
            }`}
          >
            <Check className="w-4 h-4" />
          </button>

          <button
            title="Delete Job and File"
            onClick={() => onDelete(job)}
            className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] hover:border-[var(--danger-line)] border border-transparent transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
