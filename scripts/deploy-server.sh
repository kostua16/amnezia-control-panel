#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="amnezia-control-panel"
DEFAULT_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/amnezia-control-panel/deploy.yaml"
DEFAULT_SECRETS_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/amnezia-control-panel/secrets.env"
DEFAULT_GHCR_USER="kostua16"
DEFAULT_IMAGE_REF="ghcr.io/kostua16/amnezia-control-panel:latest"
DEFAULT_RELEASE_REPO="kostua16/amnezia-control-panel"
DEFAULT_PORT="3333"
DEFAULT_APP_DIR="/opt/amnezia-control-panel"
DEFAULT_INSTALL_SERVICE="true"
DEFAULT_GHCR_TOKEN_REF="amnezia-control-panel/GHCR_TOKEN"
DEFAULT_ADMIN_PASSWORD_REF="amnezia-control-panel/ADMIN_PASSWORD"
DEFAULT_JWT_SECRET_REF="amnezia-control-panel/JWT_SECRET"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SELF_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"
AGENT_SOURCE="$SCRIPT_DIR/acp-agent.sh"

CONFIG_FILE="$DEFAULT_CONFIG"
ALLOW_PLAINTEXT_SECRETS="0"
IDENTITY_FILE=""
CLI_GHCR_TOKEN=""
CLI_ADMIN_PASSWORD=""
CLI_JWT_SECRET=""
CLI_GHCR_USER=""
CLI_IMAGE_REF=""
CLI_RELEASE_REPO=""
CLI_PORT=""
CLI_APP_DIR=""
CLI_NEXT_PUBLIC_APP_URL=""
CLI_INSTALL_SERVICE=""

usage() {
  cat <<'USAGE'
Usage:
  deploy-server.sh [global options] config init|show
  deploy-server.sh [global options] server add|remove|list ...
  deploy-server.sh [global options] install [server-name|user@host[:port] ...]
  deploy-server.sh [global options] status|healthcheck|care|cleanup [targets...]
  deploy-server.sh [global options] upgrade scripts|image|all [targets...]
  deploy-server.sh [global options] install-service|uninstall-service [targets...]
  deploy-server.sh [global options] logs [--follow] [targets...]

Global options:
  --config PATH
  --identity-file PATH
  --ghcr-token TOKEN
  --admin-password PASSWORD
  --jwt-secret SECRET
  --ghcr-user USER
  --image-ref REF
  --release-repo OWNER/REPO
  --port PORT
  --app-dir PATH
  --next-public-app-url URL
  --install-service
  --no-service
  --allow-plaintext-secrets

When no targets are passed, commands apply to all enabled servers in the config.
USAGE
}

log() {
  printf '[deploy-server] %s\n' "$*" >&2
}

