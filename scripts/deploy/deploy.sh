#!/usr/bin/env bash
# PM2 start/restart — not the root CLI (that is ./deploy.sh at repo root).
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
log_step "PM2 deploy (${PM2_NAME})"

if ! have_cmd pm2; then
  die "pm2 not installed — run: ./deploy.sh install"
fi

if [[ ! -f "$ECOSYSTEM_FILE" ]]; then
  die "Missing ${ECOSYSTEM_FILE}"
fi

for art in "${BUILD_ARTIFACTS[@]}"; do
  if [[ ! -e "$ACH_ROOT/$art" ]]; then
    die "Missing ${art} — run: ./deploy.sh build"
  fi
done

mkdir -p "$ACH_ROOT/$LOG_DIR"

# Prefer env PORT from .env
if [[ -f "$ENV_FILE" ]]; then
  APP_PORT="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
fi

log_info "Restarting PM2 process ${PM2_NAME} (port ${APP_PORT}) ..."
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$ECOSYSTEM_FILE" --env production --update-env
pm2 save

log_ok "PM2 process ${PM2_NAME} started"
log_info "Boot on reboot (once): pm2 startup  # then run the printed command"
