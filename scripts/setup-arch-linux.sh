#!/usr/bin/env bash
# ==============================================================================
# Setup Script for Arch Linux / Manjaro / EndeavourOS (pacman)
# Sets up CUPS, Avahi (mDNS/DNS-SD), Node.js, pnpm, and Printing Software
# ==============================================================================
set -e

echo "🖨️  Setting up Printing Software dependencies on Arch Linux..."

# 1. Update and install required packages
echo "📦 Installing system dependencies via pacman..."
sudo pacman -S --needed --noconfirm \
  nodejs \
  npm \
  git \
  base-devel \
  cups \
  cups-pdf \
  cups-filters \
  ghostscript \
  gsfonts \
  poppler \
  imagemagick \
  avahi \
  nss-mdns

# Optional cloudflared for remote customer upload
if pacman -Si cloudflared &> /dev/null; then
  sudo pacman -S --needed --noconfirm cloudflared || true
fi

# 2. Install pnpm if not present
if ! command -v pnpm &> /dev/null; then
  echo "📦 Installing pnpm..."
  sudo npm install -g pnpm
fi

# 3. Add user to lp and sys groups for printer access
echo "👤 Adding $USER to lp and sys groups..."
sudo usermod -aG lp,sys "$USER" || true

# 4. Enable and start CUPS & Avahi services
echo "⚙️  Starting system services (CUPS & Avahi)..."
sudo systemctl enable --now cups.service
sudo systemctl enable --now avahi-daemon.service

# 5. Configure nsswitch.conf for .local mDNS hostname resolution if not already present
if ! grep -q "mdns_minimal" /etc/nsswitch.conf; then
  echo "🌐 Configuring /etc/nsswitch.conf for mDNS (.local) resolution..."
  sudo sed -i 's/^hosts:.*/& mdns_minimal [NOTFOUND=return]/' /etc/nsswitch.conf || true
fi

# 6. Install project node dependencies
echo "📥 Installing project dependencies..."
pnpm install

# 7. Build the project
echo "🔨 Building frontend and backend..."
pnpm run build

echo "======================================================================"
echo "✅ Setup Complete!"
echo "👉 Run development mode:    pnpm dev"
echo "👉 Run production mode:     pnpm start"
echo "👉 Launch Cloudflare tunnel: pnpm run tunnel"
echo "======================================================================"
