#!/bin/bash
#
# Server Control dashboard — deploy FastAPI + PM2 + nginx + Let's Encrypt
# (indra.thatinsaneguy.com)
#
# Usage (from this directory):
#   ./deploy.sh                    # app + pm2 (no nginx unless root)
#   sudo ./deploy.sh               # full: venv, pm2, nginx, certbot
#
# Optional env:
#   DASHBOARD_PORT=9282           # must match nginx upstream in nginx-serverdashboard.conf
#   DOMAIN=indra.thatinsaneguy.com
#   CERTBOT_EMAIL=you@example.com   # required for first non-interactive cert (Let's Encrypt)
#   SKIP_SSL=1                    # only HTTP nginx + app (no certbot)
#   SKIP_NGINX=1                  # only app (venv + pm2)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../dktp/deployLib.sh
source "${SCRIPT_DIR}/../dktp/deployLib.sh"
APP_ROOT="${SCRIPT_DIR}"
ECOSYSTEM="${APP_ROOT}/ecosystem.config.cjs"
NGINX_TEMPLATE="${APP_ROOT}/nginx-serverdashboard.conf"

DOMAIN="${DOMAIN:-indra.thatinsaneguy.com}"
PORT="${DASHBOARD_PORT:-9282}"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

step()   { echo -e "${BLUE}[dashboard]${NC} $*"; }
info()   { echo -e "${GREEN}[dashboard]${NC} $*"; }
warn()   { echo -e "${YELLOW}[dashboard]${NC} $*" >&2; }
err()    { echo -e "${RED}[dashboard]${NC} $*" >&2; }
banner() {
  echo ""
  echo -e "${CYAN}================================================================================${NC}"
  echo -e "${CYAN} $*${NC}"
  echo -e "${CYAN}================================================================================${NC}"
  echo ""
}

START_TS=$(date +%s)
banner "Server Control dashboard deploy (${DOMAIN})"

# --- Optional git pull -------------------------------------------------------------
if [ -d "${APP_ROOT}/.git" ] && command -v git &>/dev/null; then
    step "Git pull (optional)…"
    (cd "${APP_ROOT}" && git pull --ff-only 2>/dev/null) && info "git pull OK" || warn "git pull skipped or failed"
fi

# --- App venv + deps --------------------------------------------------------------
banner "Python venv & dependencies"
cd "${APP_ROOT}"

if [ ! -f "requirements.txt" ]; then
    err "requirements.txt missing in ${APP_ROOT}"
    exit 1
fi

if [ ! -d "venv" ]; then
    step "Creating venv…"
    python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt

# --- PM2 ---------------------------------------------------------------------------
banner "PM2 (uvicorn)"
if ! command -v pm2 &>/dev/null; then
    err "PM2 is not installed. Install: npm install -g pm2"
    exit 1
fi

if [ ! -f "${ECOSYSTEM}" ]; then
    err "Missing ${ECOSYSTEM}"
    exit 1
fi

step "Stopping existing server-dashboard process…"
pm2 delete server-dashboard >/dev/null 2>&1 || true

step "Freeing port ${PORT}…"
for pid in $(lsof -t -i ":${PORT}" 2>/dev/null || true); do
    kill "${pid}" 2>/dev/null || true
done
sleep 1
for pid in $(lsof -t -i ":${PORT}" 2>/dev/null || true); do
    kill -9 "${pid}" 2>/dev/null || true
done

DASHBOARD_PORT="${PORT}" pm2 start "${ECOSYSTEM}"
pm2 save >/dev/null 2>&1 || true

step "Waiting for app…"
sleep 2
# / returns 200 (open) or 401 (auth enabled) — both mean the app is up.
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || echo 000)"
if [ "${HTTP_CODE}" = "200" ] || [ "${HTTP_CODE}" = "401" ]; then
    info "Health check OK (HTTP ${HTTP_CODE}): http://127.0.0.1:${PORT}/"
else
    warn "Health check failed (HTTP ${HTTP_CODE}) — check: cd ${APP_ROOT} && pm2 logs server-dashboard"
fi

if [ "${SKIP_NGINX:-0}" = "1" ]; then
    ELAPSED=$(( $(date +%s) - START_TS ))
    banner "Deploy summary (${ELAPSED}s)"
    info "Done (SKIP_NGINX=1)"
    info "Local: http://127.0.0.1:${PORT}/"
    exit 0
fi

# --- Nginx directory detection -----------------------------------------------------
nginx_install_conf() {
    local src="$1"
    local name="$2"
    if [ -d /etc/nginx/sites-available ]; then
        cp "${src}" "/etc/nginx/sites-available/${name}"
        chmod 644 "/etc/nginx/sites-available/${name}"
        mkdir -p /etc/nginx/sites-enabled
        ln -sf "/etc/nginx/sites-available/${name}" "/etc/nginx/sites-enabled/${name}"
        rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
        info "Installed site (Debian/Ubuntu style): sites-available/${name}"
        return 0
    fi
    if [ -d /etc/nginx/conf.d ]; then
        cp "${src}" "/etc/nginx/conf.d/${name}.conf"
        info "Installed site (conf.d): conf.d/${name}.conf"
        return 0
    fi
    return 1
}

