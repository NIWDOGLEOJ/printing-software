import os from 'os';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import QRCode from 'qrcode';
import { TunnelStatus, TunnelSettings } from '../shared/types.js';
import { getTunnelSettings, updateTunnelSettings } from './db.js';

let activeTunnelProcess: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let activeProvider: 'cloudflare' | 'ssh' | 'custom' | 'none' = 'none';
let currentPort = 4000;
let isStarting = false;
let shouldBeRunning = false;
let lastTunnelError: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let globalBroadcast: ((data: any) => void) | null = null;

export function setServerPort(port: number) {
  currentPort = port;
}

function findBinary(name: string): string {
  const candidates = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/bin/${name}`,
    `/usr/sbin/${name}`,
    `/usr/local/sbin/${name}`,
    `${process.env.HOME || ''}/.local/bin/${name}`,
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return name;
}

export function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(`http://${net.address}:${currentPort}`);
      }
    }
  }

  if (addresses.length === 0) {
    addresses.push(`http://localhost:${currentPort}`);
  }

  return addresses;
}

export async function getTunnelStatus(): Promise<TunnelStatus> {
  const localUrls = getLocalIpAddresses();
  const settings = getTunnelSettings();

  // If a manual URL is set in settings and no active process, use it
  if (!activeTunnelUrl && settings.manual_url) {
    activeTunnelUrl = settings.manual_url;
    activeProvider = 'custom';
  }

  const activeUrl = activeTunnelUrl || localUrls[0] || `http://localhost:${currentPort}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(activeUrl, {
      margin: 2,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.warn('[TunnelService] Failed generating QR code:', err);
  }

  return {
    isRunning: activeTunnelProcess !== null || activeTunnelUrl !== null,
    tunnelUrl: activeTunnelUrl,
    localUrls,
    activeUrl,
    qrCodeDataUrl,
    provider: activeProvider,
    autoStart: settings.auto_start,
    error: lastTunnelError,
  };
}

export async function setManualTunnelUrl(url: string | null): Promise<TunnelStatus> {
  activeTunnelUrl = url && url.trim() ? url.trim() : null;
  activeProvider = activeTunnelUrl ? 'custom' : 'none';
  updateTunnelSettings({ manual_url: activeTunnelUrl || '' });
  return getTunnelStatus();
}

/**
 * Launch Cloudflare Quick Tunnel (trycloudflare.com)
 */
function spawnCloudflareTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cloudflaredBin = findBinary('cloudflared');
    console.log(`🌐 [TunnelService] Starting Cloudflare tunnel using: ${cloudflaredBin} for port ${port}...`);

    let child: ChildProcess;
    try {
      child = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${port}`]);
    } catch (err: any) {
      return reject(new Error(`Could not spawn cloudflared: ${err.message}`));
    }

    activeTunnelProcess = child;
    activeProvider = 'cloudflare';
    let settled = false;

    const handleData = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
      if (match && !settled) {
        settled = true;
        resolve(match[0]);
      }
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      console.log(`[TunnelService] Cloudflare tunnel process closed (code ${code})`);
      if (activeTunnelProcess === child) {
        activeTunnelProcess = null;
        activeTunnelUrl = null;
        activeProvider = 'none';
      }
      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared exited with code ${code}`));
      } else {
        handleTunnelUnexpectedExit();
      }
    });

    // Timeout if URL not extracted within 12 seconds
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new Error('Cloudflare tunnel connection timed out (no URL returned)'));
      }
    }, 12000);
  });
}

/**
 * Launch Zero-Installation SSH Tunnel via localhost.run (preinstalled on Linux/macOS)
 */
function spawnSshTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sshBin = findBinary('ssh');
    console.log(`🌐 [TunnelService] Starting zero-install SSH tunnel (localhost.run) using: ${sshBin}...`);

    let child: ChildProcess;
    try {
      child = spawn(sshBin, [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ExitOnForwardFailure=yes',
        '-R', `80:localhost:${port}`,
        'nokey@localhost.run',
      ]);
    } catch (err: any) {
      return reject(new Error(`Could not spawn ssh: ${err.message}`));
    }

    activeTunnelProcess = child;
    activeProvider = 'ssh';
    let settled = false;

    const handleData = (chunk: Buffer) => {
      const text = chunk.toString();
      // Match https://...lhr.life or https://...localhost.run
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.(?:lhr\.life|localhost\.run)/i);
      if (match && !settled) {
        settled = true;
        resolve(match[0]);
      }
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      console.log(`[TunnelService] SSH tunnel process closed (code ${code})`);
      if (activeTunnelProcess === child) {
        activeTunnelProcess = null;
        activeTunnelUrl = null;
        activeProvider = 'none';
      }
      if (!settled) {
        settled = true;
        reject(new Error(`SSH tunnel exited with code ${code}`));
      } else {
        handleTunnelUnexpectedExit();
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill('SIGTERM');
        } catch {}
        reject(new Error('SSH tunnel connection timed out (no URL returned)'));
      }
    }, 12000);
  });
}

function handleTunnelUnexpectedExit() {
  if (!shouldBeRunning) return;

  if (reconnectTimer) clearTimeout(reconnectTimer);
  console.log('🔄 [TunnelService] Tunnel dropped unexpectedly. Reconnecting in 5s...');
  reconnectTimer = setTimeout(async () => {
    if (shouldBeRunning && !activeTunnelProcess) {
      try {
        const updated = await startTunnel('auto', globalBroadcast || undefined);
        if (globalBroadcast) {
          globalBroadcast({ type: 'TUNNEL_UPDATED', tunnel: updated });
        }
      } catch (e: any) {
        console.warn('[TunnelService] Auto-reconnect failed:', e.message);
      }
    }
  }, 5000);
}

/**
 * Start tunnel with multi-provider fallback
 */
export async function startTunnel(
  provider: 'auto' | 'cloudflare' | 'ssh' = 'auto',
  onUpdate?: (status: TunnelStatus) => void
): Promise<TunnelStatus> {
  if (activeTunnelProcess && activeTunnelUrl) {
    return getTunnelStatus();
  }

  if (isStarting) {
    return getTunnelStatus();
  }

  isStarting = true;
  shouldBeRunning = true;
  lastTunnelError = null;

  const port = currentPort;

  try {
    let tunnelUrl = '';

    if (provider === 'cloudflare') {
      tunnelUrl = await spawnCloudflareTunnel(port);
    } else if (provider === 'ssh') {
      tunnelUrl = await spawnSshTunnel(port);
    } else {
      // Auto mode: try Cloudflare first, fallback to SSH
      try {
        tunnelUrl = await spawnCloudflareTunnel(port);
      } catch (cfErr: any) {
        console.warn(`[TunnelService] Cloudflare unavailable (${cfErr.message}). Failing over to SSH localhost.run...`);
        tunnelUrl = await spawnSshTunnel(port);
      }
    }

    activeTunnelUrl = tunnelUrl;
    console.log(`\n======================================================`);
    console.log(`🚀 [TunnelService] Public Customer Portal Live!`);
    console.log(`🔗 URL: ${tunnelUrl}`);
    console.log(`📱 Counter customers can upload directly from 4G/5G mobile!`);
    console.log(`======================================================\n`);

    const status = await getTunnelStatus();
    if (onUpdate) onUpdate(status);
    return status;
  } catch (err: any) {
    lastTunnelError = err.message || 'Failed to start tunnel';
    console.error('[TunnelService] Tunnel startup failed:', lastTunnelError);
    activeTunnelProcess = null;
    activeTunnelUrl = null;
    activeProvider = 'none';
    const status = await getTunnelStatus();
    if (onUpdate) onUpdate(status);
    return status;
  } finally {
    isStarting = false;
  }
}

/**
 * Backward compatible alias for Cloudflare tunnel
 */
export async function startCloudflareTunnel(onUpdate?: (status: TunnelStatus) => void): Promise<TunnelStatus> {
  return startTunnel('auto', onUpdate);
}

/**
 * Stop active tunnel and disable auto-reconnect
 */
export async function stopTunnel(): Promise<TunnelStatus> {
  shouldBeRunning = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeTunnelProcess) {
    try {
      activeTunnelProcess.kill('SIGTERM');
    } catch {}
    activeTunnelProcess = null;
  }
  activeTunnelUrl = null;
  activeProvider = 'none';
  lastTunnelError = null;

  return getTunnelStatus();
}

/**
 * Backward compatible alias for stop
 */
export async function stopCloudflareTunnel(): Promise<TunnelStatus> {
  return stopTunnel();
}

/**
 * Initialize Tunnel Service on server startup
 */
export async function initTunnelService(broadcast?: (data: any) => void) {
  if (broadcast) {
    globalBroadcast = broadcast;
  }

  const settings = getTunnelSettings();
  const envAutoStart = process.env.AUTO_START_TUNNEL;
  const shouldAutoStart = envAutoStart !== undefined ? envAutoStart === 'true' : settings.auto_start;

  if (shouldAutoStart) {
    console.log('🌐 [TunnelService] Auto-starting tunnel on boot...');
    setTimeout(async () => {
      try {
        const preferred = settings.preferred_provider === 'custom' ? 'auto' : settings.preferred_provider;
        const status = await startTunnel(preferred, broadcast);
        if (broadcast) {
          broadcast({
            type: 'TUNNEL_UPDATED',
            tunnel: status,
          });
        }
      } catch (err: any) {
        console.warn('[TunnelService] Initial auto-start failed:', err.message);
      }
    }, 1500);
  }
}
