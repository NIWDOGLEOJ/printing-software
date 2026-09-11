import React, { useState } from 'react';
import {
  X,
  Globe,
  Wifi,
  Copy,
  Check,
  ExternalLink,
  Play,
  Square,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { TunnelStatus } from '../types.js';
import { startTunnel, stopTunnel, setManualTunnelUrl } from '../api.js';

interface TunnelModalProps {
  tunnel: TunnelStatus | null;
  onClose: () => void;
  onTunnelUpdated: (status: TunnelStatus) => void;
}

export const TunnelModal: React.FC<TunnelModalProps> = ({
  tunnel,
  onClose,
  onTunnelUpdated,
}) => {
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [manualUrl, setManualUrl] = useState(tunnel?.tunnelUrl || '');

  const isRunning = Boolean(tunnel?.tunnelUrl);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      const res = await startTunnel();
      onTunnelUpdated(res);
      if (res.tunnelUrl) setManualUrl(res.tunnelUrl);
    } catch (err: any) {
      alert(err.message || 'Failed to start tunnel');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      const res = await stopTunnel();
      onTunnelUpdated(res);
      setManualUrl('');
    } catch (err: any) {
      alert(err.message || 'Failed to stop tunnel');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveManualUrl = async () => {
    try {
      const res = await setManualTunnelUrl(manualUrl);
      onTunnelUpdated(res);
      alert('Custom Tunnel URL updated!');
    } catch (err: any) {
      alert(err.message || 'Failed to update URL');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)]">
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Cloudflare Connectivity</h3>
              <p className="font-mono text-xs text-[var(--ink3)]">Enable mobile uploads over 4G/5G cellular data</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Status Box */}
          <div className="p-4 rounded-2xl bg-[var(--sub)] border border-[var(--border)] flex items-center justify-between">
            <div>
              <span className="dc-eyebrow text-[var(--ink3)] block">Status</span>
              <div className="flex items-center gap-2 mt-0.5 font-mono">
                <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--ink4)]'}`} />
                <span className="font-bold text-[var(--ink)] text-sm">
                  {isRunning ? 'Public Quick Tunnel Online' : 'Tunnel Offline (Local Wi-Fi Only)'}
                </span>
              </div>
            </div>

            <div>
              {isRunning ? (
                <button
                  onClick={handleStop}
                  disabled={isLoading}
                  className="py-2 px-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] hover:opacity-90 text-[var(--danger)] font-mono text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={isLoading}
                  className="py-2 px-4 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                >
                  {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  Launch Quick Tunnel
                </button>
              )}
            </div>
          </div>

          {/* Active Public URL */}
          {tunnel?.tunnelUrl && (
            <div>
              <label className="dc-eyebrow text-[var(--ink3)] block mb-1.5">
                Public Customer Upload URL
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--accent)] truncate">
                  {tunnel.tunnelUrl}
                </div>
                <button
                  onClick={() => handleCopy(tunnel.tunnelUrl!)}
                  className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-4 h-4 text-[var(--ok)]" /> : <Copy className="w-4 h-4" />}
                </button>
                <a
                  href={tunnel.tunnelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] transition"
                  title="Open Portal"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          )}

          {/* Local Wi-Fi Addresses */}
          <div>
            <label className="dc-eyebrow text-[var(--ink3)] mb-1.5 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-[var(--accent)]" /> Local Shop Wi-Fi URLs
            </label>
            <div className="space-y-1.5">
              {tunnel?.localUrls.map((url) => (
                <div
                  key={url}
                  className="flex items-center justify-between bg-[var(--sub)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-mono text-[var(--ink2)]"
                >
                  <span className="truncate">{url}</span>
                  <button
                    onClick={() => handleCopy(url)}
                    className="p-1 text-[var(--ink4)] hover:text-[var(--ink)]"
                    title="Copy"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Custom / Manual Tunnel URL */}
          <div className="border-t border-[var(--rule)] pt-4">
            <label className="dc-eyebrow text-[var(--ink3)] block mb-1.5">
              Manual Tunnel URL / External Domain
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://my-custom-tunnel.trycloudflare.com"
                className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveManualUrl}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-mono font-bold text-xs transition"
              >
                Set
              </button>
            </div>
            <p className="font-mono text-[11px] text-[var(--ink4)] mt-1.5 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-[var(--accent)]" /> Or run in terminal: <code className="bg-[var(--sub)] px-1 py-0.5 rounded text-[var(--ink2)] font-mono border border-[var(--border)]">pnpm run tunnel</code>
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--panel)] text-right">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-5 rounded-xl font-mono font-bold text-xs bg-[var(--sub)] hover:bg-[var(--rule)] text-[var(--ink2)] hover:text-[var(--ink)] border border-[var(--border)] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
