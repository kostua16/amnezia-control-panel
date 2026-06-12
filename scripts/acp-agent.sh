#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="amnezia-control-panel"
CONFIG_DIR="${ACP_CONFIG_DIR:-/etc/amnezia-control-panel}"
STATE_DIR="${ACP_STATE_DIR:-/var/lib/amnezia-control-panel-agent}"
BIN_PATH="${ACP_AGENT_BIN:-/usr/local/bin/acp-agent}"
TOKEN_FILE="${ACP_TOKEN_FILE:-$CONFIG_DIR/ghcr-token}"
AGENT_ENV="$CONFIG_DIR/agent.env"

DEFAULT_APP_DIR="/opt/amnezia-control-panel"
DEFAULT_GHCR_USER="kostua16"
DEFAULT_IMAGE_REF="ghcr.io/kostua16/amnezia-control-panel:latest"
DEFAULT_RELEASE_REPO="kostua16/amnezia-control-panel"
DEFAULT_PORT="3333"
ROLLBACK_REF="amnezia-control-panel:last-good"

APP_DIR="$DEFAULT_APP_DIR"
GHCR_USER="$DEFAULT_GHCR_USER"
IMAGE_REF="$DEFAULT_IMAGE_REF"
RELEASE_REPO="$DEFAULT_RELEASE_REPO"
PORT="$DEFAULT_PORT"
NEXT_PUBLIC_APP_URL=""
JWT_SECRET=""
ADMIN_PASSWORD=""
INSTALL_SERVICE="1"

COMPOSE_FILE=""
APP_ENV_FILE=""
FAILURE_COUNT_FILE=""
LAST_GOOD_FILE=""

usage() {
  cat <<'USAGE'
Usage:
  acp-agent bootstrap [--env-stdin] [--install-service|--no-service]
  acp-agent status
  acp-agent healthcheck
  acp-agent care
  acp-agent cleanup
  acp-agent upgrade scripts|image|all
  acp-agent install-service
  acp-agent uninstall-service
  acp-agent logs [--follow]

This script is intended to run as root on the target server.
USAGE
}

log() {
  printf '[acp-agent] %s\n' "$*" >&2
}

die() {
  printf '[acp-agent] ERROR: %s\n' "$*" >&2
  exit 1
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

require_root() {
  is_root || die "this command must run as root"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

truthy() {
  case "${1:-}" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

shell_quote() {
  local value="${1-}"
  printf "'"
  printf '%s' "$value" | sed "s/'/'\\\\''/g"
  printf "'"
}

write_env_line() {
  local key="$1"
  local value="$2"
  printf '%s=' "$key"
  shell_quote "$value"
  printf '\n'
}

generate_secret() {
  if have_cmd openssl; then
    openssl rand -hex 32
    return
  fi
  LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 64
  printf '\n'
}

read_env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; found=1 } END { exit found ? 0 : 1 }' "$file"
}

refresh_paths() {
  COMPOSE_FILE="$APP_DIR/compose.yaml"
  APP_ENV_FILE="$APP_DIR/.env"
  FAILURE_COUNT_FILE="$STATE_DIR/failure-count"
  LAST_GOOD_FILE="$STATE_DIR/last-good-image"
}

load_config() {
  if [ -f "$AGENT_ENV" ]; then
    # shellcheck source=/dev/null
    . "$AGENT_ENV"
  fi

  APP_DIR="${APP_DIR:-$DEFAULT_APP_DIR}"
  GHCR_USER="${GHCR_USER:-$DEFAULT_GHCR_USER}"
  IMAGE_REF="${IMAGE_REF:-$DEFAULT_IMAGE_REF}"
  RELEASE_REPO="${RELEASE_REPO:-$DEFAULT_RELEASE_REPO}"
  PORT="${PORT:-$DEFAULT_PORT}"
  NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:$PORT}"
  INSTALL_SERVICE="${INSTALL_SERVICE:-1}"
  refresh_paths
}

write_agent_config() {
  install -d -m 700 "$CONFIG_DIR"
  local tmp
  tmp="$(mktemp)"
  {
    write_env_line "APP_DIR" "$APP_DIR"
    write_env_line "GHCR_USER" "$GHCR_USER"
    write_env_line "IMAGE_REF" "$IMAGE_REF"
    write_env_line "RELEASE_REPO" "$RELEASE_REPO"
    write_env_line "PORT" "$PORT"
    write_env_line "NEXT_PUBLIC_APP_URL" "$NEXT_PUBLIC_APP_URL"
    write_env_line "INSTALL_SERVICE" "$INSTALL_SERVICE"
  } >"$tmp"
  install -m 600 -o root -g root "$tmp" "$AGENT_ENV"
  rm -f "$tmp"
}