substitute_port_in_conf() {
    # Ensure upstream port matches DASHBOARD_PORT (default 9282 in template)
    local tmp
    tmp="$(mktemp)"
    sed "s/127.0.0.1:9282/127.0.0.1:${PORT}/g" "${NGINX_TEMPLATE}" >"${tmp}"
    echo "${tmp}"
}

# --- Nginx + SSL (requires root) ---------------------------------------------------
banner "Nginx + TLS (${DOMAIN})"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    warn "Not root — skipping nginx/certbot. Run on the server:"
    echo "  cd ${APP_ROOT} && sudo CERTBOT_EMAIL=your@email.com ./deploy.sh"
    echo "Or copy nginx manually:"
    echo "  sudo cp ${NGINX_TEMPLATE} /etc/nginx/sites-available/${DOMAIN}"
    echo "  (edit proxy_pass port if not ${PORT})"
    exit 0
fi

if ! command -v nginx &>/dev/null; then
    err "nginx not installed. e.g. apt install nginx / pacman -S nginx"
    exit 1
fi

if [ ! -f "${NGINX_TEMPLATE}" ]; then
    err "Missing ${NGINX_TEMPLATE}"
    exit 1
fi

CONF_TMP="$(substitute_port_in_conf)"
cleanup_conf() { rm -f "${CONF_TMP}"; }
trap cleanup_conf EXIT

if ! nginx_install_conf "${CONF_TMP}" "${DOMAIN}"; then
    err "Could not find /etc/nginx/sites-available or /etc/nginx/conf.d"
    exit 1
fi

step "Testing nginx configuration…"
if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true
    info "Nginx reloaded (HTTP)"
else
    err "nginx -t failed — fix config and reload"
    exit 1
fi

if [ "${SKIP_SSL:-0}" = "1" ]; then
    ELAPSED=$(( $(date +%s) - START_TS ))
    banner "Deploy summary (${ELAPSED}s)"
    warn "SKIP_SSL=1 — HTTP only. Set DNS A record for ${DOMAIN} to this server."
    info "http://${DOMAIN}/"
    exit 0
fi

# --- Certbot (first setup only; renewal via certbot.timer) -------------------------
if le_cert_exists "${DOMAIN}"; then
    if le_nginx_has_ssl "${DOMAIN}"; then
        info "Certificate exists for ${DOMAIN} — HTTPS vhost OK."
    else
        step "Applying existing certificate to nginx (${DOMAIN})…"
        le_install_nginx_ssl "${DOMAIN}" \
            || warn "Could not apply SSL — run: sudo certbot install --cert-name ${DOMAIN}"
    fi
else
banner "Let's Encrypt (certbot)"

if ! command -v certbot &>/dev/null; then
    step "Installing certbot…"
    if command -v apt-get &>/dev/null; then
        apt-get update -qq && apt-get install -y certbot python3-certbot-nginx
    elif command -v pacman &>/dev/null; then
        pacman -Sy --noconfirm certbot certbot-nginx 2>/dev/null || warn "pacman install certbot failed — install manually"
    elif command -v dnf &>/dev/null; then
        dnf install -y certbot python3-certbot-nginx 2>/dev/null || true
    else
        warn "Install certbot + nginx plugin for your OS, then re-run deploy."
    fi
fi

if ! command -v certbot &>/dev/null; then
    err "certbot not found after install attempt"
    exit 1
fi

EMAIL="${CERTBOT_EMAIL:-}"
if [ -z "${EMAIL}" ] && [ -f "${APP_ROOT}/.env" ]; then
    EMAIL="$(grep -E '^[[:space:]]*CERTBOT_EMAIL=' "${APP_ROOT}/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')" || true
fi

CERTBOT_COMMON=(--nginx -d "${DOMAIN}" --agree-tos --non-interactive)
if [ -n "${EMAIL}" ]; then
    CERTBOT_COMMON+=(--email "${EMAIL}")
else
    warn "CERTBOT_EMAIL not set — using register-unsafely-without-email (not recommended for production)"
    CERTBOT_COMMON+=(--register-unsafely-without-email)
fi

step "Requesting / renewing certificate for ${DOMAIN}…"
set +e
certbot "${CERTBOT_COMMON[@]}" --redirect
CB=$?
set -e

if [ "${CB}" -ne 0 ]; then
    warn "certbot non-interactive failed (exit ${CB}). Trying interactive fallback…"
    printf '\nA\n1\n' | certbot --nginx -d "${DOMAIN}" || warn "certbot failed — ensure DNS A record for ${DOMAIN} points to this host and port 80 is reachable"
fi

if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true
else
    err "nginx -t failed after certbot"
    exit 1
fi

fi

ELAPSED=$(( $(date +%s) - START_TS ))
banner "Deploy summary (${ELAPSED}s)"
info "Deployment complete."

cat <<EOF

Live URLs:
  Dashboard:  https://${DOMAIN}/
  Local:      http://127.0.0.1:${PORT}/

Useful commands:
  pm2 status
  pm2 logs server-dashboard
  pm2 restart server-dashboard
EOF
