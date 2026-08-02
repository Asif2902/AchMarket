#!/usr/bin/env bash
# Backward-compatible entrypoint → modular deploy CLI
#   ./up.sh           → ./deploy.sh update
#   ./up.sh --ssl     → ./deploy.sh update --ssl
#   ./up.sh --no-pull → ./deploy.sh update --no-pull
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/deploy.sh" update "$@"
