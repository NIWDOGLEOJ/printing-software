import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';

import { createJobsRouter } from './routes/jobs.js';
import { createPrintersRouter } from './routes/printers.js';
import { createShopRouter } from './routes/shop.js';
import { createSettingsRouter } from './routes/settings.js';
import { createTunnelRouter } from './routes/tunnel.js';
import { createAuthRouter } from './routes/auth.js';
import { createWhatsAppRouter } from './routes/whatsapp.js';
import { setWhatsAppBroadcast } from './whatsappService.js';
import { initRetentionScheduler } from './storageService.js';
import { initPrinterDiscoveryScheduler } from './printerDiscoveryService.js';
import { setServerPort, getLocalIpAddresses } from './tunnelService.js';
import { getShopDetails } from './shopService.js';
import { getPrinters } from './printerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '4000', 10);
setServerPort(PORT);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middlewares
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Broadcast helper for real-time WebSocket sync
const broadcast = (data: any) => {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (e) {
        // ignore broken socket
      }
    }
  });
};

// WebSocket connection lifecycle
wss.on('connection', (ws) => {
  try {
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Print Station Live Connected' }));
  } catch (e) {}

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {}
  });
});

// API Routes
app.use('/api/auth', createAuthRouter());
app.use('/api/jobs', createJobsRouter(broadcast));
app.use('/api/printers', createPrintersRouter(broadcast));
app.use('/api/shop', createShopRouter());
app.use('/api/settings', createSettingsRouter(broadcast));
app.use('/api/tunnel', createTunnelRouter(broadcast));
app.use('/api/whatsapp', createWhatsAppRouter());

setWhatsAppBroadcast(broadcast);

// Static files for production built frontend
function getDistPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, '../../dist'),
    path.resolve(__dirname, '../dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return null;
}

const distPath = getDistPath();
if (distPath) {
  console.log(`📦 Serving static client build from: ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn('⚠️ No static build found in dist/. Run "pnpm build" or start Vite dev server.');
}

// Global error handling middleware (returns clean JSON errors)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Unhandled Error]:', err?.message || err);
  const status = typeof err.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

// Start background retention scheduler (24h retention)
initRetentionScheduler();

// Start background network & hardware printer auto-discovery (every 25s)
initPrinterDiscoveryScheduler(broadcast);

// Start Server
server.listen(PORT, async () => {
  const shop = getShopDetails();
  const printers = await getPrinters();
  const localIps = getLocalIpAddresses();

  console.log(`\n======================================================`);
  console.log(`🖨️  ${shop.shopName} - Quick Print Station & Management Server`);
  console.log(`📍 Shop: ${shop.shopAddress} (GSTIN: ${shop.gstNumber || 'N/A'})`);
  console.log(`📡 Server Port: ${PORT}`);
  console.log(`💻 Admin PC Queue Dashboard: http://localhost:${PORT}/admin`);
  console.log(`📱 Customer Upload Portal:  http://localhost:${PORT}/`);
  if (localIps.length > 0) {
    console.log(`📶 Local Wi-Fi Counter URLs:`);
    localIps.forEach(ip => console.log(`   👉 ${ip}/`));
  }
  console.log(`🖨️  Detected Printers (${printers.length}):`);
  printers.forEach(p => console.log(`   ${p.isDefault ? '⭐' : '•'} ${p.name} [${p.status}]`));
  console.log(`======================================================\n`);
});

export { app, server, broadcast };
