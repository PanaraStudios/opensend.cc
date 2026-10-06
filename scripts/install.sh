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
  --upgrade            Alias for the upgrade command
  --calling yes|no     Enable media services (OPENSEND_CALLING; no)
  --calling-domain HOST  Browser calling hostname (OPENSEND_CALLING_DOMAIN; calling.<domain>)
  --calling-public-ip IP  Public IPv4 / 1:1 NAT address (OPENSEND_CALLING_PUBLIC_IP)
  --calling-wss-port PORT  Browser WSS port (CALLING_WSS_PORT; 7443)
  --calling-cert-dir PATH  Absolute directory with trusted wss.pem (FREESWITCH_CERT_DIR)
  --janus-rtp-range START-END  Meta UDP media ports (JANUS_RTP_RANGE; 20000-20199)
  --freeswitch-rtp-range START-END  Agent UDP media ports (FREESWITCH_RTP_RANGE; 20400-20799)
  --turn yes|no        Optional agent TURN server (OPENSEND_TURN; no)
  --turn-port PORT     TURN TCP/UDP listener (CALL_TURN_PORT; 3478)
  --turn-relay-range START-END  TURN relay UDP ports (CALL_TURN_RELAY_RANGE; 20800-20999)
  --yes                Accept defaults (OPENSEND_YES=1)
  --local              Localhost URLs without Caddy (OPENSEND_LOCAL=1)
  --source-url URL     Compose asset base URL (OPENSEND_SOURCE_URL)
  --no-start           Write configuration only (OPENSEND_NO_START=1)
  --purge              Uninstall volumes; requires typing PURGE on /dev/tty
Image overrides APP_IMAGE, MIGRATE_IMAGE, SMTP_IMAGE, CONVEX_IMAGE and port
settings APP_PORT, CONVEX_PORT, CONVEX_SITE_PORT are saved in .env, as is
COMPOSE_PROJECT_NAME. Existing values are preserved on install; upgrade can
replace any Opensend image override supplied in its environment (including
JANUS_IMAGE, FREESWITCH_IMAGE, DRACHTIO_IMAGE, COTURN_IMAGE, CALL_GATEWAY_IMAGE,
VOICE_AGENT_IMAGE). Calling and TURN can be enabled later with --calling yes /
--turn yes; saved settings and secrets are preserved. An upgrade or a running
re-install backs up local Convex data first. --no-start does not back up or deploy.
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
calling=${OPENSEND_CALLING:-}
calling_domain=${OPENSEND_CALLING_DOMAIN:-}
calling_ip=${OPENSEND_CALLING_PUBLIC_IP:-}
wss_port=${CALLING_WSS_PORT:-7443}
cert_dir=${FREESWITCH_CERT_DIR:-}
janus_range=${JANUS_RTP_RANGE:-20000-20199}
fs_range=${FREESWITCH_RTP_RANGE:-20400-20799}
turn=${OPENSEND_TURN:-}
turn_port=${CALL_TURN_PORT:-3478}
turn_tls_port=${CALL_TURN_TLS_PORT:-5349}
turn_range=${CALL_TURN_RELAY_RANGE:-20800-20999}
purge=0
case ${1:-} in
  install|upgrade|uninstall|help) command=$1; shift ;;
esac
if [ "$command" = upgrade ] && [ "$#" -gt 0 ]; then
  case $1 in --*) ;; *) version=$1; shift ;; esac
