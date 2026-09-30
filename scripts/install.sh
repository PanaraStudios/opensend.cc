#!/bin/sh
set -eu

MIN_RAM_MB=3584 # a "4 GB" server reports about 3.7-3.9 GB of MemTotal
RELEASES_URL=https://github.com/PanaraStudios/opensend.cc/releases
LATEST_URL=https://api.github.com/repos/PanaraStudios/opensend.cc/releases/latest

say() { printf '%s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
help() {
  cat <<'USAGE'
Usage: install.sh [install|upgrade [version]|uninstall|help] [options]
  --dir PATH           Installation directory (OPENSEND_DIR; ./opensend)
  --version TAG        Release tag (OPENSEND_VERSION; latest GitHub release)
  --domain HOST        App hostname (OPENSEND_DOMAIN)
  --api-domain HOST    REST API, callbacks and tracking (OPENSEND_API_DOMAIN; api.<domain>)
  --realtime-domain HOST  Dashboard live updates (OPENSEND_REALTIME_DOMAIN; realtime.<domain>)
  --convex self|cloud  Backend mode (OPENSEND_CONVEX; self)
  --deploy-key KEY     Cloud deploy key (CONVEX_DEPLOY_KEY; prompted without echo)
  --convex-url URL     Cloud deployment URL (CONVEX_URL; derived from deploy key)
  --convex-site-url URL  Cloud HTTP site URL (CONVEX_SITE_URL; derived from URL)
  --caddy yes|no       HTTPS proxy (OPENSEND_CADDY; yes)
  --yes                Accept defaults (OPENSEND_YES=1)
  --local              Localhost URLs without Caddy (OPENSEND_LOCAL=1)
  --source-url URL     Compose asset base URL (OPENSEND_SOURCE_URL)
  --no-start           Write configuration only (OPENSEND_NO_START=1)
  --purge              Uninstall volumes; requires typing PURGE on /dev/tty
Image overrides APP_IMAGE, MIGRATE_IMAGE, SMTP_IMAGE, CONVEX_IMAGE and port
settings APP_PORT, CONVEX_PORT, CONVEX_SITE_PORT are saved in .env, as is
COMPOSE_PROJECT_NAME. Existing values are preserved on install; upgrade can
replace the app/migrate/SMTP image overrides supplied in its environment.
USAGE
}

command=install
dir=${OPENSEND_DIR:-./opensend}
version=${OPENSEND_VERSION:-}
domain=${OPENSEND_DOMAIN:-}
api_domain=${OPENSEND_API_DOMAIN:-}
realtime_domain=${OPENSEND_REALTIME_DOMAIN:-}
caddy=${OPENSEND_CADDY:-yes}
yes=${OPENSEND_YES:-0}
local=${OPENSEND_LOCAL:-0}
source_url=${OPENSEND_SOURCE_URL:-}
no_start=${OPENSEND_NO_START:-0}
convex_mode=${OPENSEND_CONVEX:-self}
deploy_key=${CONVEX_DEPLOY_KEY:-}
convex_url=${CONVEX_URL:-}
convex_site_url=${CONVEX_SITE_URL:-}
purge=0
case ${1:-} in
  install|upgrade|uninstall|help) command=$1; shift ;;
esac
if [ "$command" = upgrade ] && [ "$#" -gt 0 ]; then
  case $1 in --*) ;; *) version=$1; shift ;; esac
