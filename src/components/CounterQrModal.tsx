import React, { useState } from 'react';
import {
  X,
  QrCode,
  Printer,
  Copy,
  Check,
  Globe,
  Wifi,
} from 'lucide-react';
import { TunnelStatus, ShopDetails } from '../types.js';

interface CounterQrModalProps {
  tunnel: TunnelStatus | null;
  shop: ShopDetails | null;
  onClose: () => void;
}

export const CounterQrModal: React.FC<CounterQrModalProps> = ({
  tunnel,
  shop,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const activeUrl = tunnel?.activeUrl || window.location.origin;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintStandee = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Counter Upload QR Code</h3>
              <p className="font-mono text-xs text-[var(--ink3)]">Display for walk-in customers or print a standee</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content / Printable Standee */}
        <div className="p-6 sm:p-8 flex flex-col items-center text-center">
          <div
            id="printable-standee"
            className="w-full bg-[var(--sub)] border-2 border-dashed border-[var(--accent-line)] rounded-3xl p-6 sm:p-8 flex flex-col items-center shadow-inner"
          >
            {/* Shop Brand Heading on Standee */}
            <div className="flex items-center justify-center gap-2.5 mb-2">
              <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white font-black text-lg overflow-hidden shadow-sm shrink-0">
                <img
                  src="/api/shop/logo"
                  alt="Logo"
                  className="w-full h-full object-contain p-1"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <h2 className="text-2xl font-black text-[var(--ink)] tracking-tight">
                {shop?.shopName || 'J MART'}
              </h2>
            </div>
            <p className="dc-eyebrow text-[var(--accent)] mb-4">
              QUICK PRINT STATION • SELF-SERVICE UPLOAD
            </p>

            {/* QR Code Container */}
            <div className="bg-white p-4 rounded-2xl shadow-md border border-[var(--border)] mb-4 inline-block">
              {tunnel?.qrCodeDataUrl ? (
                <img
                  src={tunnel.qrCodeDataUrl}
                  alt="Counter QR Code"
                  className="w-56 h-56 object-contain mx-auto"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-[var(--ink4)] font-mono text-xs">
                  Generating QR Code...
                </div>
              )}
            </div>

            <p className="text-base font-bold text-[var(--ink)] mb-1">
              📱 Scan with Phone Camera to Print
            </p>
            <p className="text-xs text-[var(--ink3)] max-w-xs mb-3">
              No app download required. Select document, choose B/W or Color, and get your instant queue token.
            </p>

            {/* URL Display */}
            <div className="w-full bg-[var(--panel)] rounded-xl px-3 py-2 text-xs font-mono text-[var(--ink2)] break-all flex items-center justify-between gap-2 border border-[var(--border)]">
              <span className="truncate">{activeUrl}</span>
              <button
                onClick={handleCopy}
                className="p-1 rounded text-[var(--ink3)] hover:text-[var(--ink)] shrink-0"
                title="Copy URL"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[var(--ok)]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Network Connection Info */}
          <div className="mt-4 flex items-center gap-4 text-xs font-mono text-[var(--ink3)]">
            {tunnel?.tunnelUrl ? (
              <span className="flex items-center gap-1 text-[var(--ok)] font-medium">
                <Globe className="w-3.5 h-3.5" /> Public Cloudflare Tunnel Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--accent)] font-medium">
                <Wifi className="w-3.5 h-3.5" /> Local Shop Wi-Fi URL Active
              </span>
            )}
          </div>
        </div>

        {/* Modal Footer Buttons */}
        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--panel)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="py-2.5 px-4 rounded-xl border border-[var(--border)] font-mono font-bold text-xs text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--sub)] transition flex items-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4 text-[var(--ok)]" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'URL Copied!' : 'Copy Link'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintStandee}
            className="py-2.5 px-5 rounded-xl font-bold text-xs bg-[var(--accent)] text-white hover:opacity-90 shadow-sm transition flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Print Standee Card
          </button>
        </div>
      </div>
    </div>
  );
};
