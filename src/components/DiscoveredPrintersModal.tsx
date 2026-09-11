import React, { useState } from 'react';
import {
  X,
  Printer,
  Wifi,
  Usb,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  Palette,
  Link,
  Plus,
  Play,
  Globe,
} from 'lucide-react';
import { DiscoveredPrinter, PrinterProfile } from '../types.js';
import { scanPrinters, linkDiscoveredPrinter, createProfileFromDiscovered, testPrint } from '../api.js';

interface DiscoveredPrintersModalProps {
  discoveredPrinters: DiscoveredPrinter[];
  printerProfiles: PrinterProfile[];
  onClose: () => void;
  onPrintersUpdated: (printers: DiscoveredPrinter[]) => void;
  onProfilesUpdated?: () => void;
}

export const DiscoveredPrintersModal: React.FC<DiscoveredPrintersModalProps> = ({
  discoveredPrinters,
  printerProfiles,
  onClose,
  onPrintersUpdated,
  onProfilesUpdated,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [selectedProfileMap, setSelectedProfileMap] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleScanNow = async () => {
    setIsScanning(true);
    try {
      const res = await scanPrinters();
      onPrintersUpdated(res.printers);
      showToast(`Scan complete! Found ${res.count} connected printer(s).`);
      if (onProfilesUpdated) onProfilesUpdated();
    } catch (err: any) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleTestPrint = async (printer: DiscoveredPrinter) => {
    const target = printer.cupsPrinterName || printer.name;
    setActionLoadingId(printer.id);
    try {
      const res = await testPrint(target);
      showToast(res.message);
    } catch (err: any) {
      alert(`Test print failed: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleLinkToProfile = async (discoveredId: string) => {
    const targetProfileId = selectedProfileMap[discoveredId] || printerProfiles[0]?.id;
    if (!targetProfileId) {
      alert('Please select a profile to link.');
      return;
    }

    setActionLoadingId(discoveredId);
    try {
      await linkDiscoveredPrinter(discoveredId, targetProfileId);
      showToast('Printer successfully linked to profile!');
      const updated = await scanPrinters();
      onPrintersUpdated(updated.printers);
      if (onProfilesUpdated) onProfilesUpdated();
    } catch (err: any) {
      alert(`Link failed: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCreateNewProfile = async (discoveredId: string) => {
    setActionLoadingId(discoveredId);
    try {
      await createProfileFromDiscovered(discoveredId);
      showToast('New profile created and linked to this printer!');
      const updated = await scanPrinters();
      onPrintersUpdated(updated.printers);
      if (onProfilesUpdated) onProfilesUpdated();
    } catch (err: any) {
      alert(`Failed creating profile: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const onlineCount = discoveredPrinters.filter((p) => p.isOnline).length;
  const networkCount = discoveredPrinters.filter(
    (p) => p.connectionType === 'network_bonjour' || p.connectionType === 'network_ip'
  ).length;
  const usbCount = discoveredPrinters.filter((p) => p.connectionType === 'usb_direct').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150 font-sans text-[var(--ink)]">
      <div className="bg-[var(--panel)] w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden border border-[var(--border)] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--panel)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)] flex items-center justify-center">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[var(--ink)] text-base">
                  Auto-Detected Printers & Hardware
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[var(--ok-soft)] text-[var(--ok)] border border-[var(--ok-line)] uppercase tracking-wider">
                  Live Scanner
                </span>
              </div>
              <p className="font-mono text-xs text-[var(--ink3)]">
                Scans Wi-Fi / Ethernet (Bonjour mDNS/IPP), USB cables, and CUPS queues
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanNow}
              disabled={isScanning}
              className="py-2 px-3 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Scan Now'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--ink4)] hover:text-[var(--ink)] hover:bg-[var(--sub)] border border-transparent hover:border-[var(--border)] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="bg-[var(--accent)] text-white px-6 py-2.5 text-xs font-mono font-bold flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Summary Stats Strip */}
        <div className="bg-[var(--sub)] px-6 py-2.5 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-4 text-[var(--ink2)]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--ok)] animate-pulse" />
              <strong className="text-[var(--ink)]">{onlineCount}</strong> Online & Ready
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-[var(--accent)]" />
              <strong className="text-[var(--ink)]">{networkCount}</strong> Network (Wi-Fi/LAN)
            </span>
            {usbCount > 0 && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1.5">
                  <Usb className="w-3.5 h-3.5 text-[var(--warn)]" />
                  <strong className="text-[var(--ink)]">{usbCount}</strong> USB Direct
                </span>
              </>
            )}
          </div>
          <span className="text-[11px] text-[var(--ink4)]">Auto-refreshes every 25s</span>
        </div>

        {/* Printers List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {discoveredPrinters.length === 0 ? (
            <div className="text-center py-12 px-4 rounded-3xl border border-dashed border-[var(--border)] bg-[var(--sub)]">
              <Printer className="w-12 h-12 text-[var(--ink4)] mx-auto mb-3" />
              <h4 className="text-base font-bold text-[var(--ink)] mb-1">
                No Printers Detected Yet
              </h4>
              <p className="text-xs text-[var(--ink3)] max-w-md mx-auto mb-5">
                Ensure your printer (such as Canon MAXIFY GX4070 or Canon imageRUNNER 4225) is
                powered on and connected to your shop's Wi-Fi network or Mac USB port.
              </p>
              <button
                onClick={handleScanNow}
                disabled={isScanning}
                className="py-2.5 px-5 rounded-xl bg-[var(--accent)] text-white font-bold text-xs shadow-sm hover:opacity-90 inline-flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                <span>Start Network & USB Scan</span>
              </button>
            </div>
          ) : (
            discoveredPrinters.map((printer) => {
              const isLoading = actionLoadingId === printer.id;
              const hasAdminUrl = Boolean(printer.adminUrl);
              const isMatched = Boolean(printer.matchedProfileId);

              return (
                <div
                  key={printer.id}
                  className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-5 shadow-xs hover:border-[var(--accent-line)] transition space-y-4"
                >
                  {/* Top: Name, Connection Type & Status */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                          printer.connectionType === 'usb_direct'
                            ? 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]'
                            : 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]'
                        }`}
                      >
                        {printer.connectionType === 'usb_direct' ? (
                          <Usb className="w-5 h-5" />
                        ) : (
                          <Wifi className="w-5 h-5" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-[var(--ink)] text-base leading-tight">
                            {printer.name}
                          </h4>
                          <span
                            className={`text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded border ${
                              printer.connectionType === 'usb_direct'
                                ? 'bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)]'
                                : 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]'
                            }`}
                          >
                            {printer.connectionType === 'usb_direct'
                              ? 'USB Cable'
                              : 'Network Wi-Fi / LAN'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink3)] mt-0.5 flex-wrap">
                          {printer.ipAddress && (
                            <span className="text-[var(--ink)] font-bold">
                              IP: {printer.ipAddress}
                              {printer.port ? `:${printer.port}` : ''}
                            </span>
                          )}
                          {printer.hostname && printer.hostname !== printer.ipAddress && (
                            <>
                              <span>•</span>
                              <span>Host: {printer.hostname}</span>
                            </>
                          )}
                          {printer.cupsPrinterName && (
                            <>
                              <span>•</span>
                              <span className="text-[var(--accent)] font-semibold">
                                CUPS: {printer.cupsPrinterName}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Online status badge */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 border ${
                          printer.isOnline
                            ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)]'
                            : 'bg-[var(--sub)] text-[var(--ink4)] border-[var(--border)]'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            printer.isOnline ? 'bg-[var(--ok)] animate-pulse' : 'bg-[var(--ink4)]'
                          }`}
                        />
                        <span>{printer.isOnline ? 'Online & Ready' : 'Offline / Inactive'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Capabilities & Metadata Row */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--rule)]">
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${
                        printer.supportsColor
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-line)]'
                          : 'bg-[var(--sub)] text-[var(--ink3)] border-[var(--border)]'
                      }`}
                    >
                      <Palette className="w-3 h-3" />
                      <span>{printer.supportsColor ? 'Color & B/W Supported' : 'Monochrome Only'}</span>
                    </span>

                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${
                        printer.supportsDuplex
                          ? 'bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)]'
                          : 'bg-[var(--sub)] text-[var(--ink3)] border-[var(--border)]'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>
                        {printer.supportsDuplex
                          ? 'Front & Back (Duplex) Supported'
                          : 'Single-Sided Only'}
                      </span>
                    </span>

                    {/* Linked Profile Badge */}
                    {isMatched ? (
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded border bg-[var(--ok-soft)] text-[var(--ok)] border-[var(--ok-line)] flex items-center gap-1 ml-auto">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Profile: {printer.matchedProfileName}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded border bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn-line)] flex items-center gap-1 ml-auto">
                        <AlertCircle className="w-3 h-3" />
                        <span>No Profile Assigned</span>
                      </span>
                    )}
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--rule)]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Test Print */}
                      <button
                        type="button"
                        onClick={() => handleTestPrint(printer)}
                        disabled={isLoading}
                        className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-xs font-mono font-bold text-[var(--ink2)] hover:text-[var(--ink)] flex items-center gap-1.5 transition"
                      >
                        <Play className="w-3 h-3 text-[var(--ok)] fill-current" />
                        <span>{isLoading ? 'Printing...' : 'Test Print'}</span>
                      </button>

                      {/* Printer Web Management Console */}
                      {hasAdminUrl && (
                        <a
                          href={printer.adminUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-xs font-mono font-bold text-[var(--ink2)] hover:text-[var(--ink)] flex items-center gap-1.5 transition"
                          title="Open printer web management panel"
                        >
                          <Globe className="w-3 h-3 text-[var(--accent)]" />
                          <span>Web Admin</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {/* Linking or Adding to Profiles */}
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedProfileMap[printer.id] || printer.matchedProfileId || ''}
                        onChange={(e) =>
                          setSelectedProfileMap({
                            ...selectedProfileMap,
                            [printer.id]: e.target.value,
                          })
                        }
                        className="px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--sub)] text-xs font-mono text-[var(--ink)] focus:outline-none"
                      >
                        <option value="">-- Choose Profile --</option>
                        {printerProfiles.map((prof) => (
                          <option key={prof.id} value={prof.id}>
                            {prof.name}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => handleLinkToProfile(printer.id)}
                        disabled={isLoading}
                        className="py-1.5 px-3 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white text-xs font-mono font-bold flex items-center gap-1 transition"
                      >
                        <Link className="w-3 h-3" />
                        <span>Link</span>
                      </button>

                      {!isMatched && (
                        <button
                          type="button"
                          onClick={() => handleCreateNewProfile(printer.id)}
                          disabled={isLoading}
                          className="py-1.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--sub)] hover:bg-[var(--panel)] text-[var(--ink2)] hover:text-[var(--ink)] text-xs font-mono font-bold flex items-center gap-1 transition"
                          title="Add as a new printer profile"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Profile</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--panel)] flex items-center justify-between">
          <div className="text-xs font-mono text-[var(--ink3)]">
            <span>Discovered via </span>
            <code className="text-[var(--ink2)]">dns-sd</code>
            <span> & </span>
            <code className="text-[var(--ink2)]">CUPS</code>
          </div>

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
