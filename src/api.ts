import {
  PrintJob,
  PricingSettings,
  ShopDetails,
  PrinterInfo,
  TunnelStatus,
  PrinterProfile,
  EffectivePricing,
  DiscoveredPrinter,
} from './types.js';

const API_BASE = '/api';

export async function fetchShopDetails(): Promise<ShopDetails> {
  const res = await fetch(`${API_BASE}/shop`);
  if (!res.ok) throw new Error('Failed to load shop details');
  return res.json();
}

export async function fetchJobs(): Promise<PrintJob[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) throw new Error('Failed to load print jobs');
  return res.json();
}

export async function fetchJob(id: string): Promise<PrintJob> {
  const res = await fetch(`${API_BASE}/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to load job');
  return res.json();
}

export async function uploadJob(formData: FormData): Promise<{ success: boolean; job: PrintJob }> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to upload document');
  }
  return res.json();
}

export async function updateJob(id: string, updates: Partial<PrintJob>): Promise<PrintJob> {
  const res = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update job');
  return res.json();
}

export async function deleteJob(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/jobs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete job');
  return res.json();
}

export async function cleanupExpiredJobs(): Promise<{ deletedCount: number; orphanedCount: number }> {
  const res = await fetch(`${API_BASE}/jobs/cleanup`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to cleanup jobs');
  return res.json();
}

export async function fetchPrinters(): Promise<PrinterInfo[]> {
  const res = await fetch(`${API_BASE}/printers`);
  if (!res.ok) throw new Error('Failed to load printers');
  return res.json();
}

export async function printJob(
  id: string,
  options: {
    printerName?: string;
    copies?: number;
    colorMode?: string;
    sides?: string;
    orientation?: string;
    pageRange?: string;
  }
): Promise<{ success: boolean; message: string; cupsJobId: string; printerName: string; job: PrintJob }> {
  const res = await fetch(`${API_BASE}/printers/print/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to print document');
  }
  return res.json();
}

export async function testPrint(printerName: string): Promise<{ success: boolean; message: string; cupsJobId: string }> {
  const res = await fetch(`${API_BASE}/printers/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerName }),
  });
  if (!res.ok) throw new Error('Failed to send test print');
  return res.json();
}

export async function fetchDiscoveredPrinters(): Promise<DiscoveredPrinter[]> {
  const res = await fetch(`${API_BASE}/printers/discovered`);
  if (!res.ok) throw new Error('Failed to load discovered printers');
  return res.json();
}

export async function scanPrinters(): Promise<{ success: boolean; count: number; printers: DiscoveredPrinter[] }> {
  const res = await fetch(`${API_BASE}/printers/scan`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to scan network & USB printers');
  return res.json();
}

export async function linkDiscoveredPrinter(discoveredId: string, profileId: string): Promise<PrinterProfile> {
  const res = await fetch(`${API_BASE}/printers/link-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discoveredId, profileId }),
  });
  if (!res.ok) throw new Error('Failed to link printer to profile');
  return res.json();
}

export async function createProfileFromDiscovered(discoveredId: string): Promise<PrinterProfile> {
  const res = await fetch(`${API_BASE}/printers/create-profile-from-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discoveredId }),
  });
  if (!res.ok) throw new Error('Failed to create profile from printer');
  return res.json();
}

export async function fetchSettings(): Promise<PricingSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

export async function updateSettings(settings: Partial<PricingSettings>): Promise<PricingSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
}

export async function fetchPrinterProfiles(): Promise<PrinterProfile[]> {
  const res = await fetch(`${API_BASE}/printers/profiles`);
  if (!res.ok) throw new Error('Failed to load printer profiles');
  return res.json();
}

export async function createPrinterProfile(profile: Partial<PrinterProfile>): Promise<PrinterProfile> {
  const res = await fetch(`${API_BASE}/printers/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create printer profile');
  }
  return res.json();
}

export async function updatePrinterProfile(
  id: string,
  updates: Partial<PrinterProfile>
): Promise<PrinterProfile> {
  const res = await fetch(`${API_BASE}/printers/profiles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update printer profile');
  }
  return res.json();
}

export async function deletePrinterProfile(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/printers/profiles/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete printer profile');
  return res.json();
}

export async function resetPrinterProfiles(): Promise<{ success: boolean; message: string; profiles: PrinterProfile[] }> {
  const res = await fetch(`${API_BASE}/printers/profiles/reset`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reset printer profiles');
  return res.json();
}

export async function fetchEffectivePricing(): Promise<EffectivePricing> {
  const res = await fetch(`${API_BASE}/printers/pricing`);
  if (!res.ok) throw new Error('Failed to load pricing');
  return res.json();
}

export async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const res = await fetch(`${API_BASE}/tunnel`);
  if (!res.ok) throw new Error('Failed to load tunnel status');
  return res.json();
}

export async function startTunnel(): Promise<TunnelStatus> {
  const res = await fetch(`${API_BASE}/tunnel/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to start tunnel');
  return res.json();
}

export async function stopTunnel(): Promise<TunnelStatus> {
  const res = await fetch(`${API_BASE}/tunnel/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop tunnel');
  return res.json();
}

export async function setManualTunnelUrl(url: string): Promise<TunnelStatus> {
  const res = await fetch(`${API_BASE}/tunnel/set-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error('Failed to set tunnel URL');
  return res.json();
}

/**
 * Connect to WebSocket for live job and queue sync
 */
export function connectLiveWebSocket(
  onMessage: (data: any) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  let socket: WebSocket | null = null;
  let isClosedManually = false;
  let reconnectTimer: any = null;

  const connect = () => {
    if (isClosedManually) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (onStatusChange) onStatusChange(true);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (e) {
          // ignore
        }
      };

      socket.onclose = () => {
        if (onStatusChange) onStatusChange(false);
        if (!isClosedManually) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      socket.onerror = () => {
        if (onStatusChange) onStatusChange(false);
      };
    } catch (e) {
      if (!isClosedManually) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    }
  };

  connect();

  return () => {
    isClosedManually = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket) socket.close();
  };
}
