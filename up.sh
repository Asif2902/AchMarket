#!/usr/bin/env bash
# ============================================================
#  AchMarket – one command for first install + every update
#
#    chmod +x up.sh && ./up.sh
#
#  Domain:  prediction.achswap.app  →  127.0.0.1:8080
#  Flags:
#    ./up.sh           pull + build + pm2 + nginx
#    ./up.sh --ssl     also issue/renew certbot for the domain
#    ./up.sh --no-pull skip git pull
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="${ACHMARKET_DOMAIN:-prediction.achswap.app}"
APP_PORT="${PORT:-8080}"
BRANCH="${ACHMARKET_BRANCH:-hoster}"
SITE_AVAILABLE="/etc/nginx/sites-available/achmarket"
SITE_ENABLED="/etc/nginx/sites-enabled/achmarket"
DO_PULL=1
DO_SSL=0

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --ssl) DO_SSL=1 ;;
    -h|--help)
      echo "Usage: ./up.sh [--ssl] [--no-pull]"
      echo "  Host: https://${DOMAIN}  (port ${APP_PORT})"
      exit 0
      ;;
  esac
done

log() { echo "[up] $*"; }
die() { echo "[up] ERROR: $*" >&2; exit 1; }

echo "=============================================="
echo "  AchMarket → ${DOMAIN}"
echo "  dir: ${APP_DIR}"
echo "=============================================="

# --- tools ---
if ! command -v node &>/dev/null; then
  log "Installing Node.js 20.x ..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
log "Node $(node -v)"

if ! command -v pm2 &>/dev/null; then
  log "Installing PM2 ..."
  sudo npm install -g pm2
fi

if ! command -v nginx &>/dev/null; then
  log "Installing nginx ..."
  sudo apt-get update -y
  sudo apt-get install -y nginx
fi

# --- env ---
cd "$APP_DIR"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    log "Created .env from .env.example — edit secrets then re-run ./up.sh"
    log "  nano ${APP_DIR}/.env"
    exit 1
  fi
  die "Missing .env (and no .env.example)"
fi

# Keep production domain defaults in .env without wiping user secrets.
ensure_env() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    # Only fill if empty
    if grep -qE "^${key}=$" .env || grep -qE "^${key}=\s*$" .env; then
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^${key}=.*|${key}=${val}|" .env
      else
        sed -i "s|^${key}=.*|${key}=${val}|" .env
      fi
      log "Set empty ${key}"
    fi
  else
    printf '\n%s=%s\n' "$key" "$val" >> .env
    log "Appended ${key}"
  fi
}

ensure_env "PORT" "8080"
ensure_env "NODE_ENV" "production"
ensure_env "CORS_ALLOWED_ORIGINS" "https://${DOMAIN}"
ensure_env "VITE_API_BASE_URL" ""

# Prefer PORT from .env if present
if grep -qE '^PORT=[0-9]+' .env 2>/dev/null; then
  APP_PORT="$(grep -E '^PORT=' .env | head -1 | cut -d= -f2 | tr -d '\r' | tr -d ' ')"
fi
APP_PORT="${APP_PORT:-8080}"

# --- git pull ---
if [ "$DO_PULL" -eq 1 ] && [ -d .git ]; then
  log "git fetch + pull ${BRANCH} ..."
  git fetch origin "$BRANCH" 2>/dev/null || git fetch origin || true
  if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH}"; then
    git checkout "$BRANCH" 2>/dev/null || true
    git pull --ff-only origin "$BRANCH" || log "git pull skipped (local changes or no ff)"
  else
    log "Branch origin/${BRANCH} not found — building current tree"
  fi
else
  log "Skipping git pull"
fi

# --- build ---
log "Installing + building backend & frontend ..."
npm install --omit=dev 2>/dev/null || npm install
npm --prefix backend ci --include=dev
npm --prefix frontend ci --include=dev
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend prune --omit=dev

[ -f frontend/dist/index.html ] || die "frontend/dist/index.html missing after build"
[ -f backend/dist/server.js ] || die "backend/dist/server.js missing after build"

# --- pm2 ---
mkdir -p "$APP_DIR/logs"
log "PM2 (re)start achmarket on port ${APP_PORT} ..."
# Clean restart avoids stale interpreter args / random-port crash loops
pm2 delete achmarket 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production --update-env
pm2 save