fi
while [ "$#" -gt 0 ]; do
  case $1 in
    --dir|--version|--domain|--api-domain|--realtime-domain|--caddy|--source-url|--convex|--deploy-key|--convex-url|--convex-site-url|--calling|--calling-domain|--calling-public-ip|--calling-wss-port|--calling-cert-dir|--janus-rtp-range|--freeswitch-rtp-range|--turn|--turn-port|--turn-relay-range)
      [ "$#" -ge 2 ] || die "Missing value for $1"
      case $1 in
        --dir) dir=$2 ;; --version) version=$2 ;; --domain) domain=$2 ;;
        --api-domain) api_domain=$2 ;; --realtime-domain) realtime_domain=$2 ;;
        --caddy) caddy=$2 ;; --source-url) source_url=$2 ;;
        --convex) convex_mode=$2 ;; --deploy-key) deploy_key=$2 ;;
        --convex-url) convex_url=$2 ;; --convex-site-url) convex_site_url=$2 ;;
        --calling) calling=$2 ;; --calling-domain) calling_domain=$2 ;;
        --calling-public-ip) calling_ip=$2 ;; --calling-wss-port) wss_port=$2 ;;
        --calling-cert-dir) cert_dir=$2 ;; --janus-rtp-range) janus_range=$2 ;;
        --freeswitch-rtp-range) fs_range=$2 ;; --turn) turn=$2 ;;
        --turn-port) turn_port=$2 ;; --turn-relay-range) turn_range=$2 ;;
      esac
      shift 2 ;;
    --upgrade) command=upgrade; shift ;;
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
[ "$compose_major" -ge 2 ] || die 'Docker Compose 2.24.4 or newer is required.'
if ! printf '%s\n' "${compose_version#v}" | awk -F. '
  $1 > 2 || ($1 == 2 && ($2 > 24 || ($2 == 24 && $3+0 >= 4))) { valid=1 }
  END { exit !valid }'; then die 'Docker Compose 2.24.4 or newer is required for the release add-ons.'; fi

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

# Explicit opt-in can add calling to an existing v1/v2 install. Other saved
# settings remain authoritative, just like the app origins and auth secrets.
if has_env OPENSEND_CALLING && [ "$(get_env OPENSEND_CALLING)" = yes ]; then calling=yes; fi
if has_env OPENSEND_TURN && [ "$(get_env OPENSEND_TURN)" = yes ]; then turn=yes; fi
if [ -z "$calling" ]; then prompt 'Enable WhatsApp calling (yes/no)' no; calling=$answer; fi
case $calling in yes|no) ;; *) die '--calling must be yes or no' ;; esac
if [ -z "$turn" ]; then
  turn=no
  if [ "$calling" = yes ]; then prompt 'Enable optional agent TURN server (yes/no)' no; turn=$answer; fi