fi
while [ "$#" -gt 0 ]; do
  case $1 in
    --dir|--version|--domain|--api-domain|--realtime-domain|--caddy|--source-url|--convex|--deploy-key|--convex-url|--convex-site-url)
      [ "$#" -ge 2 ] || die "Missing value for $1"
      case $1 in
        --dir) dir=$2 ;; --version) version=$2 ;; --domain) domain=$2 ;;
        --api-domain) api_domain=$2 ;; --realtime-domain) realtime_domain=$2 ;;
        --caddy) caddy=$2 ;; --source-url) source_url=$2 ;;
        --convex) convex_mode=$2 ;; --deploy-key) deploy_key=$2 ;;
        --convex-url) convex_url=$2 ;; --convex-site-url) convex_site_url=$2 ;;
      esac
      shift 2 ;;
    --yes) yes=1; shift ;; --local) local=1; shift ;;
    --no-start) no_start=1; shift ;; --purge) purge=1; shift ;;
    --help|-h) command=help; shift ;;
    *) die "Unknown option: $1 (use help)" ;;
  esac
done
if [ "$command" = help ]; then help; exit 0; fi
case $caddy in yes|no) ;; *) die '--caddy must be yes or no' ;; esac
[ "$purge" = 0 ] || [ "$command" = uninstall ] || die '--purge requires uninstall'

tty_available=0
if ( : </dev/tty ) 2>/dev/null; then tty_available=1; fi
prompt() {
  prompt_label=$1
  prompt_default=$2
  answer=$prompt_default
  if [ "$yes" != 1 ] && [ "$tty_available" = 1 ]; then
    printf '%s [%s]: ' "$prompt_label" "$prompt_default" >/dev/tty
    read -r answer </dev/tty || answer=$prompt_default
    answer=${answer:-$prompt_default}
  fi
}

command -v docker >/dev/null 2>&1 || die 'Install Docker and the Docker Compose plugin first.'
docker info >/dev/null 2>&1 || die 'Docker daemon is not reachable.'
compose_version=$(docker compose version --short) || die 'Install Docker Compose v2 or later.'
compose_major=${compose_version#v}
compose_major=${compose_major%%.*}
case $compose_major in ''|*[!0-9]*) die 'Cannot determine Docker Compose version.' ;; esac
[ "$compose_major" -ge 2 ] || die 'Docker Compose v2 or later is required.'

if [ "$command" != install ]; then
  [ -f "$dir/.env" ] || die "No installation found in $dir"
else
  mkdir -p "$dir"
fi
cd "$dir"
dir=$(pwd -P)
env_file=$dir/.env
# Read configuration as data, never source a file containing credentials.
has_env() { [ -f "$env_file" ] && awk -F= -v key="$1" '$1 == key { found=1 } END { exit !found }' "$env_file"; }
get_env() {
  awk -v key="$1" 'index($0, key "=") == 1 {
    value=substr($0, length(key)+2)
    if (value ~ /^\047.*\047$/ || value ~ /^".*"$/) value=substr(value, 2, length(value)-2)
    print value; exit
  }' "$env_file"
}
if has_env OPENSEND_CONVEX; then convex_mode=$(get_env OPENSEND_CONVEX)
elif has_env INSTANCE_SECRET; then convex_mode=self; fi
case $convex_mode in self|cloud) ;; *) die '--convex must be self or cloud' ;; esac
compose() { docker compose --env-file "$env_file" "$@"; }

if [ "$command" = uninstall ]; then
  # Compose must use the persisted project and file selection.
  unset COMPOSE_PROJECT_NAME COMPOSE_FILE
  if [ "$purge" = 1 ]; then
    [ "$tty_available" = 1 ] || die 'Purging volumes requires a terminal and typed confirmation.'
    printf 'Delete all installation volumes permanently? Type PURGE: ' >/dev/tty
    read -r confirmation </dev/tty || die 'Purge cancelled.'
    [ "$confirmation" = PURGE ] || die 'Purge cancelled.'
    compose down --volumes
    say 'Stack stopped and volumes deleted. Configuration remains in the installation directory.'
  else
    compose down
    say 'Stack stopped. Volumes and configuration kept.'
  fi
  exit 0
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO- "$1"; }
else
  die 'Install curl or wget first.'
