#!/usr/bin/env bash
# Thin wrapper — use ./up.sh for install and updates.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/up.sh" "$@"