store_token() {
  local token="$1"
  [ -n "$token" ] || return 0
  install -d -m 700 "$CONFIG_DIR"
  umask 077
  printf '%s\n' "$token" >"$TOKEN_FILE"
  chown root:root "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
}

read_token() {
  [ -f "$TOKEN_FILE" ] || die "missing GHCR token file: $TOKEN_FILE"
  tr -d '\r\n' <"$TOKEN_FILE"
}

parse_env_stdin() {
  local line key value
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      APP_DIR) APP_DIR="$value" ;;
      GHCR_USER) GHCR_USER="$value" ;;
      GHCR_TOKEN) store_token "$value" ;;
      IMAGE_REF) IMAGE_REF="$value" ;;
      RELEASE_REPO) RELEASE_REPO="$value" ;;
      PORT) PORT="$value" ;;
      NEXT_PUBLIC_APP_URL) NEXT_PUBLIC_APP_URL="$value" ;;
      JWT_SECRET) JWT_SECRET="$value" ;;
      ADMIN_PASSWORD) ADMIN_PASSWORD="$value" ;;
      INSTALL_SERVICE) INSTALL_SERVICE="$value" ;;
      *) log "ignoring unknown bootstrap key: $key" ;;
    esac
  done
}

detect_os() {
  [ -r /etc/os-release ] || die "cannot detect OS: /etc/os-release is missing"
  # shellcheck source=/dev/null
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_ID_LIKE="${ID_LIKE:-}"
  OS_VERSION_ID="${VERSION_ID:-}"
  OS_CODENAME="${VERSION_CODENAME:-}"
}

install_docker_debian() {
  local repo_id codename arch
  repo_id="$1"
  codename="$2"

  have_cmd apt-get || die "apt-get is required for Debian/Ubuntu Docker installation"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$repo_id/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  arch="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$arch" "$repo_id" "$codename" >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_rhel() {
  local package_manager
  if have_cmd dnf; then
    package_manager="dnf"
  elif have_cmd yum; then
    package_manager="yum"
  else
    die "dnf or yum is required for CentOS/RHEL-family Docker installation"
  fi

  "$package_manager" -y install ca-certificates curl dnf-plugins-core || \
    "$package_manager" -y install ca-certificates curl yum-utils

  if [ "$package_manager" = "dnf" ]; then
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  else
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  fi

  "$package_manager" -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker() {
  if have_cmd docker && docker compose version >/dev/null 2>&1; then
    log "Docker Engine and Compose plugin already installed"
    return
  fi

  detect_os
  case "$OS_ID" in
    ubuntu)
      install_docker_debian "ubuntu" "${OS_CODENAME:-}"
      ;;
    debian)
      install_docker_debian "debian" "${OS_CODENAME:-}"
      ;;
    centos | rhel | rocky | almalinux | ol)
      case "$OS_VERSION_ID" in
        9* | stream9) install_docker_rhel ;;
        *) die "only CentOS Stream 9 / RHEL 9-family hosts are supported for this installer; detected $OS_ID $OS_VERSION_ID" ;;
      esac
      ;;
    *)
      case " $OS_ID_LIKE " in
        *" debian "*) die "unsupported Debian-like derivative '$OS_ID'; use Ubuntu or Debian for automatic Docker repo setup" ;;
        *" rhel "* | *" fedora "*) install_docker_rhel ;;
        *) die "unsupported OS for automatic Docker installation: ${OS_ID:-unknown}" ;;
      esac
      ;;
  esac

  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is not available after installation"
}

enable_docker() {
  if have_cmd systemctl; then
    systemctl enable --now docker
  else
    service docker start || true
  fi
}

write_compose() {
  install -d -m 755 "$APP_DIR"
  cat >"$COMPOSE_FILE" <<COMPOSE
services:
  app:
    image: "$IMAGE_REF"
    container_name: amnezia-control-panel
    restart: unless-stopped
    pull_policy: always
    ports:
      - "$PORT:3333"
    env_file:
      - .env
    volumes:
      - db-data:/app/data/prisma
      - geoip-data:/app/data/geoip
      - log-data:/app/logs
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3333/"]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3

volumes:
  db-data:
    driver: local
  geoip-data:
    driver: local
  log-data:
    driver: local
COMPOSE
  chmod 644 "$COMPOSE_FILE"
}

