import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import QRCode from 'qrcode';
import { TunnelStatus } from '../shared/types.js';

let activeTunnelProcess: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let currentPort = 4000;

export function setServerPort(port: number) {
  currentPort = port;
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
    console.warn('[TunnelService] Failed to generate QR code:', err);
  }

  return {
    isRunning: activeTunnelProcess !== null || activeTunnelUrl !== null,
    tunnelUrl: activeTunnelUrl,
    localUrls,
    activeUrl,
    qrCodeDataUrl,
  };
}

export function setManualTunnelUrl(url: string | null): Promise<TunnelStatus> {
  activeTunnelUrl = url && url.trim() ? url.trim() : null;
  return getTunnelStatus();
}

export async function startCloudflareTunnel(onUpdate?: (status: TunnelStatus) => void): Promise<TunnelStatus> {
  if (activeTunnelProcess) {
    return getTunnelStatus();
  }

  const port = currentPort;
  const cloudflaredCmd = 'cloudflared';

  console.log(`🌐 [Cloudflare Tunnel] Spawning quick tunnel for http://localhost:${port}...`);

  return new Promise((resolve) => {
    try {
      const child = spawn(cloudflaredCmd, ['tunnel', '--url', `http://localhost:${port}`]);
      activeTunnelProcess = child;

      let resolved = false;

      const handleData = async (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
        if (match && !activeTunnelUrl) {
          activeTunnelUrl = match[0];
          console.log(`✅ [Cloudflare Tunnel] Connected! Public Customer URL: ${activeTunnelUrl}`);
          const status = await getTunnelStatus();
          if (onUpdate) onUpdate(status);
          if (!resolved) {
            resolved = true;
            resolve(status);
          }
        }
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);

      child.on('close', async (code) => {
        console.log(`[Cloudflare Tunnel] Process exited with code ${code}`);
        activeTunnelProcess = null;
        activeTunnelUrl = null;
        const status = await getTunnelStatus();
        if (onUpdate) onUpdate(status);
        if (!resolved) {
          resolved = true;
          resolve(status);
        }
      });

      child.on('error', async (err) => {
        console.error('[Cloudflare Tunnel] Failed to start cloudflared:', err.message);
        activeTunnelProcess = null;
        const status = await getTunnelStatus();
        if (!resolved) {
          resolved = true;
          resolve(status);
        }
      });

      setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          resolve(await getTunnelStatus());
        }
      }, 10000);
    } catch (err: any) {
      console.error('[Cloudflare Tunnel] Exception launching tunnel:', err.message);
      activeTunnelProcess = null;
      resolve(getTunnelStatus());
    }
  });
}

export function stopCloudflareTunnel(): Promise<TunnelStatus> {
  if (activeTunnelProcess) {
    try {
      activeTunnelProcess.kill('SIGTERM');
    } catch (e) {}
    activeTunnelProcess = null;
  }
  activeTunnelUrl = null;
  return getTunnelStatus();
}
