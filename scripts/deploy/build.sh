#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  log_warn "No ${ENV_FILE} — run ./deploy.sh env first (build may still work)"
fi

if ! declare -f project_build >/dev/null 2>&1; then
  die "project_build() not defined in config.sh"
fi

project_build

for art in "${BUILD_ARTIFACTS[@]}"; do
  if [[ ! -e "$ACH_ROOT/$art" ]]; then
    die "Missing build artifact: ${art}"
  fi
  log_ok "Artifact: ${art}"
done

log_ok "Build complete"