write_app_env() {
  install -d -m 755 "$APP_DIR"

  if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET="$(read_env_value "$APP_ENV_FILE" "JWT_SECRET" 2>/dev/null || true)"
  fi
  if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET="$(generate_secret)"
  fi

  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(read_env_value "$APP_ENV_FILE" "ADMIN_PASSWORD" 2>/dev/null || true)"
  fi
  [ -n "$ADMIN_PASSWORD" ] || die "ADMIN_PASSWORD is required for first bootstrap"

  local tmp
  tmp="$(mktemp)"
  {
    write_env_line "NODE_ENV" "production"
    write_env_line "PORT" "3333"
    write_env_line "HOSTNAME" "0.0.0.0"
    write_env_line "JWT_SECRET" "$JWT_SECRET"
    write_env_line "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
    write_env_line "DATABASE_URL" "file:/app/data/prisma/dev.db"
    write_env_line "NEXT_PUBLIC_APP_URL" "$NEXT_PUBLIC_APP_URL"
  } >"$tmp"
  install -m 600 -o root -g root "$tmp" "$APP_ENV_FILE"
  rm -f "$tmp"
}

compose() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$APP_DIR" "$@"
}

docker_auth_compose_pull() {
  local token docker_config
  token="$(read_token)"
  docker_config="$(mktemp -d)"
  if ! printf '%s\n' "$token" | docker --config "$docker_config" login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null; then
    rm -rf "$docker_config"
    return 1
  fi
  if ! docker --config "$docker_config" compose -f "$COMPOSE_FILE" --project-directory "$APP_DIR" pull; then
    rm -rf "$docker_config"
    return 1
  fi
  docker --config "$docker_config" logout ghcr.io >/dev/null 2>&1 || true
  rm -rf "$docker_config"
}

http_probe() {
  local url="http://127.0.0.1:$PORT/"
  if have_cmd curl; then
    curl -fsS --max-time 5 "$url" >/dev/null
  elif have_cmd wget; then
    wget -q --timeout=5 --tries=1 --spider "$url" >/dev/null
  else
    log "curl/wget missing; skipping HTTP probe"
    return 0
  fi
}

container_id() {
  compose ps -q app 2>/dev/null || true
}

healthcheck() {
  load_config
  docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
  [ -f "$COMPOSE_FILE" ] || die "Compose file is missing: $COMPOSE_FILE"

  local cid status health
  cid="$(container_id)"
  [ -n "$cid" ] || die "app container is missing"

  status="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || true)"
  [ "$status" = "running" ] || die "app container is not running: $status"

  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)"
  case "$health" in
    healthy | none) ;;
    *) die "app container health is $health" ;;
  esac

  http_probe || die "app HTTP probe failed on 127.0.0.1:$PORT"
  log "healthcheck passed"
}

wait_for_health() {
  local _attempt
  for _attempt in $(seq 1 30); do
    if healthcheck >/dev/null 2>&1; then
      log "app is healthy"
      return 0
    fi
    sleep 2
  done
  return 1
}

reset_failures() {
  install -d -m 700 "$STATE_DIR"
  printf '0\n' >"$FAILURE_COUNT_FILE"
}

increment_failures() {
  install -d -m 700 "$STATE_DIR"
  local count
  count="$(cat "$FAILURE_COUNT_FILE" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\n' "$count" >"$FAILURE_COUNT_FILE"
  printf '%s\n' "$count"
}

care() {
  require_root
  load_config
  enable_docker

  if healthcheck; then
    reset_failures
    return 0
  fi

  local count cid health
  count="$(increment_failures)"
  log "health repair attempt $count"

  cid="$(container_id)"
  if [ -z "$cid" ]; then
    compose up -d --pull never
  else
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    if [ "$health" = "unhealthy" ]; then
      compose restart app || true
    else
      compose up -d --pull never
    fi
  fi

  if [ "$count" -ge 3 ]; then
    log "repeated failures detected; force recreating app container"
    compose up -d --force-recreate --pull never
  fi

  if wait_for_health; then
    reset_failures
    return 0
  fi

  die "care could not restore a healthy app"
}

