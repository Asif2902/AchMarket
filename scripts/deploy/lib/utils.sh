#!/usr/bin/env bash
# Shared helpers for Achswap deploy CLI (GPL-3.0).
# shellcheck shell=bash

if [[ -n "${ACH_UTILS_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
ACH_UTILS_LOADED=1

# --- colors (disable with NO_COLOR=1) ---
if [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 || -n "${FORCE_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

log_info()  { echo "${C_BLUE}ℹ${C_RESET}  $*"; }
log_ok()    { echo "${C_GREEN}✓${C_RESET}  $*"; }
log_warn()  { echo "${C_YELLOW}!${C_RESET}  $*"; }
log_err()   { echo "${C_RED}✗${C_RESET}  $*" >&2; }
log_step()  { echo ""; echo "${C_BOLD}${C_CYAN}▶${C_RESET} ${C_BOLD}$*${C_RESET}"; }
die()       { log_err "$*"; exit 1; }

require_root_or_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    return 0
  fi
  die "This step needs root or sudo."
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Ensure key=value exists in .env; only fill empty keys (never overwrite secrets).
env_ensure() {
  local file="${1:?}"
  local key="${2:?}"
  local val="${3:-}"
  [[ -f "$file" ]] || return 1
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    if grep -qE "^${key}=$" "$file" || grep -qE "^${key}=[[:space:]]*$" "$file"; then
      if [[ "${OSTYPE:-}" == darwin* ]]; then
        sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
      else
        sed -i "s|^${key}=.*|${key}=${val}|" "$file"
      fi
      log_info "Set empty ${key} in $(basename "$file")"
    fi
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$file"
    log_info "Appended ${key} to $(basename "$file")"
  fi
}

env_get() {
  local file="${1:?}"
  local key="${2:?}"
  local def="${3:-}"
  if [[ -f "$file" ]] && grep -qE "^${key}=" "$file" 2>/dev/null; then
    local v
    v="$(grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
    if [[ -n "$v" ]]; then
      echo "$v"
      return 0
    fi
  fi
  echo "$def"
}

wait_http_ok() {
  local url="${1:?}"
  local attempts="${2:-20}"
  local i
  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Doctor status helpers
DOC_PASS=0
DOC_WARN=0
DOC_FAIL=0

doc_pass() { DOC_PASS=$((DOC_PASS + 1)); echo "  ${C_GREEN}PASS${C_RESET}  $*"; }
doc_warn() { DOC_WARN=$((DOC_WARN + 1)); echo "  ${C_YELLOW}WARN${C_RESET}  $*"; }
doc_fail() { DOC_FAIL=$((DOC_FAIL + 1)); echo "  ${C_RED}FAIL${C_RESET}  $*"; }

doc_summary() {
  echo ""
  echo "${C_BOLD}Doctor summary${C_RESET}: ${C_GREEN}${DOC_PASS} pass${C_RESET}, ${C_YELLOW}${DOC_WARN} warn${C_RESET}, ${C_RED}${DOC_FAIL} fail${C_RESET}"
  if [[ "$DOC_FAIL" -gt 0 ]]; then
    return 1
  fi
  return 0
}

not_applicable() {
  log_warn "Not applicable for this project: $*"
  return 0
}

ach_banner() {
  echo "${C_BOLD}==============================================${C_RESET}"
  echo "${C_BOLD}  ${APP_TITLE:-Achswap} · deploy CLI${C_RESET}"
  echo "  app:    ${APP_NAME:-?}  domain: ${DOMAIN:-?}"
  echo "  root:   ${ACH_ROOT:-?}"
  echo "${C_BOLD}==============================================${C_RESET}"
}