die() {
  printf '[deploy-server] ERROR: %s\n' "$*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

shell_quote() {
  local value="${1-}"
  printf "'"
  printf '%s' "$value" | sed "s/'/'\\\\''/g"
  printf "'"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

unquote_yaml() {
  local value
  value="$(trim "$1")"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

ensure_config_dir() {
  mkdir -p "$(dirname -- "$CONFIG_FILE")"
}

config_init() {
  ensure_config_dir
  if [ -f "$CONFIG_FILE" ]; then
    log "config already exists: $CONFIG_FILE"
    return 0
  fi

  cat >"$CONFIG_FILE" <<CONFIG
version: 1
defaults:
  ghcr_user: $DEFAULT_GHCR_USER
  image_ref: $DEFAULT_IMAGE_REF
  release_repo: $DEFAULT_RELEASE_REPO
  port: $DEFAULT_PORT
  app_dir: $DEFAULT_APP_DIR
  install_service: true
secrets:
  ghcr_token_ref: $DEFAULT_GHCR_TOKEN_REF
  admin_password_ref: $DEFAULT_ADMIN_PASSWORD_REF
  jwt_secret_ref: $DEFAULT_JWT_SECRET_REF
servers:
CONFIG
  chmod 600 "$CONFIG_FILE"
  log "created $CONFIG_FILE"
}

config_show() {
  [ -f "$CONFIG_FILE" ] || die "config not found: $CONFIG_FILE"
  sed 's/[[:space:]]*$//' "$CONFIG_FILE"
}

config_get() {
  local section="$1"
  local key="$2"
  local fallback="${3-}"
  [ -f "$CONFIG_FILE" ] || {
    printf '%s' "$fallback"
    return 0
  }
  local value
  value="$(awk -v section="$section" -v key="$key" '
    $0 ~ "^[A-Za-z0-9_-]+:" {
      current=$1
      sub(/:$/, "", current)
      next
    }
    current == section && $0 ~ "^[[:space:]]+" key ":" {
      sub("^[[:space:]]+" key ":[[:space:]]*", "")
      print
      found=1
      exit
    }
    END { exit found ? 0 : 1 }
  ' "$CONFIG_FILE" 2>/dev/null || true)"
  if [ -n "$value" ]; then
    unquote_yaml "$value"
  else
    printf '%s' "$fallback"
  fi
}

default_value() {
  local key="$1"
  local fallback="$2"
  config_get "defaults" "$key" "$fallback"
}

secret_ref() {
  local key="$1"
  local fallback="$2"
  config_get "secrets" "$key" "$fallback"
}

server_records() {
  [ -f "$CONFIG_FILE" ] || return 0
  awk '
    function clean(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if (value ~ /^".*"$/ || value ~ /^'\''.*'\''$/) {
        value=substr(value, 2, length(value)-2)
      }
      return value
    }
    function emit() {
      if (name != "") {
        printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n", name, host, user, ssh_port, enabled, labels, next_public_app_url, image_ref, port, app_dir, install_service
      }
    }
    /^servers:/ { in_servers=1; next }
    in_servers && /^  - name:/ {
      emit()
      name=host=user=ssh_port=enabled=labels=next_public_app_url=image_ref=port=app_dir=install_service=""
      value=$0
      sub(/^  - name:[[:space:]]*/, "", value)
      name=clean(value)
      next
    }
    in_servers && /^    [A-Za-z0-9_]+:/ {
      key=$1
      sub(/:$/, "", key)
      value=$0
      sub(/^    [A-Za-z0-9_]+:[[:space:]]*/, "", value)
      value=clean(value)
      if (key == "host") host=value
      else if (key == "user") user=value
      else if (key == "ssh_port") ssh_port=value
      else if (key == "enabled") enabled=value
      else if (key == "labels") labels=value
      else if (key == "next_public_app_url") next_public_app_url=value
      else if (key == "image_ref") image_ref=value
      else if (key == "port") port=value
      else if (key == "app_dir") app_dir=value
      else if (key == "install_service") install_service=value
      next
    }
    END { emit() }
  ' "$CONFIG_FILE"
}

record_field() {
  local record="$1"
  local index="$2"
  awk -F'|' -v idx="$index" '{ print $idx }' <<<"$record"
}

server_by_name() {
  local name="$1"
  server_records | awk -F'|' -v name="$name" '$1 == name { print; found=1; exit } END { exit found ? 0 : 1 }'
}

enabled_server_records() {
  server_records | awk -F'|' '$5 == "" || $5 == "true" || $5 == "yes" || $5 == "1"'
}

literal_target_record() {
  local target="$1"
  local user host port name
  user="root"
  port="22"
  host="$target"

  if [[ "$host" == *@* ]]; then
    user="${host%@*}"
    host="${host#*@}"
  fi
  if [[ "$host" == *:* ]]; then
    port="${host##*:}"
    host="${host%:*}"
  fi
  name="$host"
  printf '%s|%s|%s|%s|true||||||\n' "$name" "$host" "$user" "$port"
}

resolve_targets() {
  if [ "$#" -eq 0 ]; then
    enabled_server_records
    return 0
  fi

  local target record
  for target in "$@"; do
    if record="$(server_by_name "$target" 2>/dev/null)"; then
      printf '%s\n' "$record"
    else
      literal_target_record "$target"
    fi
  done
}

server_list() {
  printf '%-20s %-28s %-12s %-8s %-8s %s\n' "NAME" "HOST" "USER" "PORT" "ENABLED" "LABELS"
  server_records | while IFS='|' read -r name host user ssh_port enabled labels _rest; do
    printf '%-20s %-28s %-12s %-8s %-8s %s\n' \
      "$name" "$host" "${user:-root}" "${ssh_port:-22}" "${enabled:-true}" "$labels"
  done
}

server_add() {
  config_init
  local name="" host="" user="root" ssh_port="22" labels="" enabled="true" next_public_app_url="" image_ref="" port="" app_dir="" install_service=""

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name) name="${2:-}"; shift 2 ;;
      --host) host="${2:-}"; shift 2 ;;
      --user) user="${2:-}"; shift 2 ;;
      --ssh-port) ssh_port="${2:-}"; shift 2 ;;
      --labels) labels="${2:-}"; shift 2 ;;
      --url | --next-public-app-url) next_public_app_url="${2:-}"; shift 2 ;;
      --image-ref) image_ref="${2:-}"; shift 2 ;;
      --port) port="${2:-}"; shift 2 ;;
      --app-dir) app_dir="${2:-}"; shift 2 ;;
      --install-service) install_service="true"; shift ;;
      --no-service) install_service="false"; shift ;;
      --disabled) enabled="false"; shift ;;
      --enabled) enabled="true"; shift ;;
      --) shift; break ;;
      -*)
        die "unknown server add option: $1"
        ;;
      *)
        if [ -z "$name" ]; then
          name="$1"
        elif [ -z "$host" ]; then
          host="$1"
        else
          die "unexpected server add argument: $1"
        fi
        shift
        ;;
    esac
  done

  [ -n "$name" ] || die "server name is required"
  [ -n "$host" ] || die "server host is required"
  if [[ "$host" == *@* ]]; then
    user="${host%@*}"
    host="${host#*@}"
  fi
  if [[ "$host" == *:* ]]; then
    ssh_port="${host##*:}"
    host="${host%:*}"
  fi
  if server_by_name "$name" >/dev/null 2>&1; then
    die "server already exists: $name"
  fi

  {
    printf '  - name: %s\n' "$name"
    printf '    host: %s\n' "$host"
    printf '    user: %s\n' "$user"
    printf '    ssh_port: %s\n' "$ssh_port"
    printf '    enabled: %s\n' "$enabled"
    [ -z "$labels" ] || printf '    labels: %s\n' "$labels"
    [ -z "$next_public_app_url" ] || printf '    next_public_app_url: %s\n' "$next_public_app_url"
    [ -z "$image_ref" ] || printf '    image_ref: %s\n' "$image_ref"
    [ -z "$port" ] || printf '    port: %s\n' "$port"
    [ -z "$app_dir" ] || printf '    app_dir: %s\n' "$app_dir"
    [ -z "$install_service" ] || printf '    install_service: %s\n' "$install_service"
  } >>"$CONFIG_FILE"
  log "added server $name"
}