bootstrap() {
  require_root
  load_config

  local read_stdin="0"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --env-stdin) read_stdin="1" ;;
      --install-service) INSTALL_SERVICE="1" ;;
      --no-service) INSTALL_SERVICE="0" ;;
      -h | --help)
        usage
        return 0
        ;;
      *) die "unknown bootstrap option: $1" ;;
    esac
    shift
  done

  [ "$read_stdin" = "0" ] || parse_env_stdin
  NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:$PORT}"
  refresh_paths

  install -d -m 700 "$CONFIG_DIR" "$STATE_DIR"
  write_agent_config
  install_docker
  enable_docker
  write_compose
  write_app_env
  docker_auth_compose_pull
  compose up -d --pull never
  wait_for_health || die "app did not become healthy after bootstrap"

  if truthy "$INSTALL_SERVICE"; then
    install_service
  fi
}

status() {
  load_config
  printf 'App: %s\n' "$APP_NAME"
  printf 'App dir: %s\n' "$APP_DIR"
  printf 'Image: %s\n' "$IMAGE_REF"
  printf 'Port: %s\n' "$PORT"
  printf 'Release repo: %s\n' "$RELEASE_REPO"
  printf 'Token file: %s\n' "$TOKEN_FILE"
  printf '\nCompose status:\n'
  if [ -f "$COMPOSE_FILE" ] && have_cmd docker; then
    compose ps || true
  else
    printf 'Compose file or Docker is unavailable.\n'
  fi
  if have_cmd systemctl; then
    printf '\nTimers:\n'
    systemctl list-timers 'amnezia-control-panel-*' --no-pager 2>/dev/null || true
  fi
}

cleanup() {
  require_root
  load_config
  docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
  docker container prune -f
  docker image prune -f
  docker builder prune -af --filter 'until=168h' || true
  log "cleanup complete; named volumes were not pruned"
}

sha256_file() {
  if have_cmd sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  elif have_cmd shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "sha256sum or shasum is required"
  fi
}

download_release_asset() {
  local asset="$1"
  local output="$2"
  local token
  token="$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\r\n' || true)"
  local url="https://github.com/$RELEASE_REPO/releases/latest/download/$asset"
  if [ -n "$token" ]; then
    curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/octet-stream" -o "$output" "$url"
  else
    curl -fsSL -o "$output" "$url"
  fi
}

verify_asset_checksum() {
  local checksums="$1"
  local asset_path="$2"
  local asset expected actual
  asset="$(basename "$asset_path")"
  expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$checksums")"
  [ -n "$expected" ] || die "checksum for $asset not found"
  actual="$(sha256_file "$asset_path")"
  [ "$actual" = "$expected" ] || die "checksum mismatch for $asset"
}

upgrade_scripts() {
  require_root
  load_config
  have_cmd curl || die "curl is required for script upgrades"

  local tmp next checksums changed
  tmp="$(mktemp -d)"
  next="$tmp/acp-agent.sh"
  checksums="$tmp/checksums.txt"

  download_release_asset "acp-agent.sh" "$next"
  download_release_asset "checksums.txt" "$checksums"
  verify_asset_checksum "$checksums" "$next"
  chmod +x "$next"

  changed="0"
  if [ ! -f "$BIN_PATH" ] || ! cmp -s "$next" "$BIN_PATH"; then
    install -m 755 -o root -g root "$next" "$BIN_PATH"
    changed="1"
    log "updated $BIN_PATH"
  else
    log "agent script is already current"
  fi

  if [ "$changed" = "1" ] && have_cmd systemctl; then
    systemctl daemon-reload || true
    systemctl restart amnezia-control-panel-care.timer amnezia-control-panel-upgrade.timer amnezia-control-panel-cleanup.timer 2>/dev/null || true
  fi
  rm -rf "$tmp"
}

tag_last_good_image() {
  if printf '%s' "$IMAGE_REF" | grep -q '@'; then
    log "image reference uses a digest; rollback tagging is not available"
    return 0
  fi

  local old_id
  old_id="$(docker image inspect "$IMAGE_REF" --format '{{.Id}}' 2>/dev/null || true)"
  [ -n "$old_id" ] || return 0
  docker tag "$old_id" "$ROLLBACK_REF"
  install -d -m 700 "$STATE_DIR"
  printf '%s\n' "$old_id" >"$LAST_GOOD_FILE"
}

rollback_image() {
  if ! docker image inspect "$ROLLBACK_REF" >/dev/null 2>&1; then
    die "upgrade failed and no rollback image is available"
  fi
  if printf '%s' "$IMAGE_REF" | grep -q '@'; then
    die "upgrade failed and digest image references cannot be retagged for rollback"
  fi
  log "rolling back to previous local image"
  docker tag "$ROLLBACK_REF" "$IMAGE_REF"
  compose up -d --force-recreate --pull never
  wait_for_health || die "rollback image did not become healthy"
}

