#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

log_step "Install system dependencies (Node ${NODE_MAJOR}, PM2, nginx)"

if ! have_cmd node; then
  log_info "Installing Node.js ${NODE_MAJOR}.x ..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_sudo -E bash -
  run_sudo apt-get install -y nodejs
else
  log_ok "Node.js $(node -v) already installed"
fi

if ! have_cmd npm; then
  die "npm missing after Node install"
else
  log_ok "npm $(npm -v)"
fi

if ! have_cmd pm2; then
  log_info "Installing PM2 globally ..."
  run_sudo npm install -g pm2
else
  log_ok "PM2 already installed"
fi

if [[ "${ENABLE_NGINX:-true}" == "true" ]]; then
  if ! have_cmd nginx; then
    log_info "Installing nginx ..."
    run_sudo apt-get update -y
    run_sudo apt-get install -y nginx
  else
    log_ok "nginx already installed"
  fi
else
  not_applicable "nginx (ENABLE_NGINX=false)"
fi

if [[ "${ENABLE_SSL:-true}" == "true" ]]; then
  if ! have_cmd certbot; then
    log_info "Installing certbot ..."
    run_sudo apt-get update -y
    run_sudo apt-get install -y certbot python3-certbot-nginx
  else
    log_ok "certbot already installed"
  fi
else
  not_applicable "certbot (ENABLE_SSL=false)"
fi

if ! have_cmd git; then
  log_info "Installing git ..."
  run_sudo apt-get install -y git
else
  log_ok "git already installed"
fi

if ! have_cmd curl; then
  run_sudo apt-get install -y curl
else
  log_ok "curl already installed"
fi

log_ok "Install complete"
