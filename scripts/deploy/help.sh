#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cat <<EOF
${C_BOLD}${APP_TITLE} deploy CLI${C_RESET}

Usage:
  ./deploy.sh <command> [options]

Commands:
  doctor    System & project diagnostics (pass/warn/fail report)
  setup     Install tools + prepare .env (first-time)
  install   Install system dependencies (Node, PM2, nginx, certbot)
  env       Create/fill .env defaults (never overwrites secrets)
  pull      Git fetch + pull ${DEFAULT_BRANCH}
  build     Install npm deps + build production artifacts
  deploy    Start/restart app with PM2
  update    Full pipeline: pull → build → deploy → nginx → health
            Options: --no-pull   skip git pull
                     --ssl       also run certbot after nginx
  health    Check local (and optional public) health endpoints
  nginx     Install/refresh nginx site for ${DOMAIN} only (keeps sibling TLS)
  ssl       Issue/renew Let's Encrypt cert for ${DOMAIN} (does not rewrite other vhosts)
  logs      Tail PM2 logs (${PM2_NAME})
  clean     Remove build caches/artifacts
  help      Show this help

Examples:
  ./deploy.sh doctor
  ./deploy.sh setup
  ./deploy.sh update
  ./deploy.sh update --ssl
  ./deploy.sh update --no-pull
  ./deploy.sh logs
  ./deploy.sh health

Config:  scripts/deploy/config.sh
Domain:  ${DOMAIN}
Port:    ${APP_PORT}
PM2:     ${PM2_NAME}
Branch:  ${DEFAULT_BRANCH}

Backward compatibility:
  ./up.sh                 →  ./deploy.sh update
  ./up.sh --ssl           →  ./deploy.sh update --ssl
  ./up.sh --no-pull       →  ./deploy.sh update --no-pull
EOF
