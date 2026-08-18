#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail
ACH_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib/utils.sh
source "$ACH_ROOT/scripts/deploy/lib/utils.sh"
# shellcheck source=config.sh
source "$ACH_ROOT/scripts/deploy/config.sh"

cd "$ACH_ROOT"
DOC_PASS=0; DOC_WARN=0; DOC_FAIL=0

ach_banner
log_step "Doctor — ${APP_TITLE}"

echo "${C_BOLD}System${C_RESET}"
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  doc_pass "OS: ${PRETTY_NAME:-$ID}"
else
  doc_warn "OS: unknown (${OSTYPE:-?})"
fi

if have_cmd git; then doc_pass "git $(git --version | head -1)"; else doc_fail "git missing"; fi
if have_cmd curl; then doc_pass "curl present"; else doc_fail "curl missing"; fi

if have_cmd node; then
  NV="$(node -v | tr -d 'v')"
  MAJOR="${NV%%.*}"
  if [[ "$MAJOR" -ge "$NODE_MAJOR" ]]; then
    doc_pass "Node.js v${NV} (>= ${NODE_MAJOR})"
  else
    doc_warn "Node.js v${NV} (want >= ${NODE_MAJOR})"
  fi
else
  doc_fail "Node.js missing — ./deploy.sh install"
fi

if have_cmd npm; then doc_pass "npm $(npm -v)"; else doc_fail "npm missing"; fi
if have_cmd pm2; then doc_pass "pm2 $(pm2 -v 2>/dev/null || echo present)"; else doc_fail "pm2 missing — ./deploy.sh install"; fi

if [[ "${ENABLE_NGINX:-true}" == "true" ]]; then
  if have_cmd nginx; then doc_pass "nginx present"; else doc_warn "nginx missing (needed for ${DOMAIN})"; fi
else
  doc_pass "nginx N/A"
fi

if [[ "${ENABLE_SSL:-true}" == "true" ]]; then
  if have_cmd certbot; then doc_pass "certbot present"; else doc_warn "certbot missing (needed for SSL)"; fi
else
  doc_pass "certbot N/A"
fi

echo ""
echo "${C_BOLD}Project${C_RESET}"
doc_pass "Root: ${ACH_ROOT}"
if [[ -d .git ]]; then
  BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  doc_pass "Git branch: ${BR} (default deploy: ${DEFAULT_BRANCH})"
else
  doc_warn "Not a git checkout"
fi

if [[ -f "$ECOSYSTEM_FILE" ]]; then doc_pass "PM2 ecosystem: ${ECOSYSTEM_FILE}"; else doc_fail "Missing ${ECOSYSTEM_FILE}"; fi
if [[ -f "$NGINX_CONF_SRC" ]]; then doc_pass "nginx template: ${NGINX_CONF_SRC}"; else doc_warn "Missing ${NGINX_CONF_SRC}"; fi

echo ""
echo "${C_BOLD}Environment${C_RESET}"
if [[ -f "$ENV_FILE" ]]; then
  doc_pass "${ENV_FILE} exists"
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    val="$(env_get "$ACH_ROOT/$ENV_FILE" "$key" "")"
    if [[ -n "$val" ]]; then
      doc_pass "env ${key} is set"
    else
      doc_warn "env ${key} empty or missing"
    fi
  done
  APP_PORT="$(env_get "$ACH_ROOT/$ENV_FILE" "PORT" "$APP_PORT")"
else
  doc_fail "Missing ${ENV_FILE} — ./deploy.sh env"
fi

echo ""
echo "${C_BOLD}Build artifacts${C_RESET}"
for art in "${BUILD_ARTIFACTS[@]}"; do
  if [[ -e "$ACH_ROOT/$art" ]]; then
    doc_pass "${art}"
  else
    doc_fail "Missing ${art} — ./deploy.sh build"
  fi
done

echo ""
echo "${C_BOLD}Runtime${C_RESET}"
if have_cmd pm2; then
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    STATUS="$(pm2 jlist 2>/dev/null | node -e "
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        try {
          const apps=JSON.parse(d);
          const a=apps.find(x=>x.name==='${PM2_NAME}');
          if(!a){console.log('unknown');process.exit(0)}
          console.log(a.pm2_env?.status||'unknown');
        } catch { console.log('unknown'); }
      });
    " 2>/dev/null || echo unknown)"
    if [[ "$STATUS" == "online" ]]; then
      doc_pass "PM2 ${PM2_NAME}: online"
    else
      doc_warn "PM2 ${PM2_NAME}: ${STATUS}"
    fi
  else
    doc_warn "PM2 process ${PM2_NAME} not running — ./deploy.sh deploy"
  fi
fi

LOCAL_URL="$(health_url_local)"
if curl -fsS "$LOCAL_URL" >/dev/null 2>&1; then
  doc_pass "Health ${LOCAL_URL}"
else
  doc_warn "Health not OK: ${LOCAL_URL}"
fi

