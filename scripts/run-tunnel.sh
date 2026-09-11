#!/usr/bin/env bash
set -e

PORT="${PORT:-4000}"

echo "======================================================"
echo "🌐 Launching Cloudflare Quick Tunnel for J MART Print Station"
echo "📡 Target: http://localhost:${PORT}"
echo "======================================================"

if ! command -v cloudflared &> /dev/null; then
    echo "❌ Error: 'cloudflared' CLI is not installed or not in PATH."
    echo "   Install on Arch Linux (pacman): sudo pacman -S cloudflared"
    echo "   Install on macOS (Homebrew):    brew install cloudflared"
    exit 1
fi

echo "🚀 Starting tunnel... Customers can access the upload portal without VPN or router port forwarding."
cloudflared tunnel --url "http://localhost:${PORT}"
