import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import net from 'net';
import { DiscoveredPrinter, PrinterConnectionType, PrinterProfile } from '../shared/types.js';
import { getAllPrinterProfiles, updatePrinterProfile, upsertPrinterProfile } from './db.js';

const execFileAsync = promisify(execFile);

function findBinary(name: string): string {
  const candidates = [`/usr/bin/${name}`, `/usr/sbin/${name}`, `/bin/${name}`, `/usr/local/bin/${name}`];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return name;
}

// Cached list of discovered printers
let cachedDiscoveredPrinters: DiscoveredPrinter[] = [];
let isScanningActive = false;
let discoveryInterval: NodeJS.Timeout | null = null;

/**
 * Execute dns-sd command with automatic timeout termination
 */
function runDnsSd(args: string[], timeoutMs = 1400): Promise<string> {
  return new Promise((resolve) => {
    let output = '';
    let child: any = null;
    try {
      child = spawn(findBinary('dns-sd'), args);
      child.stdout?.on('data', (d: Buffer) => {
        output += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        output += d.toString();
      });
      child.on('error', () => {
        resolve(output);
      });
    } catch {
      return resolve('');
    }

    const timer = setTimeout(() => {
      if (child) {
        try {
          child.kill('SIGTERM');
        } catch {}
      }
      resolve(output);
    }, timeoutMs);

    child.on('close', () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

/**
 * Test TCP connection to check if host & port are online (fast 800ms timeout)
 */
function testTcpPort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    const finalize = (success: boolean) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve(success);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));

    try {
      socket.connect(port, host);
    } catch {
      finalize(false);
    }
  });
}

/**
 * Discover network printers via macOS Bonjour/mDNS/DNS-SD (_ipp._tcp, _ipps._tcp, _printer._tcp, _pdl-datastream._tcp)
 */
async function discoverBonjourNetworkPrinters(): Promise<Partial<DiscoveredPrinter>[]> {
  const discovered: Partial<DiscoveredPrinter>[] = [];
  const serviceTypes = ['_ipp._tcp', '_ipps._tcp', '_printer._tcp', '_pdl-datastream._tcp'];
  const instanceNames = new Map<string, string>(); // name -> serviceType

  // 1. Browse all service types in parallel (1000ms)
  await Promise.all(
    serviceTypes.map(async (st) => {
      try {
        const browseOut = await runDnsSd(['-B', st], 1000);
        const lines = browseOut.split('\n');
        for (const line of lines) {
          const match = line.match(/\s+Add\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+)$/);
          if (match) {
            const type = match[1].trim();
            const name = match[2].trim();
            if (name && !instanceNames.has(name)) {
              instanceNames.set(name, type);
            }
          }
        }
      } catch {}
    })
  );

  // 2. Resolve each discovered instance in parallel
  const resolvePromises = Array.from(instanceNames.entries()).map(
    async ([name, serviceType]) => {
      try {
        const lookupOut = await runDnsSd(['-L', name, serviceType, 'local.'], 1000);
        const reachMatch = lookupOut.match(/reached at ([^\s:]+):(\d+)/i);
        if (!reachMatch) return;

        let hostname = reachMatch[1].trim();
        const port = parseInt(reachMatch[2], 10) || 631;

        // Extract TXT records
        const txt = lookupOut;
        const isColor = /Color=T/i.test(txt) || /URF=.*SRGB/i.test(txt);
        const isDuplex = /Duplex=T/i.test(txt) || /DM[1-9]/i.test(txt);

        // Model & Manufacturer
        let model = name;
        let manufacturer = 'Generic';
        const mfgMatch = txt.match(/usb_MFG=([^\s]+)/i);
        const mdlMatch = txt.match(/(?:usb_MDL|ty)=([^\s]+(?:\\ [^\s]+)*)/i);
        const adminUrlMatch = txt.match(/adminurl=([^\s]+)/i);

        if (mfgMatch) {
          manufacturer = mfgMatch[1].replace(/\\/g, '').trim();
        } else if (name.toLowerCase().startsWith('canon')) {
          manufacturer = 'Canon';
        } else if (name.toLowerCase().startsWith('hp')) {
          manufacturer = 'HP';
        } else if (name.toLowerCase().startsWith('epson')) {
          manufacturer = 'Epson';
        } else if (name.toLowerCase().startsWith('brother')) {
          manufacturer = 'Brother';
        }

        if (mdlMatch) {
          model = mdlMatch[1].replace(/\\ /g, ' ').replace(/\\/g, '').trim();
        }

        let adminUrl: string | undefined = undefined;
        if (adminUrlMatch) {
          adminUrl = adminUrlMatch[1].replace(/\\/g, '').trim();
        }

        // 3. Resolve IPv4 address for host
        let ipAddress: string | undefined = undefined;
        try {
          const cleanHost = hostname.replace(/\.$/, '');
          const addrOut = await runDnsSd(['-G', 'v4', cleanHost], 800);
          const addrMatch = addrOut.match(
            /\s+Add\s+\S+\s+\S+\s+\S+\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i
          );
          if (addrMatch) {
            ipAddress = addrMatch[1].trim();
          }
        } catch {}

        // Fast check if host/port is reachable
        const targetHost = ipAddress || hostname.replace(/\.$/, '');
        const isOnline = await testTcpPort(targetHost, port, 500);

        const deviceUri = `ipp://${targetHost}:${port}/ipp/print`;

        discovered.push({
          id: `bonjour:${name}:${targetHost}`,
          name,
          model,
          manufacturer,
          connectionType: 'network_bonjour',
          hostname: hostname.replace(/\.$/, ''),
          ipAddress,
          port,
          deviceUri,
          supportsColor: isColor,
          supportsDuplex: isDuplex,
          isOnline,
          status: isOnline ? 'online' : 'offline',
          adminUrl: adminUrl || (ipAddress ? `http://${ipAddress}/` : undefined),
          lastSeen: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`[PrinterDiscovery] Failed resolving ${name}:`, err);
      }
    }
  );

  await Promise.all(resolvePromises);
  return discovered;
}