fi
random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else
    if [ ! -r /dev/urandom ] || ! command -v od >/dev/null 2>&1; then
      die 'Install openssl (or provide /dev/urandom and od).'
    fi
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}
ram_mb=0
if [ -r /proc/meminfo ]; then
  ram_mb=$(awk '/^MemTotal:/ { printf "%d", $2/1024 }' /proc/meminfo)
elif command -v sysctl >/dev/null 2>&1; then
  ram_bytes=$(sysctl -n hw.memsize 2>/dev/null || printf 0)
  ram_mb=$((ram_bytes / 1024 / 1024))
fi
if [ "$ram_mb" -gt 0 ] && [ "$ram_mb" -lt "$MIN_RAM_MB" ]; then
  warn "${ram_mb} MB RAM detected; the minimum is a 4 GB server. See https://opensend.cc/docs/self-hosting/requirements"
fi
if [ -z "$version" ]; then
  release=$(fetch "$LATEST_URL" 2>/dev/null || true)
  version=$(printf '%s' "$release" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  version=${version:-latest}
fi
case $version in *[!a-zA-Z0-9_.-]*|'') die 'Invalid release tag.' ;; esac
if [ "$command" = install ] && has_env OPENSEND_VERSION; then version=$(get_env OPENSEND_VERSION); fi

stamp=$(date -u +%Y%m%dT%H%M%SZ).$$
if [ "$command" = upgrade ]; then
  cp -p "$env_file" "$env_file.$stamp.bak"
  if [ "$convex_mode" = cloud ]; then
    say 'Back up your Convex Cloud data before upgrading. Export to a host file with:'
  else say 'Back up the convex-data volume before upgrading. Export to a host file with:'; fi
  say "  cd '$dir' && docker compose run --name opensend-backup migrate export --include-file-storage --path /tmp/backup.zip"
  say '  docker cp opensend-backup:/tmp/backup.zip ./backup.zip'
  say '  docker rm opensend-backup'
fi
if has_env COMPOSE_FILE; then
  case $(get_env COMPOSE_FILE) in *compose.caddy.yaml*|*compose.cloud-caddy.yaml*) caddy=yes ;; *) caddy=no ;; esac
elif [ "$local" = 1 ]; then caddy=no
else
  prompt 'Use Caddy for HTTPS (yes/no)' "$caddy"
  caddy=$answer