fi
case $turn in yes|no) ;; *) die '--turn must be yes or no' ;; esac
[ "$calling" = yes ] || [ "$turn" = no ] || die '--turn yes requires --calling yes'
valid_port() {
  case $2 in ''|*[!0-9]*|0*) die "$1 must be a port from 1024 to 65535" ;; esac
  [ "${#2}" -le 5 ] && [ "$2" -ge 1024 ] && [ "$2" -le 65535 ] || die "Invalid $1 port"
}
valid_range() {
  if ! printf '%s\n' "$2" | awk -F- '
    /^[1-9][0-9]*-[1-9][0-9]*$/ && NF == 2 && $1 >= 1024 && $2 <= 65535 && $1 < $2 { valid=1 }
    END { exit !valid }'; then die "$1 must be START-END within 1024-65535"; fi
}
if [ "$calling" = yes ]; then
  [ "$convex_mode" = self ] || die 'Calling with Convex Cloud requires a secured public gateway proxy. Use the manual calling guide; this installer supports calling with local Convex.'
  if has_env OPENSEND_CALLING_DOMAIN; then calling_domain=$(get_env OPENSEND_CALLING_DOMAIN)
  else prompt 'Calling hostname' "${calling_domain:-calling.${domain:-localhost}}"; calling_domain=$answer; fi
  case $calling_domain in ''|*[!a-zA-Z0-9.-]*|.*|*.) die 'Invalid calling hostname' ;; esac
  if has_env JANUS_PUBLIC_IP; then calling_ip=$(get_env JANUS_PUBLIC_IP)
  else prompt 'Public IPv4 address (use 127.0.0.1 only for local tests)' "$calling_ip"; calling_ip=$answer; fi
  if ! printf '%s\n' "$calling_ip" | awk -F. '
    NF == 4 && /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {
      valid=1; for (i=1;i<=4;i++) if ($i > 255 || length($i)>3 || (length($i)>1 && substr($i,1,1)=="0")) valid=0
    } END { exit !valid }'; then die 'Supply --calling-public-ip with an IPv4 address'; fi
  if [ "$local" != 1 ] && ! printf '%s\n' "$calling_ip" | awk -F. '
    $1 == 0 || $1 == 10 || $1 == 127 || $1 >= 224 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168) || ($1 == 169 && $2 == 254) || ($1 == 100 && $2 >= 64 && $2 <= 127) { exit 1 }'; then
    die 'Calling needs a public IPv4 address'
  fi
  for pair in CALLING_WSS_PORT FREESWITCH_CERT_DIR JANUS_RTP_RANGE FREESWITCH_RTP_RANGE CALL_TURN_PORT CALL_TURN_TLS_PORT CALL_TURN_RELAY_RANGE; do
    if has_env "$pair"; then
      value=$(get_env "$pair")
      case $pair in
        CALLING_WSS_PORT) wss_port=$value ;; FREESWITCH_CERT_DIR) cert_dir=$value ;;
        JANUS_RTP_RANGE) janus_range=$value ;; FREESWITCH_RTP_RANGE) fs_range=$value ;;
        CALL_TURN_PORT) turn_port=$value ;; CALL_TURN_TLS_PORT) turn_tls_port=$value ;; CALL_TURN_RELAY_RANGE) turn_range=$value ;;
      esac
    fi
  done
  valid_port CALLING_WSS_PORT "$wss_port"
  valid_port CALL_TURN_PORT "$turn_port"
  valid_port CALL_TURN_TLS_PORT "$turn_tls_port"
  valid_range JANUS_RTP_RANGE "$janus_range"
  valid_range FREESWITCH_RTP_RANGE "$fs_range"
  valid_range CALL_TURN_RELAY_RANGE "$turn_range"
  # SIP media uses 20200-20399 internally; don't make it public or reuse it.
  ranges="$janus_range $fs_range 20200-20399"
  if [ "$turn" = yes ]; then ranges="$ranges $turn_range $turn_port-$turn_port"; fi
  if ! printf '%s\n' "$ranges" | awk '{
    for (i=1;i<=NF;i++) {
      split($i,a,"-"); for(j=1;j<i;j++) { split($j,b,"-"); if(a[1]<=b[2] && b[1]<=a[2]) exit 1 }
    }
  }'; then die 'Calling UDP ranges overlap each other or the private SIP range 20200-20399'; fi
  if [ "$turn" = yes ] && [ "$wss_port" = "$turn_port" ]; then die 'WSS and TURN TCP ports must differ'; fi
  if [ "$turn" = yes ]; then
    [ "$turn_tls_port" != "$turn_port" ] && [ "$turn_tls_port" != "$wss_port" ] || die 'TURN TLS, TURN and WSS TCP ports must differ'
  fi
  if [ -n "$cert_dir" ]; then
    case $cert_dir in /*) ;; *) die '--calling-cert-dir must be an absolute path' ;; esac
  fi
  if [ "$local" != 1 ] && [ "$no_start" != 1 ]; then
    [ -n "$cert_dir" ] && [ -s "$cert_dir/wss.pem" ] || die 'Before enabling calling, supply --calling-cert-dir with a trusted wss.pem (key then full chain), readable by UID 10002. See docs/self-hosting.md.'
  fi
  if [ "$ram_mb" -gt 0 ] && [ "$ram_mb" -lt 7168 ]; then warn 'Calling: plan for at least 8 GB RAM, more for voice bots and busy instances.'; fi
fi

# Fetch all assets before changing the live configuration or stopping services.
if [ -z "$source_url" ]; then
  if [ "$version" = latest ]; then source_url=$RELEASES_URL/latest/download
  else source_url=$RELEASES_URL/download/$version; fi
fi
staging=$(mktemp -d "$dir/.install.XXXXXX")
trap 'rm -rf "$staging"' 0
trap 'exit 1' HUP INT TERM
for asset in compose.yaml compose.caddy.yaml compose.cloud.yaml compose.cloud-caddy.yaml Caddyfile.cloud Caddyfile; do
  fetch "$source_url/$asset" > "$staging/$asset"
done

clear_compose_env() {
  unset APP_IMAGE MIGRATE_IMAGE SMTP_IMAGE CONVEX_IMAGE APP_PORT CONVEX_PORT CONVEX_SITE_PORT COMPOSE_PROJECT_NAME COMPOSE_FILE OPENSEND_VERSION COMPOSE_PROFILES
  unset JANUS_IMAGE FREESWITCH_IMAGE DRACHTIO_IMAGE COTURN_IMAGE CALL_GATEWAY_IMAGE VOICE_AGENT_IMAGE
  unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_URL CONVEX_SITE_URL
  unset INSTANCE_NAME INSTANCE_SECRET BETTER_AUTH_SECRET SSO_ENCRYPTION_KEY CONVEX_SELF_HOSTED_ADMIN_KEY SITE_URL CONVEX_PUBLIC_URL CONVEX_PUBLIC_SITE_URL CONVEX_BACKEND_ORIGIN
  unset CALL_GATEWAY_URL CALL_GATEWAY_SECRET CALL_AGENT_WSS_URL CALL_AGENT_QUEUES VOICE_AGENT_SECRET JANUS_API_SECRET FREESWITCH_ESL_SECRET FREESWITCH_SIP_SECRET FREESWITCH_DIRECTORY_SECRET DRACHTIO_SECRET
  unset CALLING_WSS_PORT FREESWITCH_CERT_DIR JANUS_RTP_RANGE FREESWITCH_RTP_RANGE JANUS_PUBLIC_IP FREESWITCH_PUBLIC_IP CALL_GATEWAY_CONVEX_HTTP_URL CALL_TURN_PUBLIC_IP CALL_TURN_PASSWORD CALL_TURN_SECRET CALL_TURN_URLS CALL_STUN_URLS CALL_TURN_REALM CALL_TURN_TLS_PORT CALL_TURN_CERT_DIR CALL_TURN_CERT_FILE CALL_TURN_KEY_FILE CALL_TURN_PORT CALL_TURN_RELAY_RANGE
  if [ "$convex_mode" = cloud ]; then unset SES_CALLBACK_ORIGIN; fi
}
backup() (
  # Back up the actual mounted volume, including auth component and file data.
  # Use the old migrate image, with no network and without any backend secrets.
  clear_compose_env
  backup_dir=$dir/backups/$stamp
  umask 077
  mkdir -p "$backup_dir"
  cp -p "$env_file" "$backup_dir/env"
  chmod 600 "$backup_dir/env"
  for file in compose.yaml compose.caddy.yaml compose.cloud.yaml compose.cloud-caddy.yaml; do
    [ ! -f "$file" ] || cp -p "$file" "$backup_dir/"
  done
  [ ! -d docker ] || cp -R docker "$backup_dir/docker"
  if [ "$convex_mode" = cloud ]; then
    say "Exporting Convex Cloud data to $backup_dir (includes file storage)."
    backup_container=opensend-backup-$stamp
    if ! compose run --name "$backup_container" --no-deps -T migrate export --include-file-storage --path /tmp/export.zip > "$backup_dir/export.log" 2>&1; then
      docker rm "$backup_container" >/dev/null 2>&1 || true
      die "Backup failed; see $backup_dir/export.log. No upgrade was applied."
    fi
    docker cp "$backup_container:/tmp/export.zip" "$backup_dir/export.zip"
    docker rm "$backup_container" >/dev/null
    chmod 600 "$backup_dir/export.zip"
    [ -s "$backup_dir/export.zip" ] || die 'Cloud export produced no backup; upgrade cancelled.'
  else
    container=$(compose ps -a -q convex)
    if [ -n "$container" ]; then
      volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$container")
      [ -n "$volume" ] || die 'Convex data is not a named volume; back it up manually before using this installer.'
      docker inspect --format '{{.Image}}' "$container" > "$backup_dir/convex-image-id"
    else
      # Compose down removes containers but keeps volumes. Also distinguish a
      # configuration-only install that has never created a data volume.
      saved_project=$(compose config | awk '/^name:/ { print $2; exit }')
      [ -n "$saved_project" ] || die 'Cannot resolve the existing Compose project for backup.'
      volume=$(docker volume ls --filter "label=com.docker.compose.project=$saved_project" --filter label=com.docker.compose.volume=convex-data --format '{{.Name}}')
      if [ -z "$volume" ]; then
        if [ "$command" = install ]; then
          say 'No existing Convex data volume; starting the prepared configuration.'
          exit 0
        fi
        die 'Cannot find the existing Convex volume. Restore/start the old stack before upgrading.'
      fi
      case $volume in *[[:space:]]*) die 'Multiple Convex volumes found; resolve the project before upgrading.' ;; esac
      compose config --images convex > "$backup_dir/convex-image-id"
    fi
    docker volume inspect "$volume" >/dev/null 2>&1 || die 'Existing Convex volume is missing; upgrade cancelled.'
    # Use the regular container's immutable image, even if its tag was changed
    # or removed. ps can also include one-off containers such as log watchers.
    old_image=
    migrate_containers=$(compose ps -a -q migrate)
    for migrate_container in $migrate_containers; do
      oneoff=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.oneoff" }}' "$migrate_container")
      case $oneoff in
        False|false)
          old_image=$(docker inspect --format '{{.Image}}' "$migrate_container")
          break ;;
      esac
    done
    if [ -z "$old_image" ]; then
      # After compose down, resolve the saved service's image. --images migrate
      # also lists dependency images, so it cannot resolve a single image name.
      old_image=$(compose config migrate | awk '
        /^  migrate:$/ { selected=1; next }
        /^  [^ ]/ { selected=0 }
        selected && /^    image:/ {
          sub(/^    image:[[:space:]]*/, "")
          if ($0 ~ /^\047.*\047$/ || $0 ~ /^".*"$/) $0=substr($0, 2, length($0)-2)
          print
        }')
    fi
    [ -n "$old_image" ] || die 'Cannot resolve the existing migrate image; upgrade cancelled.'
    docker image inspect "$old_image" >/dev/null 2>&1 || die 'The existing migrate image is missing. Restore it before backing up/upgrading.'
    say 'Stopping the stack for a consistent Convex volume backup.'
    compose stop
    # The archive is written as root inside the container, so hand it to the
    # installing user and restrict it there; the host user can't chmod root's file.
    if ! docker run --rm --pull never --network none --user 0 --entrypoint sh \
      -e BACKUP_OWNER="$(id -u):$(id -g)" \
      --mount "type=volume,src=$volume,dst=/data,readonly" \
      --mount "type=bind,src=$backup_dir,dst=/backup" "$old_image" \
      -c 'tar -czf /backup/convex-data.tar.gz -C /data . && tar -tzf /backup/convex-data.tar.gz >/dev/null && chown "$BACKUP_OWNER" /backup/convex-data.tar.gz && chmod 600 /backup/convex-data.tar.gz'; then
      die 'Volume backup failed. Old configuration is unchanged and services are stopped. Check disk space, then retry.'
    fi
    [ -s "$backup_dir/convex-data.tar.gz" ] || die 'No volume archive was produced; upgrade cancelled.'
  fi
  say "Backup saved in $backup_dir. Keep it and its private env file for recovery."
)
if [ -s "$env_file" ]; then
  cp -p "$env_file" "$env_file.$stamp.bak"
  chmod 600 "$env_file.$stamp.bak"
  if [ "$no_start" != 1 ]; then backup; fi
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
for key in APP_IMAGE MIGRATE_IMAGE SMTP_IMAGE JANUS_IMAGE FREESWITCH_IMAGE DRACHTIO_IMAGE COTURN_IMAGE CALL_GATEWAY_IMAGE VOICE_AGENT_IMAGE; do
  value=$(printenv "$key" || true)
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

