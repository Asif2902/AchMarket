#!/usr/bin/env bash
# ============================================================
#  AchMarket – One-command VPS deploy (fullstack)
#  Run:  chmod +x deploy.sh && ./deploy.sh
#  Shares a VPS with AchSwap: this app listens on PORT 8080.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="20"

echo "=============================="
echo "  AchMarket – VPS Deploy"
echo "=============================="

if ! command -v node &>/dev/null; then
  echo "[1/6] Installing Node.js ${NODE_VERSION}.x ..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/6] Node.js $(node -v) already installed ✓"
fi

if ! command -v pm2 &>/dev/null; then
  echo "[2/6] Installing PM2 ..."
  sudo npm install -g pm2
else
  echo "[2/6] PM2 already installed ✓"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "[!] Missing $APP_DIR/.env"
  echo "    Copy .env.example → .env and fill values before deploy."
  exit 1
fi

cd "$APP_DIR"

echo "[3/6] Installing root dependencies ..."
npm install --omit=dev 2>/dev/null || npm install

echo "[4/6] Installing + building backend & frontend ..."
npm --prefix backend ci --include=dev
npm --prefix frontend ci --include=dev
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend prune --omit=dev

if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo "[!] Frontend build missing: frontend/dist/index.html"
  exit 1
fi
if [ ! -f "$APP_DIR/backend/dist/server.js" ]; then
  echo "[!] Backend build missing: backend/dist/server.js"
  exit 1
fi

echo "[5/6] Starting PM2 process achmarket ..."
pm2 delete achmarket 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production
pm2 save

echo "[6/6] Health check ..."
sleep 1
if curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null; then
  echo "  Health OK → http://127.0.0.1:${PORT:-8080}/health"
else
  echo "  Warning: health check failed — run: pm2 logs achmarket"
fi

echo ""
echo "=============================="
echo "  ✓ AchMarket on port ${PORT:-8080}"
echo "  Point nginx / market subdomain to 127.0.0.1:${PORT:-8080}"
echo "  PM2 boot (once):"
echo "    sudo env PATH=\$PATH:$(dirname "$(which node)") pm2 startup systemd -u $(whoami) --hp $HOME"
echo "=============================="