upgrade_image() {
  require_root
  load_config
  enable_docker
  tag_last_good_image
  docker_auth_compose_pull
  compose up -d --pull never
  if wait_for_health; then
    reset_failures
    tag_last_good_image
    log "image upgrade complete"
    return 0
  fi
  rollback_image
}

upgrade() {
  local target="${1:-all}"
  case "$target" in
    scripts) upgrade_scripts ;;
    image) upgrade_image ;;
    all)
      upgrade_scripts
      upgrade_image
      ;;
    *) die "upgrade target must be scripts, image, or all" ;;
  esac
}

write_unit() {
  local path="$1"
  shift
  cat >"$path"
  chmod 644 "$path"
}

install_service() {
  require_root
  have_cmd systemctl || die "systemd is required for service installation"
  load_config

  write_unit /etc/systemd/system/amnezia-control-panel-care.service <<UNIT
[Unit]
Description=Amnezia Control Panel self-care
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=$BIN_PATH care
UNIT

  write_unit /etc/systemd/system/amnezia-control-panel-care.timer <<UNIT
[Unit]
Description=Run Amnezia Control Panel self-care every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=30s
Persistent=true
Unit=amnezia-control-panel-care.service

[Install]
WantedBy=timers.target
UNIT

  write_unit /etc/systemd/system/amnezia-control-panel-upgrade.service <<UNIT
[Unit]
Description=Upgrade Amnezia Control Panel scripts and image
After=docker.service network-online.target
Wants=docker.service network-online.target

[Service]
Type=oneshot
ExecStart=$BIN_PATH upgrade all
UNIT

  write_unit /etc/systemd/system/amnezia-control-panel-upgrade.timer <<UNIT
[Unit]
Description=Check Amnezia Control Panel upgrades hourly

[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
RandomizedDelaySec=20min
Persistent=true
Unit=amnezia-control-panel-upgrade.service

[Install]
WantedBy=timers.target
UNIT

  write_unit /etc/systemd/system/amnezia-control-panel-cleanup.service <<UNIT
[Unit]
Description=Clean unused Amnezia Control Panel Docker state
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=$BIN_PATH cleanup
UNIT

  write_unit /etc/systemd/system/amnezia-control-panel-cleanup.timer <<UNIT
[Unit]
Description=Run Amnezia Control Panel cleanup daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=30min
Persistent=true
Unit=amnezia-control-panel-cleanup.service

[Install]
WantedBy=timers.target
UNIT

  systemctl daemon-reload
  systemctl enable --now \
    amnezia-control-panel-care.timer \
    amnezia-control-panel-upgrade.timer \
    amnezia-control-panel-cleanup.timer
}

uninstall_service() {
  require_root
  have_cmd systemctl || die "systemd is required for service removal"
  systemctl disable --now \
    amnezia-control-panel-care.timer \
    amnezia-control-panel-upgrade.timer \
    amnezia-control-panel-cleanup.timer 2>/dev/null || true
  rm -f \
    /etc/systemd/system/amnezia-control-panel-care.service \
    /etc/systemd/system/amnezia-control-panel-care.timer \
    /etc/systemd/system/amnezia-control-panel-upgrade.service \
    /etc/systemd/system/amnezia-control-panel-upgrade.timer \
    /etc/systemd/system/amnezia-control-panel-cleanup.service \
    /etc/systemd/system/amnezia-control-panel-cleanup.timer
  systemctl daemon-reload
}

logs() {
  load_config
  local follow=""
  if [ "${1:-}" = "--follow" ] || [ "${1:-}" = "-f" ]; then
    follow="-f"
  fi
  if have_cmd journalctl; then
    journalctl $follow -u amnezia-control-panel-care.service -u amnezia-control-panel-upgrade.service -u amnezia-control-panel-cleanup.service --no-pager
  elif have_cmd docker && [ -f "$COMPOSE_FILE" ]; then
    compose logs ${follow:+--follow} app
  else
    die "neither journalctl nor Docker Compose logs are available"
  fi
}

main() {
  local command="${1:-}"
  if [ -z "$command" ]; then
    usage
    exit 1
  fi
  shift || true

  case "$command" in
    bootstrap) bootstrap "$@" ;;
    status) status "$@" ;;
    healthcheck) healthcheck "$@" ;;
    care) care "$@" ;;
    cleanup) cleanup "$@" ;;
    upgrade) upgrade "$@" ;;
    install-service) install_service "$@" ;;
    uninstall-service) uninstall_service "$@" ;;
    logs) logs "$@" ;;
    -h | --help | help) usage ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
