#!/usr/bin/env bash
# Install THIS project's nginx site only.
# Never rewrite sibling vhosts. If Let's Encrypt certs already exist, emit
# HTTPS here so `./deploy.sh update` cannot strip TLS and make both public
# links fall through to the other app.
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

log_step "Nginx site → ${DOMAIN} (isolated, siblings untouched)"

if ! have_cmd nginx; then
  die "nginx not installed — run: ./deploy.sh install"
fi

SRC="$ACH_ROOT/$NGINX_CONF_SRC"
if [[ ! -f "$SRC" ]]; then
  die "Missing ${NGINX_CONF_SRC} in project root"
fi

if [[ -f "$ENV_FILE" ]]; then
  APP_PORT="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
fi

BEFORE="$(nginx_sibling_snapshot "$NGINX_SITE_NAME")"

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

# Force THIS domain only (do not rewrite other files)
if [[ "${OSTYPE:-}" == darwin* ]]; then
  sed -i '' "s/server_name .*/server_name ${DOMAIN};/" "$TMP"
else
  sed -i "s/server_name .*/server_name ${DOMAIN};/" "$TMP"
fi

# Keep TLS if certs already exist — do not wait for certbot --nginx
if nginx_has_certs "$DOMAIN"; then
  nginx_apply_tls_if_certs "$TMP" "$DOMAIN"
  log_info "TLS certs found for ${DOMAIN} — HTTPS kept on this site"
else
  log_info "No certs yet for ${DOMAIN} — HTTP only (run ./deploy.sh ssl after DNS)"
fi

if ! nginx_assert_site_isolated "$TMP" "$DOMAIN" "$APP_PORT"; then
  die "Rendered nginx config is not isolated — aborting before install"
fi

if [[ -f "$NGINX_SITE_AVAILABLE" ]]; then
  run_sudo cp "$NGINX_SITE_AVAILABLE" "${NGINX_SITE_AVAILABLE}.bak"
fi

run_sudo mkdir -p /var/www/html
run_sudo cp "$TMP" "$NGINX_SITE_AVAILABLE"
run_sudo ln -sfn "$NGINX_SITE_AVAILABLE" "$NGINX_SITE_ENABLED"
run_sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx_install_isolate_default

AFTER="$(nginx_sibling_snapshot "$NGINX_SITE_NAME")"
if [[ "$BEFORE" != "$AFTER" ]]; then
  log_err "ISOLATION: a sibling nginx site changed while installing ${NGINX_SITE_NAME}"
  if [[ -f "${NGINX_SITE_AVAILABLE}.bak" ]]; then
    run_sudo cp "${NGINX_SITE_AVAILABLE}.bak" "$NGINX_SITE_AVAILABLE"
  fi
  die "Sibling vhost was modified — restored this site from backup. Re-run both deploys only if you intend to."
fi

if ! nginx_assert_site_isolated "$NGINX_SITE_AVAILABLE" "$DOMAIN" "$APP_PORT"; then
  die "Installed nginx site failed isolation checks"
fi

# Sibling files must still name their own domain (if they exist)
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  IFS=: read -r _sib_name _sib_port sib_domain sib_site <<<"$line"
  sib_file="/etc/nginx/sites-available/${sib_site}"
  if [[ -n "$sib_site" && -f "$sib_file" ]]; then
    if ! grep -qE "server_name[[:space:]]+${sib_domain}[[:space:]]*;" "$sib_file"; then
      die "ISOLATION: sibling site ${sib_site} lost server_name ${sib_domain}"
    fi
    if grep -qE "server_name[[:space:]]+${DOMAIN}[[:space:]]*;" "$sib_file"; then
      die "ISOLATION: sibling site ${sib_site} now also claims ${DOMAIN}"
    fi
    log_ok "Sibling vhost ${sib_site} still isolated (${sib_domain})"
  fi
done < <(isolation_siblings)

if run_sudo nginx -t; then
  run_sudo systemctl reload nginx
  log_ok "nginx reloaded for ${DOMAIN} only"
else
  if [[ -f "${NGINX_SITE_AVAILABLE}.bak" ]]; then
    run_sudo cp "${NGINX_SITE_AVAILABLE}.bak" "$NGINX_SITE_AVAILABLE"
    run_sudo nginx -t && run_sudo systemctl reload nginx || true
    die "nginx -t failed — restored previous ${NGINX_SITE_NAME} config"
  fi
  die "nginx -t failed — fix ${NGINX_CONF_SRC} then: ./deploy.sh nginx"
fi
