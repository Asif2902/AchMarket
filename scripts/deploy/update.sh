#!/usr/bin/env bash
# Full pipeline: pull → build → deploy → nginx → health [→ ssl]
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

DO_PULL=1
DO_SSL=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --ssl) DO_SSL=1 ;;
    -h|--help)
      echo "Usage: ./deploy.sh update [--no-pull] [--ssl]"
      exit 0
      ;;
  esac
done

ach_banner
log_step "Update pipeline for ${APP_TITLE} → ${DOMAIN}"

# Ensure tools exist (idempotent)
if ! have_cmd node || ! have_cmd pm2; then
  bash "$ACH_ROOT/scripts/deploy/install.sh"
fi

bash "$ACH_ROOT/scripts/deploy/env.sh"

if [[ "$DO_PULL" -eq 1 ]]; then
  bash "$ACH_ROOT/scripts/deploy/pull.sh"
else
  log_info "Skipping git pull (--no-pull)"
fi

bash "$ACH_ROOT/scripts/deploy/build.sh"
bash "$ACH_ROOT/scripts/deploy/deploy.sh"

if [[ "${ENABLE_NGINX:-true}" == "true" ]]; then
  bash "$ACH_ROOT/scripts/deploy/nginx.sh" || log_warn "nginx step had issues"
else
  not_applicable "nginx"
fi

bash "$ACH_ROOT/scripts/deploy/health.sh"

if [[ "$DO_SSL" -eq 1 ]]; then
  bash "$ACH_ROOT/scripts/deploy/ssl.sh"
fi

echo ""
echo "${C_BOLD}==============================================${C_RESET}"
echo "  ${C_GREEN}✓${C_RESET} ${APP_TITLE} is running"
echo "  Public:  https://${DOMAIN}"
echo "  Local:   $(health_url_local)"
echo "  Logs:    ./deploy.sh logs"
echo "  Doctor:  ./deploy.sh doctor"
if [[ "$DO_SSL" -ne 1 ]]; then
  echo "  SSL:     ./deploy.sh ssl   # once DNS points here"
fi
echo "${C_BOLD}==============================================${C_RESET}"
