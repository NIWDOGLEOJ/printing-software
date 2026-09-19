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
  ShieldCheck,
  Zap,
  QrCode,
  AlertCircle,
} from 'lucide-react';
import { TunnelStatus } from '../types.js';
import { startTunnel, stopTunnel, setManualTunnelUrl, saveTunnelSettings } from '../api.js';

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
  const [selectedProvider, setSelectedProvider] = useState<'auto' | 'cloudflare' | 'ssh'>('auto');
  const [autoStart, setAutoStart] = useState(tunnel?.autoStart ?? true);

  const isRunning = Boolean(tunnel?.tunnelUrl);

  const handleStart = async (provider = selectedProvider) => {
    setIsLoading(true);
    try {
      const res = await startTunnel(provider);
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

  const handleToggleAutoStart = async () => {
    const nextVal = !autoStart;
    setAutoStart(nextVal);
    try {
      const { status } = await saveTunnelSettings({ auto_start: nextVal });
      onTunnelUpdated(status);
    } catch (e) {
      setAutoStart(!nextVal);
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
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Internet Tunneling & Remote Access</h3>
              <p className="font-mono text-xs text-[var(--ink3)]">Allow customers to find & upload via 4G/5G mobile</p>
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
              <span className="dc-eyebrow text-[var(--ink3)] block">Live Status</span>
              <div className="flex items-center gap-2 mt-0.5 font-mono">
                <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--ink4)]'}`} />
                <span className="font-bold text-[var(--ink)] text-sm">
                  {isRunning ? `Online (${tunnel?.provider?.toUpperCase()})` : 'Offline (Local LAN Only)'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isRunning ? (
                <>
                  <button
                    onClick={() => handleStart(selectedProvider)}
                    disabled={isLoading}
                    title="Restart Tunnel"
                    className="p-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--rule)] text-[var(--ink2)] transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={isLoading}
                    className="py-2 px-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] hover:opacity-90 text-[var(--danger)] font-mono text-xs font-bold flex items-center gap-1.5 transition"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" /> Stop
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleStart(selectedProvider)}
                  disabled={isLoading}
                  className="py-2 px-4 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                >
                  {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  Launch Tunnel
                </button>
              )}
            </div>
          </div>

          {/* Auto-Start on Boot Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--sub)] border border-[var(--border)]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)] flex items-center justify-center">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-xs text-[var(--ink)] block">Auto-Start Tunnel on System Boot</span>
                <span className="font-mono text-[11px] text-[var(--ink3)]">Keeps software reachable automatically when laptop starts</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleAutoStart}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                autoStart ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoStart ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Provider Selector */}
          <div>
            <label className="dc-eyebrow text-[var(--ink3)] block mb-1.5">
              Tunneling Protocol / Provider
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSelectedProvider('auto')}
                className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold flex flex-col items-center gap-1 transition ${
                  selectedProvider === 'auto'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>Auto-Fallback</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider('cloudflare')}
                className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold flex flex-col items-center gap-1 transition ${
                  selectedProvider === 'cloudflare'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>Cloudflare</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider('ssh')}
                className={`py-2 px-3 rounded-xl border text-xs font-mono font-bold flex flex-col items-center gap-1 transition ${
                  selectedProvider === 'ssh'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--sub)] text-[var(--ink2)] hover:border-[var(--border2)]'
                }`}
              >
                <Terminal className="w-4 h-4" />
                <span>SSH (Zero-Install)</span>
              </button>
            </div>
            <p className="font-mono text-[11px] text-[var(--ink4)] mt-1.5">
              💡 <strong>SSH Localhost.run</strong> works without downloading any extra packages on Linux or macOS.
            </p>
          </div>

          {/* Error Banner if any */}
          {tunnel?.error && (
            <div className="p-3 rounded-xl bg-[var(--danger-soft)] border border-[var(--danger-line)] text-[var(--danger)] text-xs font-mono flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{tunnel.error}</span>
            </div>
          )}

          {/* Active Public URL */}
          {tunnel?.tunnelUrl && (
            <div className="p-4 rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent-line)] space-y-3">
              <div className="flex items-center justify-between">
                <label className="dc-eyebrow text-[var(--accent)] block">
                  Public Customer Upload URL ({tunnel.provider?.toUpperCase()})
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ok)] font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" /> HTTPS Encrypted
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[var(--panel)] border border-[var(--accent-line)] rounded-xl px-3.5 py-2.5 text-xs font-mono text-[var(--ink)] select-all truncate">
                  {tunnel.tunnelUrl}
                </div>
                <button
                  onClick={() => handleCopy(tunnel.tunnelUrl!)}
                  className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--sub)] text-[var(--ink)] transition"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-4 h-4 text-[var(--ok)]" /> : <Copy className="w-4 h-4" />}
                </button>
                <a
                  href={tunnel.tunnelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--sub)] text-[var(--ink)] transition"
                  title="Open Portal"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Scannable QR Code */}
              {tunnel.qrCodeDataUrl && (
                <div className="pt-2 flex items-center gap-4 border-t border-[var(--accent-line)]/50">
                  <img
                    src={tunnel.qrCodeDataUrl}
                    alt="Public Upload QR"
                    className="w-20 h-20 rounded-xl bg-white p-1.5 border border-[var(--border)] shadow-sm"
                  />
                  <div className="text-xs space-y-1 font-mono">
                    <span className="font-bold text-[var(--ink)] block flex items-center gap-1">
                      <QrCode className="w-3.5 h-3.5 text-[var(--accent)]" /> Counter Scannable QR
                    </span>
                    <p className="text-[var(--ink3)] text-[11px]">
                      Encodes the public HTTPS link so customers on 4G/5G can scan from their camera.
                    </p>
                  </div>
                </div>
              )}
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
              Manual Custom Domain / External Proxy
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://print.myshop.com"
                className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveManualUrl}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-mono font-bold text-xs transition"
              >
                Save
              </button>
            </div>
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