server_remove() {
  local name="${1:-}"
  [ -n "$name" ] || die "server name is required"
  [ -f "$CONFIG_FILE" ] || die "config not found: $CONFIG_FILE"
  local tmp
  tmp="$(mktemp)"
  awk -v remove="$name" '
    /^  - name:/ {
      value=$0
      sub(/^  - name:[[:space:]]*/, "", value)
      skipping=(value == remove)
    }
    skipping != 1 { print }
  ' "$CONFIG_FILE" >"$tmp"
  mv "$tmp" "$CONFIG_FILE"
  log "removed server $name"
}

parse_global_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --config) CONFIG_FILE="${2:-}"; shift 2 ;;
      --identity-file) IDENTITY_FILE="${2:-}"; shift 2 ;;
      --ghcr-token) CLI_GHCR_TOKEN="${2:-}"; shift 2 ;;
      --admin-password) CLI_ADMIN_PASSWORD="${2:-}"; shift 2 ;;
      --jwt-secret) CLI_JWT_SECRET="${2:-}"; shift 2 ;;
      --ghcr-user) CLI_GHCR_USER="${2:-}"; shift 2 ;;
      --image-ref) CLI_IMAGE_REF="${2:-}"; shift 2 ;;
      --release-repo) CLI_RELEASE_REPO="${2:-}"; shift 2 ;;
      --port) CLI_PORT="${2:-}"; shift 2 ;;
      --app-dir) CLI_APP_DIR="${2:-}"; shift 2 ;;
      --next-public-app-url) CLI_NEXT_PUBLIC_APP_URL="${2:-}"; shift 2 ;;
      --install-service) CLI_INSTALL_SERVICE="true"; shift ;;
      --no-service) CLI_INSTALL_SERVICE="false"; shift ;;
      --allow-plaintext-secrets) ALLOW_PLAINTEXT_SECRETS="1"; shift ;;
      -h | --help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      *)
        break
        ;;
    esac
  done
  REMAINING_ARGS=("$@")
}

