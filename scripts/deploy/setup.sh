#!/usr/bin/env bash
# First-time setup: install tools + env
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

ach_banner
log_step "Setup ${APP_TITLE}"

bash "$ACH_ROOT/scripts/deploy/install.sh"
bash "$ACH_ROOT/scripts/deploy/env.sh"

log_ok "Setup complete"
log_info "Next:"
log_info "  1) Edit ${ACH_ROOT}/${ENV_FILE} with secrets"
log_info "  2) ./deploy.sh update"
log_info "  3) ./deploy.sh ssl   # after DNS for ${DOMAIN}"
log_info "  4) ./deploy.sh doctor"