# Opting in only adds profiles; retain other profiles such as smtp or debug.
put_env OPENSEND_CALLING "$calling" replace
put_env OPENSEND_TURN "$turn" replace
if [ "$calling" = yes ]; then
  profiles=$(get_env COMPOSE_PROFILES 2>/dev/null || true)
  case ,$profiles, in *,calling,*) ;; *) profiles=${profiles:+$profiles,}calling ;; esac
  if [ "$turn" = yes ]; then
    case ,$profiles, in *,calling-turn,*) ;; *) profiles=$profiles,calling-turn ;; esac
  fi
  put_env COMPOSE_PROFILES "$profiles" replace
  put_env OPENSEND_CALLING_DOMAIN "$calling_domain"
  put_env JANUS_PUBLIC_IP "$calling_ip"
  put_env FREESWITCH_PUBLIC_IP "$calling_ip"
  put_env CALLING_WSS_PORT "$wss_port"
  put_env JANUS_RTP_RANGE "$janus_range"
  put_env FREESWITCH_RTP_RANGE "$fs_range"
  [ -z "$cert_dir" ] || put_env FREESWITCH_CERT_DIR "$cert_dir"
  put_env CALL_GATEWAY_URL http://call-gateway:8090
  put_env CALL_GATEWAY_CONVEX_HTTP_URL http://convex:3211
  put_env CALL_AGENT_WSS_URL "wss://$calling_domain:$wss_port"
  secret_keys="CALL_GATEWAY_SECRET JANUS_API_SECRET FREESWITCH_ESL_SECRET FREESWITCH_SIP_SECRET FREESWITCH_DIRECTORY_SECRET DRACHTIO_SECRET VOICE_AGENT_SECRET"
  if [ "$turn" = yes ]; then
    put_env CALL_TURN_PUBLIC_IP "$calling_ip"
    put_env CALL_TURN_PORT "$turn_port"
    put_env CALL_TURN_TLS_PORT "$turn_tls_port"
    put_env CALL_TURN_RELAY_RANGE "$turn_range"
    put_env CALL_TURN_URLS "turn:$calling_domain:$turn_port?transport=udp,turn:$calling_domain:$turn_port?transport=tcp"
    if [ -z "$(get_env CALL_TURN_SECRET 2>/dev/null || true)" ]; then
      put_env CALL_TURN_SECRET "$(random_secret)" replace
    fi
    # Retire the unused long-term browser password on older installations.
    if has_env CALL_TURN_PASSWORD; then
      awk 'index($0, "CALL_TURN_PASSWORD=") != 1 { print }' "$env_file" > "$env_file.tmp"
      mv "$env_file.tmp" "$env_file"
    fi
  fi
  for key in $secret_keys; do
    if ! has_env "$key"; then put_env "$key" "$(random_secret)"; fi
  done