keychain_get() {
  local ref="$1"
  if have_cmd security; then
    security find-generic-password -a "$USER" -s "$ref" -w 2>/dev/null || return 1
  elif have_cmd secret-tool; then
    secret-tool lookup service "$APP_NAME" ref "$ref" 2>/dev/null || return 1
  else
    return 1
  fi
}

keychain_store() {
  local ref="$1"
  local value="$2"
  if have_cmd security; then
    security add-generic-password -U -a "$USER" -s "$ref" -w "$value" >/dev/null
  elif have_cmd secret-tool; then
    printf '%s' "$value" | secret-tool store --label="$APP_NAME $ref" service "$APP_NAME" ref "$ref"
  else
    return 1
  fi
}

plaintext_secret_get() {
  local ref="$1"
  [ -f "$DEFAULT_SECRETS_FILE" ] || return 1
  awk -F= -v ref="$ref" '$1 == ref { sub(/^[^=]*=/, ""); print; found=1 } END { exit found ? 0 : 1 }' "$DEFAULT_SECRETS_FILE"
}

plaintext_secret_store() {
  local ref="$1"
  local value="$2"
  ensure_config_dir
  touch "$DEFAULT_SECRETS_FILE"
  chmod 600 "$DEFAULT_SECRETS_FILE"
  local tmp
  tmp="$(mktemp)"
  awk -F= -v ref="$ref" '$1 != ref' "$DEFAULT_SECRETS_FILE" >"$tmp"
  printf '%s=%s\n' "$ref" "$value" >>"$tmp"
  mv "$tmp" "$DEFAULT_SECRETS_FILE"
  chmod 600 "$DEFAULT_SECRETS_FILE"
}

prompt_secret() {
  local label="$1"
  local ref="$2"
  [ -t 0 ] || die "$label is required; set the environment variable or store it in the keychain reference $ref"
  local value
  printf '%s (%s): ' "$label" "$ref" >&2
  stty -echo
  IFS= read -r value
  stty echo
  printf '\n' >&2
  [ -n "$value" ] || die "$label cannot be empty"

  if keychain_store "$ref" "$value"; then
    log "stored $label in OS credential storage as $ref"
  elif [ "$ALLOW_PLAINTEXT_SECRETS" = "1" ]; then
    plaintext_secret_store "$ref" "$value"
    log "stored $label in $DEFAULT_SECRETS_FILE"
  else
    die "no OS credential storage is available; install secret-tool/security or pass --allow-plaintext-secrets"
  fi
  printf '%s' "$value"
}

