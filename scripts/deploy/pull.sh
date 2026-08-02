#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
log_step "Git pull (${DEFAULT_BRANCH})"

if [[ ! -d .git ]]; then
  log_warn "Not a git repository — skip pull"
  exit 0
fi

if ! have_cmd git; then
  die "git not installed — run: ./deploy.sh install"
fi

git fetch origin "$DEFAULT_BRANCH" 2>/dev/null || git fetch origin || true

if git show-ref --verify --quiet "refs/remotes/origin/${DEFAULT_BRANCH}"; then
  git checkout "$DEFAULT_BRANCH" 2>/dev/null || true
  if git pull --ff-only origin "$DEFAULT_BRANCH"; then
    log_ok "Updated to origin/${DEFAULT_BRANCH}"
  else
    log_warn "git pull --ff-only failed (local changes?). Building current tree."
  fi
else
  log_warn "origin/${DEFAULT_BRANCH} not found — building current tree"
fi
