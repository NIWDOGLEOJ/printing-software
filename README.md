# 🖨️ Printing Software

> **Complete Walk-in Xerox & Print Station Management System with Customer Mobile Upload Portal, Multi-Protocol Auto-Discovery, Real-Time WebSockets, and CUPS Network Dispatch.**

An isolated, full-stack print management system designed for shops, retail counters, and print stations. Customers scan a counter QR code or open a web link on their mobile device or laptop, configure their print options (Black & White vs Color, Single Sided vs Front & Back Duplex, orientation, copies, page range), see a live cost estimate, and upload their document to receive an instant queue token (e.g. `#P-101`).

On the shop laptop/PC, the Admin Queue Dashboard receives instant real-time notifications via WebSockets with an audio chime, displays customer documents with an in-browser document viewer, auto-discovers network printers via Bonjour/Avahi & CUPS, and dispatches print jobs with a single click.

---

## 🌟 Key Features

1. **Customer Upload Portal (Mobile & Desktop Web)**
   - **Minimal friction**: Customer enters **Name only** (persisted in browser for return visits).
   - **File formats**: Accepts PDF, JPG, PNG, and WebP documents up to 50MB.
   - **Auto-detected page count**: Instantly reads and validates document page count.
   - **Print options**:
     - Color Mode: Black & White vs Color.
     - Sides: Single Sided vs Front & Back (Duplex / two-sided).
     - Orientation: Auto, Portrait, Landscape.
     - Copies: Stepper control (+ / -).
     - Page Range: "All Pages" or custom ranges (e.g. `1-5, 8`).
   - **Lowest Available Price Algorithm**: Dynamically calculates and displays the lowest active rate across operational printers (e.g., ₹2 B/W when high-speed IR4225 is operational; ₹3 B/W when in maintenance and routing through GX4070).
   - **Live Availability Badges**: Automatically grays out and disables "Color" or "Front & Back" if active printers lack the capability.
   - **Queue Token**: Generates clear, high-contrast queue tokens (e.g. `#P-101`) with live status tracking (`Pending` → `Printing` → `Printed`).

2. **Admin Queue & Print Management Dashboard**
   - **Real-time Live Sync via WebSockets**: Instant card arrival without manual page refresh.
   - **Synthesized Audio Chime**: Dual-tone bell chime built using the browser Web Audio API (zero audio file dependencies, works offline).
   - **Interactive Document Preview Modal**:
     - Embedded in-browser PDF viewer with zoom, pan, and page controls.
     - Responsive image viewer for photo prints.
     - Admin can inspect or override print options (target printer, color mode, sides, copies, page range) before printing.
     - "Print Now", "Mark as Printed", "Reprint", and "Delete" actions.
   - **Smart Routing**: Automatically routes jobs to the lowest-cost capable printer (e.g. routing B/W jobs to B/W production printers and Color jobs to inkjet/laser color printers).

3. **Direct WhatsApp Print Bot (Zero-Friction Customer Printing)**
   - **Send Document Directly**: Customers simply text or attach their PDF/Photo to the shop's WhatsApp number.
   - **Automatic Queue Token**: Bot instantly acknowledges, inspects page count, calculates price, and replies with a queue token (e.g. `#P-101`) and cost breakdown.
   - **Multi-File Batching**: Successive documents sent within 25 seconds are automatically grouped into a single print order.
   - **Quick Keyword Adjustments**: Customers can reply `COLOR`, `BW`, `DUPLEX`, `2 COPIES`, or `CANCEL` to modify their order directly in WhatsApp chat.
   - **1-Tap Mobile Customization Link**: Includes a direct link in the chat to visually inspect and customize print settings on their phone.
   - **Live WhatsApp Status Updates**: Sends automated alerts when printing begins and when ready for pickup at the counter.
   - **Lightweight Embedded Engine**: Built using `@whiskeysockets/baileys` directly in Node.js (zero heavy headless Chrome / minimal memory footprint).
   - **In-App Admin QR Pairing**: Link any phone by scanning the QR code in the Admin Dashboard with WhatsApp "Linked Devices".