echo ""
echo "${C_BOLD}Resources${C_RESET}"
if have_cmd df; then
  DISK="$(df -h "$ACH_ROOT" 2>/dev/null | awk 'NR==2 {print $5" used of "$2" on "$6}')"
  doc_pass "Disk: ${DISK:-unknown}"
  PCT="$(df -P "$ACH_ROOT" 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}')"
  if [[ -n "${PCT:-}" && "$PCT" -ge 90 ]]; then
    doc_warn "Disk usage high (${PCT}%)"
  fi
fi
if have_cmd free; then
  MEM="$(free -h 2>/dev/null | awk '/Mem:/ {print $3" used / "$2" total"}')"
  doc_pass "Memory: ${MEM:-unknown}"
fi

if have_cmd curl; then
  if curl -fsS --max-time 5 https://registry.npmjs.org/ >/dev/null 2>&1; then
    doc_pass "Network: npm registry reachable"
  else
    doc_warn "Network: cannot reach npm registry"
  fi
fi

echo ""
echo "${C_BOLD}Isolation${C_RESET}"
if [[ "${ENABLE_NGINX:-true}" == "true" && -f "$NGINX_SITE_AVAILABLE" ]]; then
  if nginx_assert_site_isolated "$NGINX_SITE_AVAILABLE" "$DOMAIN" "$APP_PORT"; then
    doc_pass "nginx ${NGINX_SITE_NAME} → ${DOMAIN} :${APP_PORT}"
  else
    doc_fail "nginx ${NGINX_SITE_NAME} is cross-wired (domain/port leak)"
  fi
  if nginx_has_certs "$DOMAIN"; then
    if grep -qE "listen[[:space:]]+443" "$NGINX_SITE_AVAILABLE"; then
      doc_pass "TLS vhost present for ${DOMAIN}"
    else
      doc_fail "Certs exist for ${DOMAIN} but site has no listen 443 — update would leak HTTPS to a sibling"
    fi
  fi
else
  doc_warn "nginx site ${NGINX_SITE_NAME} not installed"
fi

if have_cmd pm2; then
  actual="$(pm2_app_port "$PM2_NAME" || true)"
  if [[ -n "${actual:-}" ]]; then
    if [[ "$actual" == "$APP_PORT" ]]; then
      doc_pass "PM2 ${PM2_NAME} PORT=${actual}"
    else
      doc_fail "PM2 ${PM2_NAME} PORT=${actual}, expected ${APP_PORT}"
    fi
  fi
  owner="$(pm2_port_owner "$APP_PORT" "$PM2_NAME" || true)"
  if [[ -n "${owner:-}" ]]; then
    doc_fail "Port ${APP_PORT} also used by PM2 ${owner}"
  else
    doc_pass "Port ${APP_PORT} not shared with another PM2 app"
  fi
fi

while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  IFS=: read -r sib_name sib_port sib_domain sib_site <<<"$line"
  sib_file="/etc/nginx/sites-available/${sib_site}"
  if [[ -f "$sib_file" ]]; then
    if grep -qE "server_name[[:space:]]+${sib_domain}[[:space:]]*;" "$sib_file"; then
      doc_pass "Sibling ${sib_site} still owns ${sib_domain}"
    else
      doc_fail "Sibling ${sib_site} missing server_name ${sib_domain}"
    fi
    if grep -qE "server_name[[:space:]]+${DOMAIN}[[:space:]]*;" "$sib_file"; then
      doc_fail "Sibling ${sib_site} also claims ${DOMAIN}"
    fi
  else
    doc_warn "Sibling nginx site ${sib_site} not installed"
  fi
  if have_cmd pm2 && pm2 describe "$sib_name" >/dev/null 2>&1; then
    sib_pm2_port="$(pm2_app_port "$sib_name" || true)"
    if [[ -n "$sib_pm2_port" && "$sib_pm2_port" == "$APP_PORT" ]]; then
      doc_fail "Sibling PM2 ${sib_name} shares PORT ${APP_PORT}"
    elif [[ -n "$sib_pm2_port" ]]; then
      doc_pass "Sibling PM2 ${sib_name} on PORT ${sib_pm2_port}"
    fi
  fi
  if [[ -n "${HEALTH_MARKER:-}" && -n "$sib_domain" ]]; then
    sib_body="$(nginx_host_body "$sib_domain" "$HEALTH_PATH" https)"
    if [[ "$sib_body" == *"$HEALTH_MARKER"* ]]; then
      doc_fail "https://${sib_domain} served this app (${HEALTH_MARKER}) — both links are the same site"
    else
      doc_pass "https://${sib_domain} is not ${APP_TITLE}"
    fi
  fi
done < <(isolation_siblings)

if [[ -f /etc/nginx/sites-enabled/00-isolate-default ]]; then
  doc_pass "Catch-all default_server installed (unknown Host will not hit a sibling)"
else
  doc_warn "No isolate default_server — a missing 443 vhost can steal the other link"
fi

doc_summary || {
  log_err "Doctor found failures. Fix FAIL items, then re-run: ./deploy.sh doctor"
  exit 1
}
log_ok "Environment looks ready (warnings are non-fatal)"
