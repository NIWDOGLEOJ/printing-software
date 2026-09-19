#!/usr/bin/env bash
set -e

PORT="${PORT:-4000}"

echo "======================================================"
echo "🌐 Launching Internet Tunnel for Print Station"
echo "📡 Target: http://localhost:${PORT}"
echo "======================================================"

# 1. Try Cloudflare Quick Tunnel if installed
if command -v cloudflared &> /dev/null; then
    echo "🚀 Launching Cloudflare Quick Tunnel (trycloudflare.com)..."
    exec cloudflared tunnel --url "http://localhost:${PORT}"
fi

# 2. Fallback to zero-install SSH Tunnel via localhost.run
if command -v ssh &> /dev/null; then
    echo "💡 'cloudflared' not found. Falling back to zero-install SSH tunnel (localhost.run)..."
    echo "   (Pre-installed on Linux & macOS — no account or package setup needed)"
    echo "======================================================"
    exec ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:"${PORT}" nokey@localhost.run
fi

echo "❌ Error: Neither 'cloudflared' nor 'ssh' was found on your system."
echo "   Install cloudflared via pacman: sudo pacman -S cloudflared"
echo "   Or install OpenSSH:             sudo pacman -S openssh"
exit 1
