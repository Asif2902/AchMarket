#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

if [[ "${ENABLE_NGINX:-true}" != "true" ]]; then
  not_applicable "nginx (ENABLE_NGINX=false)"
  exit 0
fi

log_step "Nginx site → ${DOMAIN}"

if ! have_cmd nginx; then
  die "nginx not installed — run: ./deploy.sh install"
fi

SRC="$ACH_ROOT/$NGINX_CONF_SRC"
if [[ ! -f "$SRC" ]]; then
  die "Missing ${NGINX_CONF_SRC} in project root"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Avoid duplicate limit_req_zone if already defined elsewhere
if grep -Rqs "limit_req_zone .*${NGINX_ZONE_MARKER}" /etc/nginx/ 2>/dev/null \
  && { [[ ! -f "$NGINX_SITE_AVAILABLE" ]] || ! grep -qs "$NGINX_ZONE_MARKER" "$NGINX_SITE_AVAILABLE"; }; then
  log_warn "limit_req_zone already defined — installing site without zone lines"
  grep -v 'limit_req_zone' "$SRC" > "$TMP"
else
  cp "$SRC" "$TMP"
fi

# Force server_name
if [[ "${OSTYPE:-}" == darwin* ]]; then
  sed -i '' "s/server_name .*/server_name ${DOMAIN};/" "$TMP"
else
  sed -i "s/server_name .*/server_name ${DOMAIN};/" "$TMP"
fi

run_sudo cp "$TMP" "$NGINX_SITE_AVAILABLE"
run_sudo ln -sfn "$NGINX_SITE_AVAILABLE" "$NGINX_SITE_ENABLED"
run_sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

if run_sudo nginx -t; then
  run_sudo systemctl reload nginx
  log_ok "nginx reloaded for ${DOMAIN}"
else
  die "nginx -t failed — fix ${NGINX_CONF_SRC} then: ./deploy.sh nginx"
fi