# --- wait for health (empty PORT= used to bind random port; we now force 8080) ---
log "Waiting for http://127.0.0.1:${APP_PORT}/health ..."
HEALTH_OK=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    log "Health OK (attempt ${i})"
    break
  fi
  # Still booting or crash-looping
  sleep 1
done

if [ "$HEALTH_OK" -ne 1 ]; then
  log "Health FAILED — last PM2 / log output:"
  pm2 describe achmarket || true
  pm2 logs achmarket --lines 60 --nostream || true
  if [ -f "$APP_DIR/logs/achmarket-error.log" ]; then
    echo "----- logs/achmarket-error.log -----"
    tail -n 40 "$APP_DIR/logs/achmarket-error.log" || true
  fi
  if [ -f "$APP_DIR/logs/achmarket-out.log" ]; then
    echo "----- logs/achmarket-out.log -----"
    tail -n 40 "$APP_DIR/logs/achmarket-out.log" || true
  fi
  # Direct node run for clearer crash message (does not leave process running)
  log "Trying direct node start (10s) for diagnostics..."
  ( cd "$APP_DIR" && timeout 8 node backend/dist/server.js ) || true
  die "achmarket not listening on ${APP_PORT}. Fix errors above, then: ./up.sh --no-pull"
fi

# --- nginx site ---
if [ -f "$APP_DIR/nginx.conf" ]; then
  log "Installing nginx site → ${DOMAIN}"
  # If zone names already exist elsewhere, strip zone definitions to avoid duplicate errors.
  if grep -Rqs "zone=achmarket_api" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null \
    && ! grep -qs "zone=achmarket_api" "$SITE_AVAILABLE" 2>/dev/null; then
    :
  fi

  TMP_NGINX="$(mktemp)"
  if grep -Rqs "limit_req_zone .*zone=achmarket_api" /etc/nginx/ 2>/dev/null \
    && [ -f "$SITE_AVAILABLE" ] && grep -qs "zone=achmarket_api" "$SITE_AVAILABLE"; then
    # Replacing our own file — keep zones once in this file only.
    cp "$APP_DIR/nginx.conf" "$TMP_NGINX"
  elif grep -Rqs "limit_req_zone .*zone=achmarket_api" /etc/nginx/ 2>/dev/null; then
    log "limit_req_zone already defined — installing site without zone lines"
    grep -v 'limit_req_zone' "$APP_DIR/nginx.conf" > "$TMP_NGINX"
  else
    cp "$APP_DIR/nginx.conf" "$TMP_NGINX"
  fi

  # Force server_name in case file was customized wrong
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/server_name .*/server_name ${DOMAIN};/" "$TMP_NGINX"
  else
    sed -i "s/server_name .*/server_name ${DOMAIN};/" "$TMP_NGINX"
  fi

  sudo cp "$TMP_NGINX" "$SITE_AVAILABLE"
  rm -f "$TMP_NGINX"
  sudo ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
  # Remove default site if it steals hostnames
  sudo rm -f /etc/nginx/sites-enabled/default

  if sudo nginx -t; then
    sudo systemctl reload nginx
    log "nginx reloaded"
  else
    die "nginx -t failed — fix config then re-run ./up.sh"
  fi
else
  log "No nginx.conf in repo — skipped nginx"
fi

# --- optional SSL ---
if [ "$DO_SSL" -eq 1 ]; then
  if ! command -v certbot &>/dev/null; then
    log "Installing certbot ..."
    sudo apt-get update -y
    sudo apt-get install -y certbot python3-certbot-nginx
  fi
  log "Certbot for ${DOMAIN} ..."
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect || \
    sudo certbot --nginx -d "$DOMAIN" --redirect
fi

if curl -fsS -H "Host: ${DOMAIN}" "http://127.0.0.1/health" >/dev/null 2>&1; then
  log "OK  nginx → app (Host: ${DOMAIN})"
else
  log "WARN nginx Host ${DOMAIN} health failed (DNS/SSL may still be pending)"
fi

echo ""
echo "=============================================="
echo "  ✓ AchMarket is running"
echo "  Public:  https://${DOMAIN}"
echo "  Local:   http://127.0.0.1:${APP_PORT}/health"
echo "  Logs:    pm2 logs achmarket"
echo "           tail -f ${APP_DIR}/logs/achmarket-error.log"
echo ""
echo "  SSL (once DNS points here):"
echo "    ./up.sh --ssl"
echo "=============================================="
