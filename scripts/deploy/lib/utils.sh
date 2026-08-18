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

# =============================================================================
# Isolation — keep AchSwap / AchMarket (and any future sibling) from leaking
# into each other's nginx vhost or PM2 PORT. Format of ISOLATION_SIBLINGS:
#   "pm2_name:port:domain:nginx_site"
# =============================================================================

isolation_siblings() {
  if declare -p ISOLATION_SIBLINGS >/dev/null 2>&1; then
    printf '%s\n' "${ISOLATION_SIBLINGS[@]}"
  fi
}

nginx_cert_fullchain() { echo "/etc/letsencrypt/live/${1:?}/fullchain.pem"; }
nginx_cert_privkey()   { echo "/etc/letsencrypt/live/${1:?}/privkey.pem"; }

nginx_has_certs() {
  local domain="${1:?}"
  [[ -f "$(nginx_cert_fullchain "$domain")" && -f "$(nginx_cert_privkey "$domain")" ]]
}

# Checksums of every sites-available file except ours (and the isolate default).
nginx_sibling_snapshot() {
  local own="${1:?}"
  local f base
  shopt -s nullglob
  for f in /etc/nginx/sites-available/*; do
    base="$(basename "$f")"
    case "$base" in
      "$own"|"${own}.bak"|"default"|"00-isolate-default") continue ;;
    esac
    [[ -f "$f" ]] || continue
    sha256sum "$f" 2>/dev/null || true
  done
  shopt -u nullglob
}

# Catch-all default_server so a missing 443 vhost never falls through to a sibling.
nginx_install_isolate_default() {
  local dest="/etc/nginx/sites-available/00-isolate-default"
  local enabled="/etc/nginx/sites-enabled/00-isolate-default"
  local certdir="/etc/nginx/ssl"
  local crt="${certdir}/isolate-default.crt"
  local key="${certdir}/isolate-default.key"
  local tmp

  run_sudo mkdir -p "$certdir" /var/www/html
  if [[ ! -f "$crt" || ! -f "$key" ]]; then
    if ! have_cmd openssl; then
      log_warn "openssl missing — skip isolate default TLS catch-all"
      return 0
    fi
    run_sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "$key" -out "$crt" -subj "/CN=invalid" >/dev/null 2>&1 \
      || { log_warn "could not create isolate-default cert"; return 0; }
  fi

  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# Catch-all — a missing/broken vhost must NEVER serve a sibling app.
# Installed by ./deploy.sh nginx. Do not point a real domain here.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }
    location / { return 444; }
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_certificate ${crt};
    ssl_certificate_key ${key};
    location / { return 444; }
}
EOF
  run_sudo cp "$tmp" "$dest"
  rm -f "$tmp"
  run_sudo ln -sfn "$dest" "$enabled"
}

# Turn the HTTP-only project template into HTTP+HTTPS when certs already exist.
# This is what stops `./deploy.sh update` from clobbering certbot's 443 block
# and making both public links serve whichever sibling still has TLS.
nginx_apply_tls_if_certs() {
  local file="${1:?}"
  local domain="${2:?}"
  local snippet tmp

  nginx_has_certs "$domain" || return 0

  if [[ "${OSTYPE:-}" == darwin* ]]; then
    sed -i '' 's/listen 80;/listen 443 ssl;/' "$file"
    sed -i '' 's/listen \[::\]:80;/listen [::]:443 ssl;/' "$file"
  else
    sed -i 's/listen 80;/listen 443 ssl;/' "$file"
    sed -i 's/listen \[::\]:80;/listen [::]:443 ssl;/' "$file"
  fi

  snippet="    ssl_certificate $(nginx_cert_fullchain "$domain");"$'\n'
  snippet+="    ssl_certificate_key $(nginx_cert_privkey "$domain");"
  if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    snippet+=$'\n    include /etc/letsencrypt/options-ssl-nginx.conf;'
  else
    snippet+=$'\n    ssl_protocols TLSv1.2 TLSv1.3;'
  fi
  if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    snippet+=$'\n    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;'
  fi

  tmp="$(mktemp)"
  awk -v snippet="$snippet" '
    { print }
    $1 == "server_name" && !done { print snippet; done = 1 }
  ' "$file" > "$tmp"
  cat >> "$tmp" <<EOF

server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
  mv "$tmp" "$file"
}

# Fail if THIS site file is cross-wired to a sibling domain/port.
nginx_assert_site_isolated() {
  local site_file="${1:?}"
  local domain="${2:?}"
  local port="${3:?}"
  local line sib_name sib_port sib_domain sib_site

  [[ -f "$site_file" ]] || { log_err "missing nginx site ${site_file}"; return 1; }

  if ! grep -qE "server_name[[:space:]]+${domain}[[:space:]]*;" "$site_file"; then
    log_err "nginx site $(basename "$site_file") missing server_name ${domain}"
    return 1
  fi

  if ! grep -qE "proxy_pass[[:space:]]+http://127\\.0\\.0\\.1:${port}(/|;)" "$site_file"; then
    log_err "nginx site $(basename "$site_file") must proxy to 127.0.0.1:${port}"
    return 1
  fi

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    IFS=: read -r sib_name sib_port sib_domain sib_site <<<"$line"
    if [[ -n "$sib_domain" ]] && grep -qE "server_name[[:space:]]+${sib_domain}[[:space:]]*;" "$site_file"; then
      log_err "ISOLATION: $(basename "$site_file") contains sibling server_name ${sib_domain}"
      return 1
    fi
    if [[ -n "$sib_port" && "$sib_port" != "$port" ]] && grep -qE "proxy_pass[[:space:]]+http://127\\.0\\.0\\.1:${sib_port}(/|;)" "$site_file"; then
      log_err "ISOLATION: $(basename "$site_file") proxies to sibling port ${sib_port}"
      return 1
    fi
  done < <(isolation_siblings)

  return 0
}

nginx_host_body() {
  local host="${1:?}"
  local path="${2:-/health}"
  local scheme="${3:-https}"
  curl -sk --max-time 8 -H "Host: ${host}" "${scheme}://127.0.0.1${path}" 2>/dev/null || true
}

# Strip caller-leaked PORT/NODE_ENV so AchMarket's 8080 cannot bind AchSwap (or vice versa).
isolate_runtime_env() {
  local port="${1:?}"
  unset PORT
  unset NODE_ENV
  export PORT="$port"
  export NODE_ENV=production
}

pm2_app_port() {
  local name="${1:?}"
  have_cmd pm2 || return 1
  have_cmd node || return 1
  pm2 jlist 2>/dev/null | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const apps=JSON.parse(d);
        const a=apps.find(x=>x.name==='${name}');
        if(!a){process.exit(1)}
        const p=a.pm2_env && a.pm2_env.PORT;
        if(p==null || p===''){process.exit(1)}
        process.stdout.write(String(p));
      } catch { process.exit(1); }
    });
  " 2>/dev/null
}

pm2_port_owner() {
  local port="${1:?}"
  local except="${2:-}"
  have_cmd pm2 || return 0
  have_cmd node || return 0
  pm2 jlist 2>/dev/null | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
      try {
        const apps=JSON.parse(d);
        const hit=apps.find(x=>x.name!=='${except}' && String(x.pm2_env&&x.pm2_env.PORT)==='${port}');
        if(hit) process.stdout.write(hit.name);
      } catch {}
    });
  " 2>/dev/null || true
}
