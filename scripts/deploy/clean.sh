#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
if declare -f project_clean >/dev/null 2>&1; then
  project_clean
else
  not_applicable "project_clean not defined"
fi
