import React, { useState, useEffect } from 'react';
import {
  X,
  MessageSquare,
  Smartphone,
  Check,
  RefreshCw,
  PowerOff,
  Bell,
  Sparkles,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { WhatsAppStatus, WhatsAppSettings } from '../types.js';
import {
  fetchWhatsAppStatus,
  connectWhatsApp,
  disconnectWhatsApp,
  fetchWhatsAppSettings,
  updateWhatsAppSettings,
} from '../api.js';

interface WhatsAppModalProps {
  onClose: () => void;
  status: WhatsAppStatus | null;
  onStatusUpdated: (status: WhatsAppStatus) => void;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  onClose,
  status: initialStatus,
  onStatusUpdated,
}) => {
  const [status, setStatus] = useState<WhatsAppStatus | null>(initialStatus);
  const [settings, setSettings] = useState<WhatsAppSettings>({
    enabled: true,
    notifyOnPrint: true,
    notifyOnComplete: true,
    welcomeEnabled: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copiedKeyword, setCopiedKeyword] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    } else {
      loadStatus();
    }
    loadSettings();
  }, [initialStatus]);

  const loadStatus = async () => {
    try {
      const res = await fetchWhatsAppStatus();
      setStatus(res);
      onStatusUpdated(res);
    } catch (err: any) {
      console.warn('Failed to load WhatsApp status:', err);
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetchWhatsAppSettings();
      setSettings(res);
    } catch (err: any) {
      console.warn('Failed to load WhatsApp settings:', err);
    }
  };

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const res = await connectWhatsApp();
      setStatus(res);
      onStatusUpdated(res);
    } catch (err: any) {
      alert(err.message || 'Failed to initiate WhatsApp connection');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect WhatsApp? You will need to scan the QR code again to reconnect.')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await disconnectWhatsApp();
      setStatus(res);
      onStatusUpdated(res);
    } catch (err: any) {
      alert(err.message || 'Failed to disconnect WhatsApp');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleSetting = async (key: keyof WhatsAppSettings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    setIsSavingSettings(true);
    try {
      await updateWhatsAppSettings({ [key]: updated[key] });
    } catch (err: any) {
      alert(err.message || 'Failed to update setting');
      // Revert on failure
      setSettings(settings);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyword(text);
    setTimeout(() => setCopiedKeyword(null), 1800);
  };

  const isConnected = status?.state === 'connected';
  const isQrReady = status?.state === 'qr_ready' && status.qrCodeDataUrl;
  const isConnecting = status?.state === 'connecting';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shadow-sm">
              <MessageSquare className="w-5 h-5 fill-emerald-500/20" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base flex items-center gap-2">
                WhatsApp Print Bot
                {isConnected && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
              </h3>
              <p className="font-mono text-xs text-[var(--ink3)]">
                Direct customer document ingestion & instant auto-reply
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Status & Connection Panel */}
          <div className="p-5 rounded-2xl bg-[var(--sub)] border border-[var(--border)] space-y-4">
            {/* STATE: CONNECTED */}
            {isConnected ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-[var(--ink)]">
                          {status.pushName || 'Shop WhatsApp'}
                        </h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                          CONNECTED
                        </span>
                      </div>
                      <p className="font-mono text-xs text-[var(--ink2)] mt-0.5">
                        +{status.phoneNumber}
                      </p>
                      {status.lastConnected && (
                        <p className="text-[11px] text-[var(--ink4)] mt-0.5">
                          Active since {new Date(status.lastConnected).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    Disconnect
                  </button>
                </div>

                <div className="p-3 bg-[var(--panel)] rounded-xl border border-[var(--border)] text-xs text-[var(--ink2)] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Ready to receive documents! When customers send PDFs or photos to <strong>+{status.phoneNumber}</strong>, they will instantly queue here.
                  </span>
                </div>
              </div>
            ) : isQrReady ? (
              /* STATE: QR READY */
              <div className="text-center space-y-4">
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-[var(--ink)]">Scan QR Code to Link WhatsApp</h4>
                  <p className="text-xs text-[var(--ink3)]">
                    Scan with WhatsApp on the shop phone to activate the bot
                  </p>
                </div>

                <div className="inline-block p-3 bg-white rounded-2xl shadow-md border border-[var(--border)]">
                  <img
                    src={status.qrCodeDataUrl!}
                    alt="WhatsApp Pairing QR Code"
                    className="w-56 h-56 mx-auto rounded-lg"
                  />
                </div>

                <div className="text-left bg-[var(--panel)] p-3.5 rounded-xl border border-[var(--border)] space-y-1.5 text-xs text-[var(--ink2)]">
                  <p className="font-bold text-[11px] uppercase tracking-wider text-[var(--ok)]">
                    How to scan:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-[var(--ink2)]">
                    <li>Open <strong>WhatsApp</strong> on your phone</li>
                    <li>Tap <strong>Menu (⋮)</strong> or <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                    <li>Tap <strong>Link a device</strong></li>
                    <li>Point your phone camera at this QR code</li>
                  </ol>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={handleConnect}
                    disabled={isLoading}
                    className="px-4 py-2 text-xs font-semibold text-[var(--ink)] bg-[var(--panel)] hover:bg-[var(--sub)] border border-[var(--border)] rounded-xl flex items-center gap-1.5 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh QR
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="px-4 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 rounded-xl transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : isConnecting ? (
              /* STATE: CONNECTING */
              <div className="py-8 text-center space-y-3">
                <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <h4 className="font-bold text-sm text-[var(--ink)]">Connecting to WhatsApp...</h4>
                <p className="text-xs text-[var(--ink3)]">
                  Generating secure encryption keys & pairing session...
                </p>
              </div>
            ) : (
              /* STATE: DISCONNECTED */
              <div className="space-y-4 text-center py-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center border border-emerald-500/20">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div className="space-y-1 max-w-xs mx-auto">
                  <h4 className="font-bold text-sm text-[var(--ink)]">Connect Shop WhatsApp</h4>
                  <p className="text-xs text-[var(--ink3)]">
                    Link your phone to automatically accept customer documents, assign tokens (#P-101), and notify customers.
                  </p>
                </div>
                {status?.error && (
                  <p className="text-xs text-rose-500 bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20 inline-block max-w-sm">
                    {status.error}
                  </p>
                )}
                <div>
                  <button
                    onClick={handleConnect}
                    disabled={isLoading}
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center gap-2 mx-auto transition disabled:opacity-50"
                  >
                    {isLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <MessageSquare className="w-4 h-4" />
                    )}
                    Connect WhatsApp (Scan QR)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Automated Notification Controls */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-[var(--ink)] uppercase tracking-wider flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-[var(--accent)]" />
              Automated Customer Messages
            </h4>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--sub)] border border-[var(--border)] cursor-pointer hover:bg-[var(--panel)] transition">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[var(--ink)]">
                    Send "Printing Started" Notification
                  </div>
                  <div className="text-[11px] text-[var(--ink3)]">
                    Automatically texts customer when printer begins printing their document
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.notifyOnPrint}
                  onChange={() => handleToggleSetting('notifyOnPrint')}
                  disabled={isSavingSettings}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-[var(--border)]"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--sub)] border border-[var(--border)] cursor-pointer hover:bg-[var(--panel)] transition">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[var(--ink)]">
                    Send "Ready for Pickup" Notification
                  </div>
                  <div className="text-[11px] text-[var(--ink3)]">
                    Automatically texts customer with token and total cost due when marked printed
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.notifyOnComplete}
                  onChange={() => handleToggleSetting('notifyOnComplete')}
                  disabled={isSavingSettings}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-[var(--border)]"
                />
              </label>

              <label className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--sub)] border border-[var(--border)] cursor-pointer hover:bg-[var(--panel)] transition">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[var(--ink)]">
                    Send Welcome & Rates Card on Text Greetings
                  </div>
                  <div className="text-[11px] text-[var(--ink3)]">
                    Replies to "Hi", "Hello", or text queries with active rates & printing instructions
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.welcomeEnabled}
                  onChange={() => handleToggleSetting('welcomeEnabled')}
                  disabled={isSavingSettings}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-[var(--border)]"
                />
              </label>
            </div>
          </div>

          {/* Customer Cheatsheet & How It Works */}
          <div className="p-4 rounded-2xl bg-[var(--sub)] border border-[var(--border)] space-y-3">
            <h4 className="text-xs font-bold text-[var(--ink)] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Customer WhatsApp Keywords & Commands
            </h4>
            <p className="text-[11px] text-[var(--ink3)] leading-relaxed">
              Customers can send documents with captions or reply with these keywords to adjust settings before printing:
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { cmd: 'COLOR', desc: 'Switch to color print' },
                { cmd: 'BW', desc: 'Switch to black & white' },
                { cmd: 'DUPLEX', desc: 'Two-sided (front & back)' },
                { cmd: '2 COPIES', desc: 'Change number of copies' },
                { cmd: 'STATUS', desc: 'Check current price & status' },
                { cmd: 'CANCEL', desc: 'Cancel this print order' },
              ].map((item) => (
                <button
                  key={item.cmd}
                  onClick={() => handleCopy(item.cmd)}
                  className="p-2 rounded-xl bg-[var(--panel)] border border-[var(--border)] text-left hover:border-emerald-500/40 transition group"
                >
                  <div className="flex items-center justify-between font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                    <span>{item.cmd}</span>
                    {copiedKeyword === item.cmd ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <span className="text-[10px] text-[var(--ink4)] opacity-0 group-hover:opacity-100 transition">
                        copy
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--ink3)] mt-0.5">{item.desc}</div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)] pt-1">
              <Info className="w-3.5 h-3.5 shrink-0 text-[var(--ink4)]" />
              <span>Multi-document batching: files sent within 25 seconds are grouped under 1 token.</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--border)] bg-[var(--panel)] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--sub)] hover:bg-[var(--panel)] border border-[var(--border)] text-[var(--ink)] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