fi

# Saved values are authoritative after the caller's overrides are persisted.
clear_compose_env
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
  # Gate application/media startup on the one-shot deployment result.
  if [ "$convex_mode" = self ]; then compose up -d --wait --no-build convex || return 1; fi
  compose rm -f migrate || return 1
  compose up --no-build --no-deps --exit-code-from migrate migrate || return 1
  if [ "$command" = upgrade ]; then
    compose run --rm --no-deps -T migrate run migrations:backfillCounts || return 1
  fi
  if [ "$calling" = yes ]; then
    compose up -d --wait --no-build --no-deps janus freeswitch drachtio voice-agent || return 1
    compose up -d --wait --no-build --no-deps call-gateway || return 1
  fi
  compose up -d --wait --no-build --no-deps app || return 1
  # Do not start the completed migrate container again during the final up.
  services=$(compose config --services | awk '$0 != "migrate" { print }') || return 1
  [ -n "$services" ] || return 1
  compose up -d --wait --no-build --no-deps $services || return 1
}
if [ "$no_start" != 1 ] && ! start; then
  say "Startup failed. Inspect: cd '$dir' && docker compose logs migrate app" >&2
  exit 1
fi
say "Opensend configuration is ready in $dir"
if [ "$calling" = yes ]; then
  say "Calling WSS endpoint: $(get_env CALL_AGENT_WSS_URL) (trusted wss.pem required)."
  say "Calling firewall: TCP $wss_port; UDP $janus_range and $fs_range. Keep media ports mapped 1:1."
  if [ "$turn" = yes ]; then
    say "TURN firewall: TCP/UDP $turn_port; UDP $turn_range."
    say 'Browser agents receive short-lived relay credentials. See docs/browser-softphone.md.'
  fi
fi
say 'For Meta channels, finish the public callback and Meta app steps in the installation wizard.'
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