4. **Multi-Protocol Automatic Printer Detection**
   - **Local Network (Wi-Fi / Ethernet)**: Scans mDNS / DNS-SD broadcast services (`_ipp._tcp`, `_ipps._tcp`, `_printer._tcp`, `_pdl-datastream._tcp`) via Bonjour (macOS) and Avahi (Linux).
   - **Hardware Capabilities Extraction**: Live extraction of Color (`Color=T`) and Duplex (`Duplex=T`), IPv4 address, and web management URL.
   - **Direct Hardware (USB)**: Enumerates USB-connected printers via CUPS backend probes (`lpinfo -v`).
   - **CUPS System Queues**: Cross-references configured destinations (`lpstat -p`, `lpstat -v`).
   - **Live Reachability Probing**: Real-time TCP socket health checks (`🟢 Online` vs `🔴 Offline`).

5. **Connectivity & Scannable Counter QR Standee**
   - **Local Wi-Fi URLs**: Displays LAN IPs (e.g. `http://192.168.x.x:4000/`) so customers on shop Wi-Fi can scan and upload immediately.
   - **Cloudflare Quick Tunnel**: Built-in script and admin button to launch `cloudflared tunnel --url http://localhost:4000` without requiring an account or router port forwarding, allowing customers on cellular data (4G/5G) to upload from anywhere.
   - **Printable Counter Standee**: Generates a high-contrast counter placard ready to print and display on the counter.

5. **Storage & 24-Hour Retention**
   - Uploaded documents are saved in `uploads/` with sanitized filenames.
   - Automatic background cleanup sweeps files older than 24 hours every hour.
   - Instant manual file deletion when an admin deletes a job.

---

## 🐧 Setup Guide for Linux Laptop (Arch Linux / Manjaro / EndeavourOS)

This guide walks through configuring this software on any Linux laptop using the **`pacman`** package manager.

### Option A: Automated Setup Script (Recommended)

Run the included setup script which installs all required pacman packages, starts CUPS & Avahi, installs dependencies, and builds the app:

```bash
git clone https://github.com/NIWDOGLEOJ/printing-software.git
cd printing-software
bash scripts/setup-arch-linux.sh
```

---

### Option B: Manual Step-by-Step Setup with `pacman`

#### 1. Install Node.js, pnpm, and Build Tools
```bash
sudo pacman -S --needed nodejs npm git base-devel
sudo npm install -g pnpm
```

#### 2. Install CUPS Printing System & Driver Packages
```bash
sudo pacman -S --needed cups cups-pdf cups-filters ghostscript gsfonts poppler imagemagick foomatic-db foomatic-db-engine
```

#### 3. Install Avahi for Network Printer Discovery (mDNS / DNS-SD)
```bash
sudo pacman -S --needed avahi nss-mdns
```

#### 4. Enable and Start CUPS and Avahi Services
```bash
sudo systemctl enable --now cups.service
sudo systemctl enable --now avahi-daemon.service
```

#### 5. Add Your User to `lp` and `sys` Groups
To allow your user account to execute `lp`, `lpstat`, and administer CUPS queues:
```bash
sudo usermod -aG lp,sys "$USER"
```
*(Note: Log out and log back in, or run `newgrp lp`, for the group changes to take effect).*

#### 6. Enable `.local` Hostname Resolution in `/etc/nsswitch.conf`
Open `/etc/nsswitch.conf` in your preferred text editor (e.g. `sudo nano /etc/nsswitch.conf`) and look for the `hosts:` line.
Add `mdns_minimal [NOTFOUND=return]` before `resolve` or `dns`:
```
hosts: mymachines mdns_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] files myhostname dns
```

#### 7. Optional: Install Cloudflare Tunnel (for Cellular Customer Access)
If you want customers to upload over 4G/5G mobile data without connecting to shop Wi-Fi:
```bash
sudo pacman -S --needed cloudflared
```

---

### Adding Your Printer in CUPS (Linux)

Modern network printers (such as the **Canon MAXIFY GX4070** or **imageRUNNER 4225**) support **IPP Everywhere / AirPrint**, requiring **zero proprietary drivers** on Linux:

