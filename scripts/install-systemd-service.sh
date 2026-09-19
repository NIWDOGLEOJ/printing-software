#!/usr/bin/env bash
# ==============================================================================
# Automated Systemd Service Installer for Linux
# Configures and enables print-station.service with auto-detected user & paths
# ==============================================================================
set -e

# Detect target project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Detect user
CURRENT_USER="${SUDO_USER:-$USER}"
if [ -z "$CURRENT_USER" ] || [ "$CURRENT_USER" = "root" ]; then
  CURRENT_USER="$(logname 2>/dev/null || whoami)"
fi

# Detect pnpm / node
PNPM_BIN="$(command -v pnpm || echo "/usr/bin/pnpm")"
NODE_BIN="$(command -v node || echo "/usr/bin/node")"

echo "🖨️  Installing Print Station Systemd Background Service..."
echo "👤 Target User:       ${CURRENT_USER}"
echo "📁 Project Directory: ${PROJECT_DIR}"
echo "⚡ pnpm Executable:   ${PNPM_BIN}"

# Ensure uploads directory exists with correct ownership
mkdir -p "${PROJECT_DIR}/uploads"
chown -R "${CURRENT_USER}:${CURRENT_USER}" "${PROJECT_DIR}/uploads" "${PROJECT_DIR}/print_jobs.db"* 2>/dev/null || true

SERVICE_FILE="/etc/systemd/system/print-station.service"

# Generate unit file with auto-detected paths
sudo tee "${SERVICE_FILE}" > /dev/null <<EOF
[Unit]
Description=Printing Software & Customer Upload Station
After=network.target network-online.target cups.service avahi-daemon.service
Wants=cups.service avahi-daemon.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PNPM_BIN} start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Security sandboxing
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=false
ReadWritePaths=${PROJECT_DIR}

# Resource limits
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

echo "⚙️  Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "🚀 Enabling and starting print-station.service..."
sudo systemctl enable --now print-station.service

echo "======================================================================"
echo "✅ Print Station Service Installed & Started Successfully!"
echo "👉 Check Status: sudo systemctl status print-station.service"
echo "👉 View Logs:    sudo journalctl -u print-station.service -f"
echo "👉 Restart:      sudo systemctl restart print-station.service"
echo "👉 Stop:         sudo systemctl stop print-station.service"
echo "======================================================================"