/**
 * Discover network printers on Linux via Avahi (avahi-browse -r -t -p _ipp._tcp)
 */
async function discoverAvahiNetworkPrinters(): Promise<Partial<DiscoveredPrinter>[]> {
  const avahiCmd = findBinary('avahi-browse');
  if (!fs.existsSync(avahiCmd) && avahiCmd !== 'avahi-browse') return [];

  const discovered: Partial<DiscoveredPrinter>[] = [];
  try {
    const { stdout } = await execFileAsync(avahiCmd, ['-r', '-t', '-p', '_ipp._tcp'], { timeout: 2500 });
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (!line.startsWith('=')) continue;
      const parts = line.split(';');
      if (parts.length < 9) continue;

      const rawName = parts[3]?.trim().replace(/\\032/g, ' ') || 'Network Printer';
      const hostname = parts[6]?.trim() || '';
      const ipAddress = parts[7]?.trim() || '';
      const port = parseInt(parts[8]?.trim(), 10) || 631;
      const rawTxt = parts.slice(9).join(';');

      const isColor = /Color=T/i.test(rawTxt) || /ColorMode=Color/i.test(rawTxt);
      const isDuplex = /Duplex=T/i.test(rawTxt) || /sides=two/i.test(rawTxt);
      const adminMatch = rawTxt.match(/adminurl="?([^";\s]+)"?/i);
      const adminUrl = adminMatch ? adminMatch[1] : (ipAddress ? `http://${ipAddress}/` : undefined);

      const isOnline = ipAddress ? await testTcpPort(ipAddress, port, 800) : false;

      discovered.push({
        id: `net:${rawName}_${ipAddress || hostname}`,
        name: rawName,
        model: rawName,
        manufacturer: rawName.split(' ')[0] || 'Network',
        connectionType: 'network_bonjour',
        ipAddress: ipAddress || undefined,
        hostname: hostname || undefined,
        port,
        deviceUri: `ipp://${ipAddress || hostname}:${port}/ipp/print`,
        supportsColor: isColor,
        supportsDuplex: isDuplex,
        isOnline,
        status: isOnline ? 'online' : 'offline',
        adminUrl,
        lastSeen: new Date().toISOString(),
      });
    }
  } catch {
    // avahi-browse not available or no output
  }

  return discovered;
}

/**
 * Discover hardware & backend connected devices via lpinfo -v (USB, direct, network)
 */