get_secret() {
  local label="$1"
  local env_name="$2"
  local cli_value="$3"
  local ref="$4"
  local required="${5:-1}"
  local value=""

  if [ -n "$cli_value" ]; then
    printf '%s' "$cli_value"
    return 0
  fi
  value="${!env_name:-}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
    return 0
  fi
  if value="$(keychain_get "$ref" 2>/dev/null)"; then
    printf '%s' "$value"
    return 0
  fi
  if [ "$ALLOW_PLAINTEXT_SECRETS" = "1" ] && value="$(plaintext_secret_get "$ref" 2>/dev/null)"; then
    printf '%s' "$value"
    return 0
  fi
  if [ "$required" = "1" ]; then
    prompt_secret "$label" "$ref"
    return 0
  fi
  return 1
}

value_for_record() {
  local cli="$1"
  local env_name="$2"
  local record_value="$3"
  local default_value_input="$4"
  if [ -n "$cli" ]; then
    printf '%s' "$cli"
  elif [ -n "${!env_name:-}" ]; then
    printf '%s' "${!env_name}"
  elif [ -n "$record_value" ]; then
    printf '%s' "$record_value"
  else
    printf '%s' "$default_value_input"
  fi
}

ssh_args_for_record() {
  local record="$1"
  local host user ssh_port
  host="$(record_field "$record" 2)"
  user="$(record_field "$record" 3)"
  ssh_port="$(record_field "$record" 4)"
  [ -n "$host" ] || die "target host is missing"
  user="${user:-root}"
  ssh_port="${ssh_port:-22}"

  SSH_ARGS=(-p "$ssh_port")
  if [ -n "$IDENTITY_FILE" ]; then
    SSH_ARGS+=(-i "$IDENTITY_FILE")
  fi
  SSH_DEST="$user@$host"
}

install_remote_agent() {
  local record="$1"
  [ -f "$AGENT_SOURCE" ] || die "remote agent source not found: $AGENT_SOURCE"
  ssh_args_for_record "$record"
  log "installing agent on $SSH_DEST"
  ssh "${SSH_ARGS[@]}" "$SSH_DEST" 'set -e; tmp=$(mktemp); cat > "$tmp"; if [ "$(id -u)" -eq 0 ]; then install -m 755 "$tmp" /usr/local/bin/acp-agent; else sudo -n install -m 755 "$tmp" /usr/local/bin/acp-agent; fi; rm -f "$tmp"' <"$AGENT_SOURCE"
}

remote_agent() {
  local record="$1"
  shift
  ssh_args_for_record "$record"
  local agent_args=""
  local arg
  for arg in "$@"; do
    agent_args+=" $(shell_quote "$arg")"
  done
  local command="set -e; if [ \"\$(id -u)\" -eq 0 ]; then /usr/local/bin/acp-agent$agent_args; else sudo -n /usr/local/bin/acp-agent$agent_args; fi"
  # shellcheck disable=SC2029 # The quoted command must be evaluated by the remote shell.
  ssh "${SSH_ARGS[@]}" "$SSH_DEST" "$command"
}

payload_line() {
  local key="$1"
  local value="$2"
  case "$value" in
    *$'\n'* | *$'\r'*) die "$key cannot contain newlines" ;;
  esac
  printf '%s=%s\n' "$key" "$value"
}

