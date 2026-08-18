#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
log_step "Environment file"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    log_ok "Created ${ENV_FILE} from ${ENV_EXAMPLE}"
    log_warn "Edit secrets, then re-run: ./deploy.sh update"
    log_info "  nano ${ACH_ROOT}/${ENV_FILE}"
  else
    die "Missing ${ENV_FILE} and ${ENV_EXAMPLE}"
  fi
else
  log_ok "${ENV_FILE} exists"
fi

if declare -f project_env_defaults >/dev/null 2>&1; then
  project_env_defaults
fi

log_ok "Env defaults applied (empty keys only; secrets preserved)"