async function discoverLpinfoDevices(): Promise<Partial<DiscoveredPrinter>[]> {
  const discovered: Partial<DiscoveredPrinter>[] = [];
  try {
    const { stdout } = await execFileAsync(findBinary('lpinfo'), ['-v'], { timeout: 3000 });
    const lines = stdout.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\S+)/);
      if (!match) continue;

      const kind = match[1].toLowerCase();
      const uri = match[2].trim();

      // USB Direct connected printer
      if (kind === 'direct' && uri.startsWith('usb://')) {
        // e.g. usb://Canon/GX4000%20series?serial=...
        const urlObj = new URL(uri);
        const mfg = decodeURIComponent(urlObj.hostname || 'USB Printer');
        const mdl = decodeURIComponent(urlObj.pathname.replace(/^\//, '') || 'Printer');
        const fullName = `${mfg} ${mdl}`.trim();

        discovered.push({
          id: `usb:${uri}`,
          name: fullName,
          model: mdl,
          manufacturer: mfg,
          connectionType: 'usb_direct',
          deviceUri: uri,
          supportsColor: true,
          supportsDuplex: true,
          isOnline: true,
          status: 'online',
          lastSeen: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    // lpinfo might fail or timeout on non-CUPS systems
  }

  return discovered;
}

/**
 * Discover CUPS configured printer queues via lpstat (-p, -v, -d)
 */
async function discoverCupsQueues(): Promise<Partial<DiscoveredPrinter>[]> {
  const queues: Partial<DiscoveredPrinter>[] = [];
  let defaultPrinter = '';

  try {
    // 1. Default destination
    try {
      const { stdout: dOut } = await execFileAsync(findBinary('lpstat'), ['-d'], { timeout: 2000 });
      const dMatch = dOut.match(/system default destination:\s*(\S+)/i);
      if (dMatch) defaultPrinter = dMatch[1].trim();
    } catch {}

    // 2. Queue statuses
    const { stdout: pOut } = await execFileAsync(findBinary('lpstat'), ['-p'], { timeout: 2000 });
    const pLines = pOut.split('\n');

    // 3. Queue devices
    const deviceMap = new Map<string, string>();
    try {
      const { stdout: vOut } = await execFileAsync(findBinary('lpstat'), ['-v'], { timeout: 2000 });
      for (const vLine of vOut.split('\n')) {
        const vMatch = vLine.match(/^device for (\S+):\s*(.+)$/i);
        if (vMatch) {
          deviceMap.set(vMatch[1].trim(), vMatch[2].trim());
        }
      }
    } catch {}

    for (const line of pLines) {
      const match = line.match(/^printer\s+(\S+)\s+is\s+([^.]+)/i);
      if (!match) continue;

      const queueName = match[1].trim();
      const rawState = match[2].toLowerCase();
      const deviceUri = deviceMap.get(queueName) || `cups://${queueName}`;

      let status: 'online' | 'idle' | 'printing' | 'offline' = 'idle';
      if (rawState.includes('idle')) status = 'idle';
      else if (rawState.includes('printing')) status = 'printing';
      else if (rawState.includes('disabled') || rawState.includes('stopped')) status = 'offline';

      const isNetwork =
        deviceUri.includes('dnssd://') ||
        deviceUri.includes('ipp://') ||
        deviceUri.includes('ipps://') ||
        deviceUri.includes('socket://');

      const isUsb = deviceUri.includes('usb://');

      const connType: PrinterConnectionType = isUsb
        ? 'usb_direct'
        : isNetwork
        ? 'network_bonjour'
        : 'cups_queue';

      // Human-friendly name from queue name (replacing underscores with spaces)
      const cleanName = queueName.replace(/_/g, ' ');

      queues.push({
        id: `cups:${queueName}`,
        name: cleanName,
        model: cleanName,
        manufacturer: cleanName.split(' ')[0] || 'CUPS',
        cupsPrinterName: queueName,
        connectionType: connType,
        deviceUri,
        supportsColor: true,
        supportsDuplex: true,
        isOnline: status !== 'offline',
        status,
        lastSeen: new Date().toISOString(),
      });
    }
  } catch (err) {
    // ignore
  }

  return queues;
}

/**
 * Intelligent Profile Matching: Matches a discovered printer to an existing profile in DB
 */
function findMatchingProfile(
  device: Partial<DiscoveredPrinter>,
  profiles: PrinterProfile[]
): { profileId?: string; profileName?: string } {
  const dName = (device.name || '').toLowerCase();
  const dModel = (device.model || '').toLowerCase();
  const dCups = (device.cupsPrinterName || '').toLowerCase();
  const dUri = (device.deviceUri || '').toLowerCase();

  // Prioritize primary predefined profiles (gx4070, ir4225) over dynamic additions
  const sortedProfiles = [...profiles].sort((a, b) => {
    const aIsPrimary = a.id === 'gx4070' || a.id === 'ir4225' ? 1 : 0;
    const bIsPrimary = b.id === 'gx4070' || b.id === 'ir4225' ? 1 : 0;
    return bIsPrimary - aIsPrimary;
  });

  for (const p of sortedProfiles) {
    const pName = p.name.toLowerCase();
    const pCups = p.cups_printer_name.toLowerCase();

    // Direct CUPS match
    if (dCups && pCups && (dCups === pCups || dCups.includes(pCups) || pCups.includes(dCups))) {
      return { profileId: p.id, profileName: p.name };
    }

    // Specific known printer keywords:
    // Canon GX4070 / GX4000 series match
    const isGxProfile = pName.includes('gx4070') || pName.includes('gx4000') || p.id === 'gx4070';
    const isGxDevice =
      dName.includes('gx4000') ||
      dName.includes('gx4070') ||
      dModel.includes('gx4000') ||
      dCups.includes('gx4000');
    if (isGxProfile && isGxDevice) {
      return { profileId: p.id, profileName: p.name };
    }

    // Canon imageRUNNER 4225 match
    const isIrProfile =
      pName.includes('4225') || pName.includes('imagerunner') || p.id === 'ir4225';
    const isIrDevice =
      dName.includes('4225') ||
      dName.includes('imagerunner') ||
      dModel.includes('4225') ||
      dCups.includes('4225');
    if (isIrProfile && isIrDevice) {
      return { profileId: p.id, profileName: p.name };
    }

    // URI match
    if (pCups && dUri.includes(pCups)) {
      return { profileId: p.id, profileName: p.name };
    }
  }

  return {};
}

/**
 * Merge and deduplicate discovered printers across Bonjour, lpinfo, and CUPS
 */
function mergeAndDeduplicatePrinters(
  bonjourPrinters: Partial<DiscoveredPrinter>[],
  lpinfoPrinters: Partial<DiscoveredPrinter>[],
  cupsPrinters: Partial<DiscoveredPrinter>[],
  profiles: PrinterProfile[]
): DiscoveredPrinter[] {
  const map = new Map<string, DiscoveredPrinter>();

  // 1. Add all CUPS configured queues
  for (const c of cupsPrinters) {
    const key = (c.cupsPrinterName || c.name || '').toLowerCase();
    const matched = findMatchingProfile(c, profiles);
    map.set(key, {
      id: c.id || `cups:${key}`,
      name: c.name || 'Printer',
      model: c.model || 'Printer',
      manufacturer: c.manufacturer || 'CUPS',
      connectionType: c.connectionType || 'cups_queue',
      cupsPrinterName: c.cupsPrinterName,
      deviceUri: c.deviceUri || '',
      supportsColor: c.supportsColor ?? true,
      supportsDuplex: c.supportsDuplex ?? true,
      isOnline: c.isOnline ?? true,
      status: c.status || 'idle',
      matchedProfileId: matched.profileId,
      matchedProfileName: matched.profileName,
      lastSeen: c.lastSeen || new Date().toISOString(),
    });
  }

  // 2. Merge Bonjour network printers (updating IP, Hostname, real capabilities)
  for (const b of bonjourPrinters) {
    let matchedKey: string | null = null;
    const bNameClean = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const [key, existing] of map.entries()) {
      const eNameClean = existing.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const eCupsClean = (existing.cupsPrinterName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check if existing CUPS queue corresponds to this Bonjour device
      if (
        eNameClean === bNameClean ||
        eCupsClean === bNameClean ||
        existing.deviceUri.toLowerCase().includes(encodeURIComponent(b.name || '')) ||
        (existing.name.toLowerCase().includes('gx4000') && bNameClean.includes('gx4000')) ||
        (existing.name.toLowerCase().includes('4225') && bNameClean.includes('4225'))
      ) {
        matchedKey = key;
        break;
      }
    }

    const matched = findMatchingProfile(b, profiles);

    if (matchedKey) {
      const existing = map.get(matchedKey)!;
      map.set(matchedKey, {
        ...existing,
        ipAddress: b.ipAddress || existing.ipAddress,
        hostname: b.hostname || existing.hostname,
        port: b.port || existing.port,
        adminUrl: b.adminUrl || existing.adminUrl,
        supportsColor: b.supportsColor !== undefined ? b.supportsColor : existing.supportsColor,
        supportsDuplex: b.supportsDuplex !== undefined ? b.supportsDuplex : existing.supportsDuplex,
        isOnline: b.isOnline ?? existing.isOnline,
        status: b.isOnline ? existing.status : 'offline',
        matchedProfileId: matched.profileId || existing.matchedProfileId,
        matchedProfileName: matched.profileName || existing.matchedProfileName,
        lastSeen: new Date().toISOString(),
      });
    } else {
      // New network printer discovered on LAN not yet in CUPS
      const newKey = `network:${b.name}:${b.ipAddress || b.hostname}`.toLowerCase();
      map.set(newKey, {
        id: b.id || newKey,
        name: b.name || 'Network Printer',
        model: b.model || 'Network Printer',
        manufacturer: b.manufacturer || 'Network',
        connectionType: 'network_bonjour',
        ipAddress: b.ipAddress,
        hostname: b.hostname,
        port: b.port,
        deviceUri: b.deviceUri || '',
        supportsColor: b.supportsColor ?? true,
        supportsDuplex: b.supportsDuplex ?? true,
        isOnline: b.isOnline ?? true,
        status: b.isOnline ? 'online' : 'offline',
        adminUrl: b.adminUrl,
        matchedProfileId: matched.profileId,
        matchedProfileName: matched.profileName,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // 3. Merge USB Direct printers
  for (const u of lpinfoPrinters) {
    let matchedKey: string | null = null;
    const uNameClean = (u.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const [key, existing] of map.entries()) {
      const eNameClean = existing.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        eNameClean === uNameClean ||
        existing.deviceUri.toLowerCase().includes(encodeURIComponent(u.name || ''))
      ) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      const existing = map.get(matchedKey)!;
      map.set(matchedKey, {
        ...existing,
        connectionType: 'usb_direct',
        isOnline: true,
      });
    } else {
      const matched = findMatchingProfile(u, profiles);
      const newKey = `usb:${u.name}`.toLowerCase();
      map.set(newKey, {
        id: u.id || newKey,
        name: u.name || 'USB Printer',
        model: u.model || 'USB Printer',
        manufacturer: u.manufacturer || 'USB',
        connectionType: 'usb_direct',
        deviceUri: u.deviceUri || '',
        supportsColor: u.supportsColor ?? true,
        supportsDuplex: u.supportsDuplex ?? true,
        isOnline: true,
        status: 'online',
        matchedProfileId: matched.profileId,
        matchedProfileName: matched.profileName,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Perform a full multi-protocol scan across network (Bonjour), USB, and CUPS
 */
export async function discoverAllPrinters(): Promise<DiscoveredPrinter[]> {
  if (isScanningActive) {
    return cachedDiscoveredPrinters;
  }

  isScanningActive = true;
  try {
    const profiles = getAllPrinterProfiles();

    // Run scans concurrently with timeouts
    const [bonjourRes, avahiRes, lpinfoRes, cupsRes] = await Promise.allSettled([
      discoverBonjourNetworkPrinters(),
      discoverAvahiNetworkPrinters(),
      discoverLpinfoDevices(),
      discoverCupsQueues(),
    ]);

    const bonjourPrinters = [
      ...(bonjourRes.status === 'fulfilled' ? bonjourRes.value : []),
      ...(avahiRes.status === 'fulfilled' ? avahiRes.value : []),
    ];
    const lpinfoPrinters = lpinfoRes.status === 'fulfilled' ? lpinfoRes.value : [];
    const cupsPrinters = cupsRes.status === 'fulfilled' ? cupsRes.value : [];

    const merged = mergeAndDeduplicatePrinters(
      bonjourPrinters,
      lpinfoPrinters,
      cupsPrinters,
      profiles
    );

    cachedDiscoveredPrinters = merged;

    // Auto-update profiles in DB if cups_printer_name was missing or can be verified
    for (const dev of merged) {
      if (dev.matchedProfileId && dev.cupsPrinterName) {
        const prof = profiles.find((p: PrinterProfile) => p.id === dev.matchedProfileId);
        if (prof && !prof.cups_printer_name) {
          updatePrinterProfile(prof.id, {
            cups_printer_name: dev.cupsPrinterName,
          });
        }
      }
    }

    return merged;
  } catch (err) {
    console.error('[PrinterDiscovery] Scan error:', err);
    return cachedDiscoveredPrinters;
  } finally {
    isScanningActive = false;
  }
}

/**
 * Return current cached discovered printers
 */
export function getLatestDiscoveredPrinters(): DiscoveredPrinter[] {
  return cachedDiscoveredPrinters;
}

/**
 * Trigger immediate scan
 */
export async function scanPrintersNow(broadcast?: (data: any) => void): Promise<DiscoveredPrinter[]> {
  const printers = await discoverAllPrinters();
  if (broadcast) {
    broadcast({
      type: 'PRINTERS_DISCOVERED',
      discoveredPrinters: printers,
    });
  }
  return printers;
}

/**
 * Link a discovered device to an existing printer profile
 */
export async function linkDiscoveredPrinterToProfile(
  discoveredId: string,
  profileId: string,
  broadcast?: (data: any) => void
): Promise<PrinterProfile> {
  const device = cachedDiscoveredPrinters.find((d) => d.id === discoveredId);
  if (!device) {
    throw new Error('Discovered printer not found. Run a fresh scan.');
  }

  const cupsName = device.cupsPrinterName || device.name.replace(/\s+/g, '_');
  const updated = updatePrinterProfile(profileId, {
    cups_printer_name: cupsName,
    supports_color: device.supportsColor,
    supports_duplex: device.supportsDuplex,
    is_active: device.isOnline,
  });

  if (!updated) {
    throw new Error(`Printer profile with ID ${profileId} not found`);
  }

  // Re-run scan to update matches
  await scanPrintersNow(broadcast);

  return updated;
}

/**
 * Create a new printer profile directly from a discovered device
 */
export async function createProfileFromDiscovered(
  discoveredId: string,
  broadcast?: (data: any) => void
): Promise<PrinterProfile> {
  const device = cachedDiscoveredPrinters.find((d) => d.id === discoveredId);
  if (!device) {
    throw new Error('Discovered printer not found');
  }

  const newId = `profile_${Date.now()}`;
  const cupsName = device.cupsPrinterName || device.name.replace(/\s+/g, '_');

  const created = upsertPrinterProfile({
    id: newId,
    name: device.name,
    cups_printer_name: cupsName,
    supports_color: device.supportsColor,
    supports_duplex: device.supportsDuplex,
    duplex_enabled: device.supportsDuplex,
    is_active: device.isOnline,
    bw_single_price: 3,
    bw_duplex_price: 5,
    color_single_price: device.supportsColor ? 10 : 0,
    color_duplex_price: device.supportsColor && device.supportsDuplex ? 18 : 0,
  });

  await scanPrintersNow(broadcast);
  return created;
}

/**
 * Initialize background discovery scheduler (runs every 25s)
 */
export function initPrinterDiscoveryScheduler(broadcast: (data: any) => void) {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
  }

  // Initial scan after 2 seconds
  setTimeout(async () => {
    try {
      const printers = await discoverAllPrinters();
      broadcast({
        type: 'PRINTERS_DISCOVERED',
        discoveredPrinters: printers,
      });
      console.log(`📡 [PrinterDiscovery] Initial scan detected ${printers.length} printer(s):`);
      printers.forEach((p: DiscoveredPrinter) => {
        console.log(
          `   • ${p.name} [${p.connectionType}] -> ${p.ipAddress || p.deviceUri} (${p.status})`
        );
      });
    } catch (e) {
      console.warn('[PrinterDiscovery] Initial scan failed:', e);
    }
  }, 2000);

  // Periodic poll every 25 seconds
  discoveryInterval = setInterval(async () => {
    try {
      const printers = await discoverAllPrinters();
      broadcast({
        type: 'PRINTERS_DISCOVERED',
        discoveredPrinters: printers,
      });
    } catch (e) {
      // background scan fail silently
    }
  }, 25000);

  return () => {
    if (discoveryInterval) {
      clearInterval(discoveryInterval);
      discoveryInterval = null;
    }
  };
}
