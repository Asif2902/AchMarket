#!/usr/bin/env bash
# Issue/renew THIS domain's cert only. Never use `certbot --nginx` installer —
# that rewrites live vhosts and can make both public links serve one app.
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

log_step "SSL (certonly) → ${DOMAIN}"

if ! have_cmd certbot; then
  log_info "Installing certbot ..."
  run_sudo apt-get update -y
  run_sudo apt-get install -y certbot python3-certbot-nginx
fi

if ! have_cmd nginx; then
  die "nginx required — run: ./deploy.sh install && ./deploy.sh nginx"
fi

run_sudo mkdir -p /var/www/html

log_info "Requesting certificate for ${DOMAIN} only (will not rewrite sibling vhosts) ..."

# Prefer webroot (no vhost mutation). Fall back to nginx authenticator
# (`certonly --nginx`), never the installer (`certbot --nginx`) which edits
# every matching server block and is what mixed the two sites together.
if ! run_sudo certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring --cert-name "$DOMAIN"; then
  log_warn "webroot challenge failed — trying nginx authenticator (certonly, not installer)"
  run_sudo certbot certonly --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring --cert-name "$DOMAIN" \
    || run_sudo certbot certonly --nginx -d "$DOMAIN" --keep-until-expiring --cert-name "$DOMAIN"
fi

if ! nginx_has_certs "$DOMAIN"; then
  die "Certificate was not issued for ${DOMAIN}"
fi

# Re-render THIS site with TLS. nginx.sh refuses to touch sibling files.
bash "$ACH_ROOT/scripts/deploy/nginx.sh"

log_ok "SSL configured for https://${DOMAIN} (sibling sites unchanged)"