fi
case $caddy in yes|no) ;; *) die 'Caddy must be yes or no.' ;; esac
if has_env SITE_URL; then
  existing_site=$(get_env SITE_URL)
  case $existing_site in
    http://localhost:*|http://127.0.0.1:*) local=1 ;;
    *) existing_host=${existing_site#*://}
       existing_host=${existing_host%%/*}
       domain=${domain:-${existing_host%%:*}} ;;
  esac
fi
if [ "$local" != 1 ]; then
  if ! has_env SITE_URL; then prompt 'App hostname' "$domain"; domain=$answer; fi
  [ -n "$domain" ] || die 'Supply --domain HOST, or use --local for testing.'
  if [ "$convex_mode" = self ]; then
    api_domain=${api_domain:-api.$domain}
    realtime_domain=${realtime_domain:-realtime.$domain}
    if ! has_env CONVEX_PUBLIC_SITE_URL; then
      prompt 'API hostname' "$api_domain"; api_domain=$answer
    fi
    if ! has_env CONVEX_PUBLIC_URL; then
      prompt 'Realtime hostname' "$realtime_domain"; realtime_domain=$answer
    fi
    hosts="$domain $api_domain $realtime_domain"
  else hosts=$domain; fi
  for host in $hosts; do
    case $host in *[!a-zA-Z0-9.-]*|''|.*|*.) die "Invalid hostname: $host" ;; esac
  done
fi
if [ "$caddy" = yes ]; then
  if command -v ss >/dev/null 2>&1; then
    listeners=$(ss -ltn 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    listeners=$(lsof -nP -iTCP:80 -iTCP:443 -sTCP:LISTEN 2>/dev/null || true)
  else listeners=; fi
  if printf '%s\n' "$listeners" | grep -E '[:.](80|443)([[:space:]]|->|$)' >/dev/null 2>&1; then
    warn 'Ports 80/443 are in use; Caddy needs these ports.'
  fi
fi

if [ "$convex_mode" = cloud ]; then
  if has_env CONVEX_DEPLOY_KEY; then deploy_key=$(get_env CONVEX_DEPLOY_KEY); fi
  if [ -z "$deploy_key" ] && [ "$yes" != 1 ] && [ "$tty_available" = 1 ]; then
    printf 'Convex deployment deploy key: ' >/dev/tty
    terminal_state=$(stty -g </dev/tty)
    trap 'stty "$terminal_state" </dev/tty' 0
    trap 'exit 1' HUP INT TERM
    stty -echo </dev/tty
    read -r deploy_key </dev/tty || deploy_key=
    stty "$terminal_state" </dev/tty
    trap - 0 HUP INT TERM
    printf '\n' >/dev/tty
  fi
  [ -n "$deploy_key" ] || die 'Supply --deploy-key or CONVEX_DEPLOY_KEY for cloud mode.'
  if has_env CONVEX_URL; then convex_url=$(get_env CONVEX_URL)
  else
    if [ -z "$convex_url" ]; then
      deployment_name=${deploy_key%%|*}
      case $deployment_name in
        dev:*|prod:*) deployment_name=${deployment_name#*:} ;;
        *) deployment_name= ;;
      esac
      case $deployment_name in
        ''|*[!a-zA-Z0-9-]*) ;;
        *) convex_url=https://$deployment_name.convex.cloud ;;
      esac
    fi
    prompt 'Convex deployment URL' "$convex_url"; convex_url=$answer
  fi
  if has_env CONVEX_SITE_URL; then convex_site_url=$(get_env CONVEX_SITE_URL)
  else
    if [ -z "$convex_site_url" ]; then
      case $convex_url in
        *.convex.cloud) convex_site_url=${convex_url%.convex.cloud}.convex.site ;;
      esac
    fi
    prompt 'Convex HTTP site URL' "$convex_site_url"; convex_site_url=$answer
  fi
  for url in "$convex_url" "$convex_site_url"; do
    case $url in
      https://*) url_host=${url#https://}
        case $url_host in ''|*[!a-zA-Z0-9.:-]*) die 'Cloud URLs must be HTTPS origins without a path.' ;; esac ;;
      *) die 'Supply HTTPS --convex-url and --convex-site-url origins.' ;;
    esac
  done
fi

umask 077
touch "$env_file"
chmod 600 "$env_file"
# Separate appended defaults from an existing last line without a newline.
if [ -s "$env_file" ] && [ -n "$(tail -c 1 "$env_file")" ]; then printf '\n' >> "$env_file"; fi
put_env() {
  env_key=$1
  env_value=$2
  if has_env "$env_key" && [ "${3:-keep}" != replace ]; then return; fi
  # These settings are single-line literal values, without Compose interpolation.
  case $env_value in *[[:space:]]*|*\$*|*\#*|*\'*|*\"*|*\\*) die "Unsupported characters in $env_key" ;; esac
  if has_env "$env_key"; then
    awk -v key="$env_key" 'index($0, key "=") != 1 { print }' "$env_file" > "$env_file.tmp"
    mv "$env_file.tmp" "$env_file"
  fi
  printf '%s=%s\n' "$env_key" "$env_value" >> "$env_file"
}
# Append missing defaults only. Never rotate an existing secret, even on upgrade.
put_env OPENSEND_CONVEX "$convex_mode"
secret_keys="BETTER_AUTH_SECRET SSO_ENCRYPTION_KEY"
if [ "$convex_mode" = self ]; then
  put_env INSTANCE_NAME opensend
  secret_keys="INSTANCE_SECRET $secret_keys"
fi
for key in $secret_keys; do
  if ! has_env "$key"; then put_env "$key" "$(random_secret)"; fi
done
for key in APP_IMAGE MIGRATE_IMAGE SMTP_IMAGE; do
  case $key in APP_IMAGE) value=${APP_IMAGE:-} ;; MIGRATE_IMAGE) value=${MIGRATE_IMAGE:-} ;; SMTP_IMAGE) value=${SMTP_IMAGE:-} ;; esac
  if [ -n "$value" ]; then
    mode=keep
    [ "$command" != upgrade ] || mode=replace
    put_env "$key" "$value" "$mode"
  fi
done
[ -z "${CONVEX_IMAGE:-}" ] || put_env CONVEX_IMAGE "$CONVEX_IMAGE"
[ -z "${COMPOSE_PROJECT_NAME:-}" ] || put_env COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
put_env APP_PORT "${APP_PORT:-3000}"
put_env CONVEX_PORT "${CONVEX_PORT:-3210}"
put_env CONVEX_SITE_PORT "${CONVEX_SITE_PORT:-3211}"
if [ "$local" = 1 ]; then
  put_env SITE_URL "http://localhost:$(get_env APP_PORT)"
  if [ "$convex_mode" = self ]; then
    put_env CONVEX_PUBLIC_URL "http://localhost:$(get_env CONVEX_PORT)"
    put_env CONVEX_PUBLIC_SITE_URL "http://host.docker.internal:$(get_env CONVEX_SITE_PORT)"
    put_env CONVEX_BACKEND_ORIGIN "http://host.docker.internal:$(get_env CONVEX_PORT)"
  fi
else
  put_env SITE_URL "https://$domain"
  if [ "$convex_mode" = self ]; then
    put_env CONVEX_PUBLIC_URL "https://$realtime_domain"
    put_env CONVEX_PUBLIC_SITE_URL "https://$api_domain"
    put_env CONVEX_BACKEND_ORIGIN "$(get_env CONVEX_PUBLIC_URL)"
  fi
fi
mode=keep
[ "$command" != upgrade ] || mode=replace
put_env OPENSEND_VERSION "$version" "$mode"
if [ "$convex_mode" = cloud ]; then
  put_env CONVEX_DEPLOY_KEY "$deploy_key"
  put_env CONVEX_URL "$convex_url"
  put_env CONVEX_SITE_URL "$convex_site_url"
  put_env SES_CALLBACK_ORIGIN "$convex_site_url"
  compose_files=compose.yaml:compose.cloud.yaml
  if [ "$caddy" = yes ]; then compose_files=$compose_files:compose.cloud-caddy.yaml; fi
  put_env COMPOSE_FILE "$compose_files"
elif [ "$caddy" = yes ]; then put_env COMPOSE_FILE compose.yaml:compose.caddy.yaml
else put_env COMPOSE_FILE compose.yaml; fi

# Shell environment takes precedence over .env in Compose; the persisted values
# are authoritative after the caller's overrides have been saved.
unset APP_IMAGE MIGRATE_IMAGE SMTP_IMAGE CONVEX_IMAGE APP_PORT CONVEX_PORT CONVEX_SITE_PORT COMPOSE_PROJECT_NAME COMPOSE_FILE OPENSEND_VERSION
unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_URL CONVEX_SITE_URL
if [ "$convex_mode" = cloud ]; then unset SES_CALLBACK_ORIGIN; fi
unset INSTANCE_NAME INSTANCE_SECRET BETTER_AUTH_SECRET SSO_ENCRYPTION_KEY CONVEX_SELF_HOSTED_ADMIN_KEY SITE_URL CONVEX_PUBLIC_URL CONVEX_PUBLIC_SITE_URL CONVEX_BACKEND_ORIGIN
if [ -z "$source_url" ]; then
  if [ "$version" = latest ]; then source_url=$RELEASES_URL/latest/download
  else source_url=$RELEASES_URL/download/$version; fi
fi
staging=$(mktemp -d "$dir/.install.XXXXXX")
trap 'rm -rf "$staging"' 0
trap 'exit 1' HUP INT TERM
fetch "$source_url/compose.yaml" > "$staging/compose.yaml"
fetch "$source_url/compose.caddy.yaml" > "$staging/compose.caddy.yaml"
fetch "$source_url/compose.cloud.yaml" > "$staging/compose.cloud.yaml"
fetch "$source_url/compose.cloud-caddy.yaml" > "$staging/compose.cloud-caddy.yaml"
fetch "$source_url/Caddyfile.cloud" > "$staging/Caddyfile.cloud"
fetch "$source_url/Caddyfile" > "$staging/Caddyfile"
mkdir -p docker/caddy
for file in compose.yaml compose.caddy.yaml compose.cloud.yaml compose.cloud-caddy.yaml docker/caddy/Caddyfile docker/caddy/Caddyfile.cloud; do
  [ ! -f "$file" ] || cp -p "$file" "$file.$stamp.bak"
  mv "$staging/${file##*/}" "$file"
  chmod 644 "$file"
done
if [ "$convex_mode" = self ] && ! has_env CONVEX_SELF_HOSTED_ADMIN_KEY; then
  # Selecting only convex avoids relying on image ordering or a pinned digest.
  convex_image=$(compose config --images convex)
  [ -n "$convex_image" ] || die 'Compose did not resolve the Convex image.'
  admin_key=$(docker run --rm --entrypoint ./generate_key "$convex_image" "$(get_env INSTANCE_NAME)" "$(get_env INSTANCE_SECRET)")
  [ -n "$admin_key" ] || die 'Admin key generation returned no key.'
  put_env CONVEX_SELF_HOSTED_ADMIN_KEY "$admin_key"
fi
start() {
  if ! compose pull; then
    warn 'Image pull failed. Continuing only if every selected image is already available locally.'
    images=$(compose config --images) || return 1
    for image in $images; do docker image inspect "$image" >/dev/null 2>&1 || return 1; done
  fi
  # Recreate the completed one-shot so re-install also redeploys functions.
  compose rm -f migrate || return 1
  compose up -d --wait --no-build || return 1
  migrate_ids=$(compose ps -a -q migrate) || return 1
  migrate_id=
  # ps also includes one-off CLI containers such as an active log watcher.
  for container in $migrate_ids; do
    oneoff=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.oneoff" }}' "$container") || return 1
    case $oneoff in False|false) migrate_id=$container; break ;; esac
  done
  [ -n "$migrate_id" ] && [ "$(docker wait "$migrate_id")" = 0 ]
}
if [ "$no_start" != 1 ] && ! start; then
  say "Startup failed. Inspect: cd '$dir' && docker compose logs migrate app" >&2
  exit 1
fi
say "Opensend configuration is ready in $dir"
say "App URL: $(get_env SITE_URL)"
if [ "$convex_mode" = cloud ]; then api_url=$(get_env CONVEX_SITE_URL)
else api_url=$(get_env CONVEX_PUBLIC_SITE_URL); fi
say "API base URL (SDK and REST): $api_url"
say 'The first account you create becomes the installation admin.'
say "Auth and verification links: cd '$dir' && docker compose run --rm migrate logs"
case $(get_env SITE_URL) in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) say 'Point these DNS hostnames to your server IP:'
     dns_keys=SITE_URL
     if [ "$convex_mode" = self ]; then dns_keys="$dns_keys CONVEX_PUBLIC_URL CONVEX_PUBLIC_SITE_URL"; fi
     for key in $dns_keys; do
       url=$(get_env "$key"); say "  ${url#*://} -> server IP"
     done ;;
esac
say "Upgrade: curl -fsSL https://opensend.cc/install.sh | sh -s -- upgrade --dir '$dir'"
say "Uninstall (keep data): curl -fsSL https://opensend.cc/install.sh | sh -s -- uninstall --dir '$dir'"