```bash
# Verify CUPS detects your network printer:
lpinfo -v | grep -E "dnssd|socket|ipp"

# Add your printer using IPP Everywhere (driverless):
# Replace <printer-ip> with your printer's IP (e.g., 192.168.29.253):
lpadmin -p Canon_GX4070 -E -v "ipp://192.168.29.253/ipp/print" -m everywhere

# Set as default printer (optional):
lpoptions -d Canon_GX4070

# Verify printer is active:
lpstat -p -d
```

---

## 🚀 Running the Software

### 1. Install Project Dependencies
```bash
pnpm install
```

### 2. Development Mode
Runs both the Express API server and the Vite frontend with hot reload:
```bash
pnpm dev
```
- Customer Upload Portal: `http://localhost:5175/`
- Shop PC Admin Dashboard: `http://localhost:5175/admin`

### 3. Production Build & Start
```bash
pnpm run build
pnpm start
```
- By default, the server listens on `http://0.0.0.0:4000`.
- Customer Upload Portal: `http://localhost:4000/`
- Shop PC Admin Dashboard: `http://localhost:4000/admin`
- Mobile phones on local Wi-Fi: `http://<your-laptop-lan-ip>:4000/`

---

## 🔄 Running as a Background Service on Linux (`systemd`)

To automatically launch the Print Station on laptop boot in the background:

### Option A: 1-Click Automated Installer (Recommended)
Run the automated installer, which detects your user, Node/pnpm executable, and working directory, sets up permissions, and enables the service:
```bash
pnpm run service:install
# Or: bash scripts/install-systemd-service.sh
```

### Option B: Manual Configuration
1. Copy the template service file:
   ```bash
   sudo cp scripts/print-station.service /etc/systemd/system/
   ```

2. Edit the service file with your username and directory path:
   ```bash
   sudo nano /etc/systemd/system/print-station.service
   ```
   *(Update `User=your_username` and `WorkingDirectory=/home/your_username/printing-software`)*.

3. Reload systemd and enable the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now print-station.service
   ```

4. Service management commands:
   ```bash
   # Check live service status
   sudo systemctl status print-station.service

   # View live streaming logs
   sudo journalctl -u print-station.service -f

   # Restart after updating
   sudo systemctl restart print-station.service
   ```

---

## 🛡️ Linux Firewall Configuration (Optional)

If your Linux laptop runs a firewall (such as `ufw` or `firewalld`), allow incoming traffic on port 4000 for walk-in customers on the local Wi-Fi, and port 631 for CUPS:

### Using UFW (Uncomplicated Firewall)
```bash
# Allow customer upload portal
sudo ufw allow 4000/tcp comment "Print Station Web Portal"

# Allow CUPS network printing
sudo ufw allow 631/tcp comment "CUPS Printing"

# Allow mDNS network auto-discovery
sudo ufw allow 5353/udp comment "mDNS Avahi Discovery"
```

### Using firewalld
```bash
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --permanent --add-service=ipp
sudo firewall-cmd --permanent --add-service=mdns
sudo firewall-cmd --reload
```

---

## 🌐 Cloudflare Quick Tunnel (Remote Uploads)

To allow counter customers to upload documents using their phone's cellular data without connecting to shop Wi-Fi:
```bash
pnpm run tunnel
```
Or click **"Launch Quick Tunnel"** inside the Admin Dashboard.
The public URL (e.g. `https://random-words.trycloudflare.com`) will be generated, displayed in the console, and automatically encoded into the counter QR code!

---

## 🧪 Automated Testing

Run the test suite with Vitest:
```bash
pnpm test
```

Test coverage includes:
- **Printer Auto-Discovery**: mDNS / Bonjour / Avahi scanning, USB detection, IP reachability, and capability extraction.
- **Dynamic Rates & Pricing**: Lowest-available algorithm, maintenance toggle failovers, and duplex availability.
- **CUPS Printer Service**: Option formatting (Color, Duplex, Copies, Orientation, Page ranges) and Virtual Print simulation.
- **API Integration**: Document upload, file streaming, print execution, and token creation.
- **Storage & Retention**: 24-hour cleanup scheduling and immediate file deletions.

---

## 🍎 macOS Setup Quick Reference

```bash
# 1. Install pnpm (via Homebrew or npm)
brew install pnpm cloudflared

# 2. Install dependencies & build
pnpm install
pnpm run build

# 3. Start server
pnpm start
```

---

## 📄 License
MIT
