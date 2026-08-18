#!/usr/bin/env bash
# Project-specific deploy configuration — AchMarket
# shellcheck shell=bash

# Identity
APP_NAME="achmarket"
APP_TITLE="AchMarket"
DEFAULT_BRANCH="${ACHMARKET_BRANCH:-hoster}"
DOMAIN="${ACHMARKET_DOMAIN:-prediction.achswap.app}"
# Never inherit a sibling's PORT from the calling shell
APP_PORT="${ACHMARKET_PORT:-8080}"
NODE_MAJOR="${NODE_MAJOR:-20}"
# Distinct /health JSON marker used to detect both links serving this app
HEALTH_MARKER="achmarket-backend"
# Other apps on this VPS that we must never overwrite (pm2:port:domain:nginx_site)
ISOLATION_SIBLINGS=(
  "achswap:3000:trade.achswap.app:achswap"
)

# PM2
PM2_NAME="achmarket"
ECOSYSTEM_FILE="ecosystem.config.cjs"
PM2_MAX_MEMORY="400M"

# Paths (relative to ACH_ROOT)
ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
LOG_DIR="logs"
BUILD_ARTIFACTS=(
  "frontend/dist/index.html"
  "backend/dist/server.js"
)

# Health
HEALTH_PATH="/health"
# Local process health (bypasses nginx)
health_url_local() { echo "http://127.0.0.1:${APP_PORT}${HEALTH_PATH}"; }
# Via nginx Host header
health_url_public_probe() { echo "http://127.0.0.1${HEALTH_PATH}"; }

# Features
ENABLE_NGINX=true
ENABLE_SSL=true
NGINX_SITE_NAME="achmarket"
NGINX_CONF_SRC="nginx.conf"
NGINX_SITE_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
NGINX_SITE_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
# Unique limit_req zone markers in nginx.conf (for duplicate detection)
NGINX_ZONE_MARKER="zone=achmarket_api"

# Required env keys for production readiness (doctor)
REQUIRED_ENV_KEYS=(
  PORT
  NODE_ENV
  RPC_URL
  MONGO_URI
  FACTORY_ADDRESS
)

# Optional keys that get defaults filled by env.sh
ENV_DEFAULTS_PORT="8080"
ENV_DEFAULTS_NODE_ENV="production"

# Project build steps (run from ACH_ROOT)
project_build() {
  log_step "Install + build (backend + frontend)"
  npm install --omit=dev 2>/dev/null || npm install
  npm --prefix backend ci --include=dev
  npm --prefix frontend ci --include=dev
  npm --prefix backend run build
  npm --prefix frontend run build
  npm --prefix backend prune --omit=dev
}

project_clean() {
  log_step "Clean build artifacts"
  rm -rf frontend/dist backend/dist frontend/node_modules/.vite 2>/dev/null || true
  log_ok "Removed frontend/dist, backend/dist (and vite cache if present)"
}

# After env file exists, fill empty production defaults
project_env_defaults() {
  env_ensure "$ACH_ROOT/$ENV_FILE" "PORT" "$ENV_DEFAULTS_PORT"
  env_ensure "$ACH_ROOT/$ENV_FILE" "NODE_ENV" "$ENV_DEFAULTS_NODE_ENV"
  env_ensure "$ACH_ROOT/$ENV_FILE" "CORS_ALLOWED_ORIGINS" "https://${DOMAIN}"
  env_ensure "$ACH_ROOT/$ENV_FILE" "VITE_API_BASE_URL" ""
  # Refresh APP_PORT from .env
  local p
  p="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
  APP_PORT="$p"
}

# Optional diagnostic when health fails
project_health_diagnose() {
  if [[ -f "$ACH_ROOT/$LOG_DIR/${PM2_NAME}-error.log" ]]; then
    echo "----- ${LOG_DIR}/${PM2_NAME}-error.log -----"
    tail -n 40 "$ACH_ROOT/$LOG_DIR/${PM2_NAME}-error.log" || true
  fi
  if [[ -f "$ACH_ROOT/$LOG_DIR/${PM2_NAME}-out.log" ]]; then
    echo "----- ${LOG_DIR}/${PM2_NAME}-out.log -----"
    tail -n 40 "$ACH_ROOT/$LOG_DIR/${PM2_NAME}-out.log" || true
  fi
  log_info "Direct node start (8s) for clearer errors..."
  ( cd "$ACH_ROOT" && timeout 8 node backend/dist/server.js ) 2>&1 || true
}
