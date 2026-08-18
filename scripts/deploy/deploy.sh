#!/usr/bin/env bash
# PM2 start/restart — not the root CLI (that is ./deploy.sh at repo root).
# Isolates PORT/NODE_ENV so a leftover shell PORT cannot bind this app to
# the sibling's port (both public links would then hit one process).
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

# Source of truth is THIS project's .env — never the caller's PORT
if [[ -f "$ENV_FILE" ]]; then
  APP_PORT="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
fi

owner="$(pm2_port_owner "$APP_PORT" "$PM2_NAME" || true)"
if [[ -n "${owner:-}" ]]; then
  die "Port ${APP_PORT} already used by PM2 process ${owner} — isolation conflict"
fi

isolate_runtime_env "$APP_PORT"

log_info "Restarting PM2 process ${PM2_NAME} only (port ${APP_PORT}) ..."
pm2 delete "$PM2_NAME" 2>/dev/null || true
# --only keeps other ecosystem apps (and the sibling process) untouched.
# Do not pass --update-env: it copies leaked shell vars into the process.
pm2 start "$ECOSYSTEM_FILE" --only "$PM2_NAME" --env production
pm2 save

actual="$(pm2_app_port "$PM2_NAME" || true)"
if [[ -z "${actual:-}" ]]; then
  die "PM2 process ${PM2_NAME} did not report a PORT"
fi
if [[ "$actual" != "$APP_PORT" ]]; then
  die "ISOLATION: PM2 ${PM2_NAME} bound to PORT=${actual}, expected ${APP_PORT}"
fi

log_ok "PM2 process ${PM2_NAME} started on ${APP_PORT}"
log_info "Boot on reboot (once): pm2 startup  # then run the printed command"
