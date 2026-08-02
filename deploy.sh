#!/usr/bin/env bash
# =============================================================================
# Achswap deploy CLI — root dispatcher (GPL-3.0)
#
#   ./deploy.sh help
#   ./deploy.sh doctor | setup | update | build | deploy | health | ...
#
# Project-specific values live in scripts/deploy/config.sh
# Contract / Hardhat deploy remains:  npm run deploy
# =============================================================================
set -euo pipefail

ACH_ROOT="$(cd "$(dirname "$0")" && pwd)"
export ACH_ROOT

SCRIPTS="$ACH_ROOT/scripts/deploy"
# shellcheck source=scripts/deploy/lib/utils.sh
source "$SCRIPTS/lib/utils.sh"
# shellcheck source=scripts/deploy/config.sh
source "$SCRIPTS/config.sh"

CMD="${1:-update}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$CMD" in
  doctor)  exec bash "$SCRIPTS/doctor.sh" "$@" ;;
  setup)   exec bash "$SCRIPTS/setup.sh" "$@" ;;
  install) exec bash "$SCRIPTS/install.sh" "$@" ;;
  env)     exec bash "$SCRIPTS/env.sh" "$@" ;;
  pull)    exec bash "$SCRIPTS/pull.sh" "$@" ;;
  build)   exec bash "$SCRIPTS/build.sh" "$@" ;;
  deploy)  exec bash "$SCRIPTS/deploy.sh" "$@" ;;
  update)  exec bash "$SCRIPTS/update.sh" "$@" ;;
  health)  exec bash "$SCRIPTS/health.sh" "$@" ;;
  nginx)   exec bash "$SCRIPTS/nginx.sh" "$@" ;;
  ssl)     exec bash "$SCRIPTS/ssl.sh" "$@" ;;
  logs)    exec bash "$SCRIPTS/logs.sh" "$@" ;;
  clean)   exec bash "$SCRIPTS/clean.sh" "$@" ;;
  help|-h|--help) exec bash "$SCRIPTS/help.sh" "$@" ;;
  # Legacy up.sh flags if someone runs: ./deploy.sh --ssl
  --ssl)   exec bash "$SCRIPTS/update.sh" --ssl "$@" ;;
  --no-pull) exec bash "$SCRIPTS/update.sh" --no-pull "$@" ;;
  *)
    log_err "Unknown command: ${CMD}"
    echo "Try: ./deploy.sh help"
    exit 1
    ;;
esac