build_bootstrap_payload() {
  local record="$1"
  local ghcr_user image_ref release_repo port app_dir next_public_app_url install_service
  local ghcr_token admin_password jwt_secret

  ghcr_user="$(value_for_record "$CLI_GHCR_USER" "GHCR_USER" "" "$(default_value ghcr_user "$DEFAULT_GHCR_USER")")"
  image_ref="$(value_for_record "$CLI_IMAGE_REF" "IMAGE_REF" "$(record_field "$record" 8)" "$(default_value image_ref "$DEFAULT_IMAGE_REF")")"
  release_repo="$(value_for_record "$CLI_RELEASE_REPO" "RELEASE_REPO" "" "$(default_value release_repo "$DEFAULT_RELEASE_REPO")")"
  port="$(value_for_record "$CLI_PORT" "PORT" "$(record_field "$record" 9)" "$(default_value port "$DEFAULT_PORT")")"
  app_dir="$(value_for_record "$CLI_APP_DIR" "APP_DIR" "$(record_field "$record" 10)" "$(default_value app_dir "$DEFAULT_APP_DIR")")"
  install_service="$(value_for_record "$CLI_INSTALL_SERVICE" "INSTALL_SERVICE" "$(record_field "$record" 11)" "$(default_value install_service "$DEFAULT_INSTALL_SERVICE")")"
  next_public_app_url="$(value_for_record "$CLI_NEXT_PUBLIC_APP_URL" "NEXT_PUBLIC_APP_URL" "$(record_field "$record" 7)" "http://localhost:$port")"

  ghcr_token="$(get_secret "GHCR_TOKEN" "GHCR_TOKEN" "$CLI_GHCR_TOKEN" "$(secret_ref ghcr_token_ref "$DEFAULT_GHCR_TOKEN_REF")")"
  admin_password="$(get_secret "ADMIN_PASSWORD" "ADMIN_PASSWORD" "$CLI_ADMIN_PASSWORD" "$(secret_ref admin_password_ref "$DEFAULT_ADMIN_PASSWORD_REF")")"
  jwt_secret="$(get_secret "JWT_SECRET" "JWT_SECRET" "$CLI_JWT_SECRET" "$(secret_ref jwt_secret_ref "$DEFAULT_JWT_SECRET_REF")" 0 || true)"

  payload_line "GHCR_USER" "$ghcr_user"
  payload_line "GHCR_TOKEN" "$ghcr_token"
  payload_line "IMAGE_REF" "$image_ref"
  payload_line "RELEASE_REPO" "$release_repo"
  payload_line "PORT" "$port"
  payload_line "APP_DIR" "$app_dir"
  payload_line "NEXT_PUBLIC_APP_URL" "$next_public_app_url"
  payload_line "ADMIN_PASSWORD" "$admin_password"
  payload_line "INSTALL_SERVICE" "$install_service"
  if [ -n "$jwt_secret" ]; then
    payload_line "JWT_SECRET" "$jwt_secret"
  fi
}

install_target() {
  local record="$1"
  local install_service
  install_service="$(value_for_record "$CLI_INSTALL_SERVICE" "INSTALL_SERVICE" "$(record_field "$record" 11)" "$(default_value install_service "$DEFAULT_INSTALL_SERVICE")")"
  install_remote_agent "$record"
  ssh_args_for_record "$record"
  local agent_args=" bootstrap --env-stdin"
  if [ "$install_service" = "false" ] || [ "$install_service" = "0" ] || [ "$install_service" = "no" ]; then
    agent_args+=" --no-service"
  else
    agent_args+=" --install-service"
  fi
  local command="set -e; if [ \"\$(id -u)\" -eq 0 ]; then /usr/local/bin/acp-agent$agent_args; else sudo -n /usr/local/bin/acp-agent$agent_args; fi"
  # shellcheck disable=SC2029 # The quoted command must be evaluated by the remote shell.
  build_bootstrap_payload "$record" | ssh "${SSH_ARGS[@]}" "$SSH_DEST" "$command"
}

for_each_target() {
  local action="$1"
  shift
  local records
  records="$(resolve_targets "$@")"
  [ -n "$records" ] || die "no targets provided and no enabled servers in config"

  local record name
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    name="$(record_field "$record" 1)"
    log "target: $name"
    case "$action" in
      install) install_target "$record" ;;
      status) remote_agent "$record" status ;;
      healthcheck) remote_agent "$record" healthcheck ;;
      care) remote_agent "$record" care ;;
      cleanup) remote_agent "$record" cleanup ;;
      install-service) install_remote_agent "$record"; remote_agent "$record" install-service ;;
      uninstall-service) remote_agent "$record" uninstall-service ;;
      logs) remote_agent "$record" logs ;;
      upgrade:*) remote_agent "$record" upgrade "${action#upgrade:}" ;;
      *) die "unknown target action: $action" ;;
    esac
  done <<<"$records"
}

