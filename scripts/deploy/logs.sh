#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

if ! have_cmd pm2; then
  die "pm2 not installed — run: ./deploy.sh install"
fi

LINES="${1:-80}"
log_step "Logs: ${PM2_NAME} (last ${LINES} lines, then follow — Ctrl+C to stop)"
pm2 logs "$PM2_NAME" --lines "$LINES"
