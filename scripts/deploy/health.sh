#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
log_step "Health checks"

if [[ -f "$ENV_FILE" ]]; then
  APP_PORT="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
fi

LOCAL_URL="$(health_url_local)"
log_info "Local: ${LOCAL_URL}"

if wait_http_ok "$LOCAL_URL" 20; then
  log_ok "Local health OK"
  curl -fsS "$LOCAL_URL" || true
  echo ""
else
  log_err "Local health FAILED"
  if have_cmd pm2; then
    pm2 describe "$PM2_NAME" 2>/dev/null || true
    pm2 logs "$PM2_NAME" --lines 40 --nostream 2>/dev/null || true
  fi
  if declare -f project_health_diagnose >/dev/null 2>&1; then
    project_health_diagnose
  fi
  die "App not healthy on ${LOCAL_URL}"
fi

if [[ "${ENABLE_NGINX:-true}" == "true" ]] && have_cmd nginx; then
  if curl -fsS -H "Host: ${DOMAIN}" "$(health_url_public_probe)" >/dev/null 2>&1; then
    log_ok "nginx → app (Host: ${DOMAIN})"
  else
    log_warn "nginx Host ${DOMAIN} health failed (DNS/SSL may still be pending)"
  fi
else
  not_applicable "public nginx health probe"
fi