sha256_file() {
  if have_cmd shasum; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif have_cmd sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "shasum or sha256sum is required"
  fi
}

download_release_asset() {
  local asset="$1"
  local output="$2"
  local token url
  token="$(get_secret "GHCR_TOKEN" "GHCR_TOKEN" "$CLI_GHCR_TOKEN" "$(secret_ref ghcr_token_ref "$DEFAULT_GHCR_TOKEN_REF")" 0 || true)"
  token="${GITHUB_TOKEN:-$token}"
  url="https://github.com/$(value_for_record "$CLI_RELEASE_REPO" "RELEASE_REPO" "" "$(default_value release_repo "$DEFAULT_RELEASE_REPO")")/releases/latest/download/$asset"
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

self_upgrade() {
  have_cmd curl || die "curl is required for self-upgrade"
  local tmp next checksums
  tmp="$(mktemp -d)"
  next="$tmp/deploy-server.sh"
  checksums="$tmp/checksums.txt"
  download_release_asset "deploy-server.sh" "$next"
  download_release_asset "checksums.txt" "$checksums"
  verify_asset_checksum "$checksums" "$next"
  chmod +x "$next"
  if cmp -s "$next" "$SELF_PATH"; then
    log "local helper is already current"
    rm -rf "$tmp"
    return 0
  fi
  install -m 755 "$next" "$SELF_PATH"
  log "updated $SELF_PATH"
  rm -rf "$tmp"
}

cmd_config() {
  local subcommand="${1:-}"
  case "$subcommand" in
    init) config_init ;;
    show) config_show ;;
    *) die "config subcommand must be init or show" ;;
  esac
}

cmd_server() {
  local subcommand="${1:-}"
  shift || true
  case "$subcommand" in
    add) server_add "$@" ;;
    remove) server_remove "$@" ;;
    list) server_list ;;
    *) die "server subcommand must be add, remove, or list" ;;
  esac
}

cmd_upgrade() {
  local target="${1:-all}"
  shift || true
  case "$target" in
    scripts)
      self_upgrade
      for_each_target "upgrade:scripts" "$@"
      ;;
    image)
      for_each_target "upgrade:image" "$@"
      ;;
    all)
      self_upgrade
      for_each_target "upgrade:all" "$@"
      ;;
    *) die "upgrade target must be scripts, image, or all" ;;
  esac
}

cmd_logs() {
  local follow=""
  if [ "${1:-}" = "--follow" ] || [ "${1:-}" = "-f" ]; then
    follow="--follow"
    shift
  fi
  local records
  records="$(resolve_targets "$@")"
  [ -n "$records" ] || die "no targets provided and no enabled servers in config"

  local record name
  while IFS= read -r record; do
    [ -n "$record" ] || continue
    name="$(record_field "$record" 1)"
    log "target: $name"
    if [ -n "$follow" ]; then
      remote_agent "$record" logs "$follow"
    else
      remote_agent "$record" logs
    fi
  done <<<"$records"
}

main() {
  parse_global_options "$@"
  set -- "${REMAINING_ARGS[@]}"
  local command="${1:-}"
  [ -n "$command" ] || {
    usage
    exit 1
  }
  shift || true

  case "$command" in
    config) cmd_config "$@" ;;
    server) cmd_server "$@" ;;
    install) for_each_target "install" "$@" ;;
    status) for_each_target "status" "$@" ;;
    healthcheck) for_each_target "healthcheck" "$@" ;;
    care) for_each_target "care" "$@" ;;
    cleanup) for_each_target "cleanup" "$@" ;;
    upgrade) cmd_upgrade "$@" ;;
    install-service) for_each_target "install-service" "$@" ;;
    uninstall-service) for_each_target "uninstall-service" "$@" ;;
    logs) cmd_logs "$@" ;;
    -h | --help | help) usage ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
