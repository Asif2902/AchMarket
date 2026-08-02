#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

if [[ "${ENABLE_SSL:-true}" != "true" ]]; then
  not_applicable "ssl (ENABLE_SSL=false)"
  exit 0
fi

log_step "SSL (certbot) → ${DOMAIN}"

if ! have_cmd certbot; then
  log_info "Installing certbot ..."
  run_sudo apt-get update -y
  run_sudo apt-get install -y certbot python3-certbot-nginx
fi

if ! have_cmd nginx; then
  die "nginx required for certbot --nginx — run: ./deploy.sh install && ./deploy.sh nginx"
fi

log_info "Requesting certificate for ${DOMAIN} (DNS must point here) ..."
run_sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect \
  || run_sudo certbot --nginx -d "$DOMAIN" --redirect

log_ok "SSL configured for https://${DOMAIN}"
