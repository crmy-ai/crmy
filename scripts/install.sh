#!/usr/bin/env bash
# Copyright 2026 CRMy Contributors
# SPDX-License-Identifier: Apache-2.0
#
# Friendly local installer for CRMy.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/crmy-ai/crmy/main/scripts/install.sh | bash
#   ./scripts/install.sh --help

set -euo pipefail

PACKAGE_NAME="@crmy/cli"
PACKAGE_VERSION=""
DEFAULT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/crmy"
if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL_SOURCE="env"
else
  DATABASE_URL_SOURCE="default"
fi
DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
ADMIN_EMAIL="${CRMY_ADMIN_EMAIL:-admin@crmy.local}"
ADMIN_PASSWORD="${CRMY_ADMIN_PASSWORD:-}"
if [ -n "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD_SOURCE="provided"
else
  ADMIN_PASSWORD_SOURCE=""
fi
PASSWORD_WAS_GENERATED=false
INSTALL_DIR="${CRMY_INSTALL_DIR:-$HOME/.crmy}"
NPM_PREFIX="${CRMY_NPM_PREFIX:-$INSTALL_DIR/npm}"
LINK_DIR="${CRMY_LINK_DIR:-$HOME/.local/bin}"
WORK_DIR="${CRMY_WORK_DIR:-$INSTALL_DIR/local}"
INSTALL_SOURCE="${CRMY_INSTALL_SOURCE:-auto}"
REPO_URL="${CRMY_REPO_URL:-https://github.com/crmy-ai/crmy.git}"
REPO_REF="${CRMY_REPO_REF:-main}"
SOURCE_DIR="${CRMY_SOURCE_DIR:-$INSTALL_DIR/source/crmy}"
PORT="${PORT:-3000}"
DB_ROUTE="${CRMY_DB_ROUTE:-}"
DB_ROUTE_LABEL=""
AGENT_ENABLED="${CRMY_AGENT_ENABLED:-}"
AGENT_PROVIDER="${CRMY_AGENT_PROVIDER:-}"
AGENT_MODEL="${CRMY_AGENT_MODEL:-}"
AGENT_BASE_URL="${CRMY_AGENT_BASE_URL:-}"
if [ -n "$AGENT_BASE_URL" ]; then
  AGENT_BASE_URL_SOURCE="env"
else
  AGENT_BASE_URL_SOURCE="default"
fi
AGENT_API_KEY="${CRMY_AGENT_API_KEY:-}"
MODEL_ROUTE_LABEL=""
INSTALLER_METADATA_JSON=""

NO_DEMO=false
SKIP_POSTGRES=false
SKIP_CHECK=false
SKIP_QUICKSTART=false
SKIP_MODEL=false
START_SERVER=false
NON_INTERACTIVE=false
VERBOSE=false
DRY_RUN=false

RESET=""
BOLD=""
DIM=""
CYAN=""
GREEN=""
YELLOW=""
RED=""
ORANGE=""
CLEAR_LINE=""

usage() {
  cat <<'EOF'
CRMy installer

Installs the CRMy CLI into a user-owned prefix, prepares a local demo workspace,
and runs a setup health check.

Usage:
  install.sh [options]

Options:
  --version <version>       Install a specific @crmy/cli version
  --database-url <url>      PostgreSQL URL to use (default: local Docker PostgreSQL)
  --admin-email <email>     Admin email for the local workspace
  --admin-password <pass>   Admin password for the local workspace
  --db-route <route>        Database route: docker, url, or local
  --model-provider <id>     Configure Workspace Agent provider from the CRMy catalog
  --model <id>              Configure Workspace Agent model
  --model-base-url <url>    Provider base URL
  --model-api-key <key>     Provider API key
  --skip-model              Skip Workspace Agent model setup
  --install-dir <path>      Installer home (default: ~/.crmy)
  --install-source <mode>   auto, npm, or source (default: auto)
  --repo-ref <ref>          Git ref for --install-source source (default: main)
  --link-dir <path>         Directory for the crmy symlink (default: ~/.local/bin)
  --port <port>             Port shown/used for `crmy server` (default: 3000)
  --no-demo                 Initialize without demo data
  --skip-postgres           Do not start the helper Docker Postgres container
  --skip-check              Do not run `crmy doctor` after init
  --skip-quickstart         Do not run the connector-free quickstart proof after init
  --start-server            Start `crmy server` in the background without prompting
  --non-interactive         Avoid prompts; print next steps instead
  --verbose                 Show command output while installing
  --dry-run                 Print the planned commands without running them
  -h, --help                Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/crmy-ai/crmy/main/scripts/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/crmy-ai/crmy/main/scripts/install.sh | bash -s -- --database-url "$DATABASE_URL"
EOF
}

use_terminal_ui() {
  [ -t 1 ] && [ "${TERM:-}" != "dumb" ]
}

init_style() {
  if use_terminal_ui && [ -z "${NO_COLOR:-}" ]; then
    RESET="$(printf '\033[0m')"
    BOLD="$(printf '\033[1m')"
    DIM="$(printf '\033[2m')"
    CYAN="$(printf '\033[36m')"
    GREEN="$(printf '\033[32m')"
    YELLOW="$(printf '\033[33m')"
    RED="$(printf '\033[31m')"
    ORANGE="$(printf '\033[38;5;208m')"
    CLEAR_LINE="$(printf '\033[K')"
  fi
}

print_banner() {
  use_terminal_ui || return 0
  printf '\n'
  printf '%s' "$ORANGE"
  cat <<'EOF'
    ______ ____  __  ___
   / ____// __ \/  |/  /__  __
  / /    / /_/ / /|_/ / / / /
 / /___ / _, _/ /  / / /_/ /
 \____//_/ |_/_/  /_/\__, /
                     /____/
EOF
  printf '%s' "$RESET"
  printf '\n%sMessy customer interactions in. Governed agent context out.%s\n' "$DIM" "$RESET"
  printf '%sflow:%s source -> signals -> memory -> briefing -> action\n\n' "$DIM" "$RESET"
}

print_boot_sequence() {
  use_terminal_ui || return 0

  local steps=(
    "source intake"
    "signal checks"
    "memory layer"
    "agent handoff"
  )
  local i=0

  printf '%sWarming up the context engine%s\n' "$DIM" "$RESET"
  for label in "${steps[@]}"; do
    printf '  %s[%s]%s %s\n' "$CYAN" "$((i + 1))" "$RESET" "$label"
    i=$((i + 1))
    sleep 0.08
  done
  printf '\n'
}

step() {
  printf '%s==>%s %s\n' "$CYAN" "$RESET" "$1"
}

ok() {
  printf '%sok%s  %s\n' "$GREEN" "$RESET" "$1"
}

warn() {
  printf '%swarn%s %s\n' "$YELLOW" "$RESET" "$1" >&2
}

fail() {
  printf '%serror%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

print_dry_run_command() {
  local arg
  local shown
  printf '  '
  for arg in "$@"; do
    case "$arg" in
      DATABASE_URL=*|CRMY_ADMIN_PASSWORD=*|CRMY_AGENT_API_KEY=*)
        shown="${arg%%=*}=<hidden>"
        printf '%s ' "$shown"
        ;;
      *)
        shown="$arg"
        printf '%q ' "$shown"
        ;;
    esac
  done
  printf '\n'
}

can_prompt() {
  [ "$NON_INTERACTIVE" != true ] && [ -r /dev/tty ] && [ -w /dev/tty ]
}

menu_line() {
  if can_prompt; then
    printf '%s\n' "$1" >/dev/tty
  else
    printf '%s\n' "$1" >&2
  fi
}

section() {
  printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"
  printf '%s%s%s\n' "$CYAN" "----------------------------------------" "$RESET"
}

run_logged() {
  local label="$1"
  shift
  step "$label"

  if [ "$DRY_RUN" = true ]; then
    print_dry_run_command "$@"
    return 0
  fi

  if [ "$VERBOSE" = true ]; then
    "$@"
    ok "$label"
    return 0
  fi

  local log_file
  log_file="$(mktemp "${TMPDIR:-/tmp}/crmy-installer.XXXXXX.log")"
  if use_terminal_ui; then
    "$@" >"$log_file" 2>&1 &
    local pid=$!
    local frames='.-+*'
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s%s%s %s ...' "$CYAN" "${frames:$i:1}" "$RESET" "$label"
      i=$(( (i + 1) % 4 ))
      sleep 0.12
    done
    printf '\r%s' "$CLEAR_LINE"
    if wait "$pid"; then
      rm -f "$log_file"
      ok "$label"
    else
      warn "$label failed"
      sed 's/^/  /' "$log_file" >&2 || true
      rm -f "$log_file"
      exit 1
    fi
    return 0
  fi

  if "$@" >"$log_file" 2>&1; then
    rm -f "$log_file"
    ok "$label"
  else
    warn "$label failed"
    sed 's/^/  /' "$log_file" >&2 || true
    rm -f "$log_file"
    exit 1
  fi
}

run_visible() {
  local label="$1"
  shift
  step "$label"

  if [ "$DRY_RUN" = true ]; then
    print_dry_run_command "$@"
    return 0
  fi

  "$@"
}

prompt_yes_no() {
  local question="$1"
  local default_answer="${2:-yes}"
  local suffix="[Y/n]"
  local answer=""

  if [ "$default_answer" != "yes" ]; then
    suffix="[y/N]"
  fi

  if [ "$NON_INTERACTIVE" = true ]; then
    [ "$default_answer" = "yes" ]
    return $?
  fi

  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    printf '%s %s ' "$question" "$suffix" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
  else
    [ "$default_answer" = "yes" ]
    return $?
  fi

  case "$answer" in
    "") [ "$default_answer" = "yes" ] ;;
    [yY]|[yY][eE][sS]) true ;;
    *) false ;;
  esac
}

prompt_input() {
  local question="$1"
  local default_value="${2:-}"
  local answer=""

  if ! can_prompt; then
    printf '%s' "$default_value"
    return 0
  fi

  if [ -n "$default_value" ]; then
    printf '%s [%s]: ' "$question" "$default_value" >/dev/tty
  else
    printf '%s: ' "$question" >/dev/tty
  fi
  IFS= read -r answer </dev/tty || answer=""
  if [ -z "$answer" ]; then
    answer="$default_value"
  fi
  printf '%s' "$answer"
}

prompt_secret() {
  local question="$1"
  local required="${2:-false}"
  local answer=""

  if ! can_prompt; then
    printf '%s' ""
    return 0
  fi

  while :; do
    printf '%s: ' "$question" >/dev/tty
    stty -echo </dev/tty 2>/dev/null || true
    IFS= read -r answer </dev/tty || answer=""
    stty echo </dev/tty 2>/dev/null || true
    printf '\n' >/dev/tty

    if [ "$required" != true ] || [ -n "$answer" ]; then
      printf '%s' "$answer"
      return 0
    fi
    printf 'A value is required.\n' >/dev/tty
  done
}

prompt_required() {
  local question="$1"
  local example="${2:-}"
  local answer=""

  if ! can_prompt; then
    printf '%s' ""
    return 0
  fi

  while :; do
    if [ -n "$example" ]; then
      printf '%s (example: %s): ' "$question" "$example" >/dev/tty
    else
      printf '%s: ' "$question" >/dev/tty
    fi
    IFS= read -r answer </dev/tty || answer=""
    if [ -n "$answer" ]; then
      printf '%s' "$answer"
      return 0
    fi
    printf 'Enter a value to continue.\n' >/dev/tty
  done
}

prompt_number() {
  local question="$1"
  local default_value="$2"
  local max_value="$3"
  local answer=""

  if ! can_prompt; then
    printf '%s' "$default_value"
    return 0
  fi

  while :; do
    printf '%s [%s]: ' "$question" "$default_value" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
    answer="${answer:-$default_value}"
    case "$answer" in
      ''|*[!0-9]*) printf 'Choose a number between 1 and %s.\n' "$max_value" >/dev/tty ;;
      *)
        if [ "$answer" -ge 1 ] && [ "$answer" -le "$max_value" ]; then
          printf '%s' "$answer"
          return 0
        fi
        printf 'Choose a number between 1 and %s.\n' "$max_value" >/dev/tty
        ;;
    esac
  done
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        [ "$#" -ge 2 ] || fail "--version needs a value"
        PACKAGE_VERSION="$2"
        shift 2
        ;;
      --database-url)
        [ "$#" -ge 2 ] || fail "--database-url needs a value"
        DATABASE_URL="$2"
        DATABASE_URL_SOURCE="cli"
        shift 2
        ;;
      --admin-email)
        [ "$#" -ge 2 ] || fail "--admin-email needs a value"
        ADMIN_EMAIL="$2"
        shift 2
        ;;
      --admin-password)
        [ "$#" -ge 2 ] || fail "--admin-password needs a value"
        ADMIN_PASSWORD="$2"
        ADMIN_PASSWORD_SOURCE="provided"
        shift 2
        ;;
      --db-route)
        [ "$#" -ge 2 ] || fail "--db-route needs a value"
        DB_ROUTE="$2"
        shift 2
        ;;
      --model-provider)
        [ "$#" -ge 2 ] || fail "--model-provider needs a value"
        AGENT_PROVIDER="$2"
        shift 2
        ;;
      --model)
        [ "$#" -ge 2 ] || fail "--model needs a value"
        AGENT_MODEL="$2"
        shift 2
        ;;
      --model-base-url)
        [ "$#" -ge 2 ] || fail "--model-base-url needs a value"
        AGENT_BASE_URL="$2"
        AGENT_BASE_URL_SOURCE="cli"
        shift 2
        ;;
      --model-api-key)
        [ "$#" -ge 2 ] || fail "--model-api-key needs a value"
        AGENT_API_KEY="$2"
        shift 2
        ;;
      --skip-model)
        SKIP_MODEL=true
        AGENT_ENABLED=false
        shift
        ;;
      --install-dir)
        [ "$#" -ge 2 ] || fail "--install-dir needs a value"
        INSTALL_DIR="$2"
        NPM_PREFIX="$INSTALL_DIR/npm"
        WORK_DIR="$INSTALL_DIR/local"
        SOURCE_DIR="$INSTALL_DIR/source/crmy"
        shift 2
        ;;
      --install-source)
        [ "$#" -ge 2 ] || fail "--install-source needs a value"
        INSTALL_SOURCE="$2"
        shift 2
        ;;
      --repo-ref)
        [ "$#" -ge 2 ] || fail "--repo-ref needs a value"
        REPO_REF="$2"
        shift 2
        ;;
      --link-dir)
        [ "$#" -ge 2 ] || fail "--link-dir needs a value"
        LINK_DIR="$2"
        shift 2
        ;;
      --port)
        [ "$#" -ge 2 ] || fail "--port needs a value"
        PORT="$2"
        shift 2
        ;;
      --no-demo)
        NO_DEMO=true
        shift
        ;;
      --skip-postgres)
        SKIP_POSTGRES=true
        shift
        ;;
      --skip-check)
        SKIP_CHECK=true
        shift
        ;;
      --skip-quickstart)
        SKIP_QUICKSTART=true
        shift
        ;;
      --start-server)
        START_SERVER=true
        shift
        ;;
      --non-interactive)
        NON_INTERACTIVE=true
        shift
        ;;
      --verbose)
        VERBOSE=true
        shift
        ;;
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done
}

check_platform() {
  case "$(uname -s)" in
    Darwin*|Linux*) ;;
    CYGWIN*|MINGW*|MSYS*)
      fail "Native Windows is not supported by this shell installer. Use: npm install -g @crmy/cli"
      ;;
    *)
      warn "Unknown OS; continuing with the POSIX installer path"
      ;;
  esac
}

node_install_hint() {
  case "$(uname -s)" in
    Darwin*)
      if have_cmd brew; then
        printf 'Install it with: brew install node\n'
      else
        printf 'Install Node.js LTS from https://nodejs.org/\n'
      fi
      ;;
    Linux*)
      printf 'Install Node.js 20+ from https://nodejs.org/ or your distro package manager.\n'
      ;;
    *)
      printf 'Install Node.js 20+ from https://nodejs.org/\n'
      ;;
  esac
}

check_node() {
  step "Checking Node.js and npm"
  if ! have_cmd node; then
    node_install_hint >&2
    fail "Node.js 20 or newer is required."
  fi
  if ! have_cmd npm; then
    fail "npm is required with Node.js. Reinstall Node.js LTS, then rerun this installer."
  fi

  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
  if [ "$major" -lt 20 ]; then
    node --version >&2 || true
    node_install_hint >&2
    fail "CRMy requires Node.js 20 or newer."
  fi

  ok "Node.js $(node --version) and npm $(npm --version) are available"
}

apply_db_route() {
  case "$1" in
    docker)
      DATABASE_URL="$DEFAULT_DATABASE_URL"
      SKIP_POSTGRES=false
      DB_ROUTE_LABEL="Local Docker PostgreSQL"
      ;;
    url)
      if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL_SOURCE" = "default" ]; then
        DATABASE_URL="$(prompt_input "PostgreSQL connection string" "$DEFAULT_DATABASE_URL")"
      fi
      SKIP_POSTGRES=true
      DB_ROUTE_LABEL="Existing PostgreSQL URL"
      ;;
    local)
      DATABASE_URL="$DEFAULT_DATABASE_URL"
      SKIP_POSTGRES=true
      DB_ROUTE_LABEL="Already-running local PostgreSQL"
      ;;
    *)
      fail "Unknown database route '$1'. Use docker, url, or local."
      ;;
  esac
}

configure_database_route() {
  if [ -n "$DB_ROUTE" ]; then
    apply_db_route "$DB_ROUTE"
    ok "Database route: $DB_ROUTE_LABEL"
    return 0
  fi

  if [ "$DATABASE_URL_SOURCE" = "cli" ]; then
    apply_db_route "url"
    ok "Database route: $DB_ROUTE_LABEL"
    return 0
  fi

  if ! can_prompt; then
    if [ "$DATABASE_URL_SOURCE" = "env" ] && [ "$DATABASE_URL" != "$DEFAULT_DATABASE_URL" ]; then
      apply_db_route "url"
    elif [ "$SKIP_POSTGRES" = true ]; then
      apply_db_route "local"
    else
      apply_db_route "docker"
    fi
    ok "Database route: $DB_ROUTE_LABEL"
    return 0
  fi

  local local_postgres_detected=false
  if localhost_5432_looks_like_postgres; then
    local_postgres_detected=true
  fi

  section "Database"
  printf 'CRMy stores customer context, Memory, Signals, audit history, and demo data in PostgreSQL.\n\n'

  local choice
  if [ "$DATABASE_URL_SOURCE" = "env" ] && [ "$DATABASE_URL" != "$DEFAULT_DATABASE_URL" ]; then
    printf '  1) Use DATABASE_URL from your environment (recommended)\n'
    printf '     %s\n' "$DATABASE_URL"
    printf '  2) Start local Docker PostgreSQL - clean demo DB\n'
    printf '  3) Enter another PostgreSQL URL - Supabase, Neon, or your DB\n'
    if [ "$local_postgres_detected" = true ]; then
      printf '  4) Use detected local Postgres on localhost:5432 - no container\n'
      choice="$(prompt_number "Database route" "1" "4")"
    else
      choice="$(prompt_number "Database route" "1" "3")"
    fi
    case "$choice" in
      1) apply_db_route "url" ;;
      2) apply_db_route "docker" ;;
      3)
        DATABASE_URL_SOURCE="prompt"
        DATABASE_URL=""
        apply_db_route "url"
        ;;
      4) apply_db_route "local" ;;
    esac
  else
    printf '  1) Start local Docker PostgreSQL - fastest demo path\n'
    printf '  2) Use existing or managed PostgreSQL - Supabase, Neon, or your DB\n'
    if [ "$local_postgres_detected" = true ]; then
      printf '  3) Use detected local Postgres on localhost:5432 - no container\n'
      choice="$(prompt_number "Database route" "1" "3")"
    else
      printf '  %sNo local Postgres detected on localhost:5432.%s\n' "$DIM" "$RESET"
      choice="$(prompt_number "Database route" "1" "2")"
    fi
    case "$choice" in
      1) apply_db_route "docker" ;;
      2)
        DATABASE_URL_SOURCE="prompt"
        DATABASE_URL=""
        apply_db_route "url"
        ;;
      3) apply_db_route "local" ;;
    esac
  fi

  ok "Database route: $DB_ROUTE_LABEL"
}

load_installer_metadata() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  [ -n "${CRMY_BIN:-}" ] || fail "CRMy CLI must be installed before loading the model catalog."

  INSTALLER_METADATA_JSON="$("$CRMY_BIN" _installer-metadata --json 2>/dev/null || true)"
  if [ -z "$INSTALLER_METADATA_JSON" ]; then
    fail "Installed CRMy CLI does not expose installer metadata. Rerun with --install-source source or update @crmy/cli."
  fi
}

catalog_query() {
  local provider="${1:-}"
  local field="${2:-}"
  local index="${3:-}"

  [ -n "$INSTALLER_METADATA_JSON" ] || return 1

  CRMY_INSTALLER_METADATA_JSON="$INSTALLER_METADATA_JSON" \
  CRMY_PROVIDER_ID="$provider" \
  CRMY_CATALOG_FIELD="$field" \
  CRMY_CATALOG_INDEX="$index" \
  CRMY_AGENT_BASE_URL="$AGENT_BASE_URL" \
  CRMY_AGENT_MODEL="$AGENT_MODEL" \
  node <<'NODE'
const meta = JSON.parse(process.env.CRMY_INSTALLER_METADATA_JSON || '{}');
const providers = Array.isArray(meta.providers) ? meta.providers : [];
const precertified = Array.isArray(meta.precertified_models) ? meta.precertified_models : [];
const providerId = process.env.CRMY_PROVIDER_ID || '';
const field = process.env.CRMY_CATALOG_FIELD || '';
const index = Number(process.env.CRMY_CATALOG_INDEX || '0');
const provider = providers.find((item) => item && item.id === providerId);

function write(value) {
  if (value !== undefined && value !== null) process.stdout.write(String(value));
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizedProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedModel(value) {
  return String(value || '').trim();
}

switch (field) {
  case 'provider_count':
    write(providers.length);
    break;
  case 'provider_id_by_index':
    write(providers[index]?.id || '');
    break;
  case 'provider_label_by_index':
    write(providers[index]?.label || '');
    break;
  case 'label':
    write(provider?.label || providerId);
    break;
  case 'default_base_url':
    write(provider?.baseUrl || '');
    break;
  case 'default_model':
    write(provider?.models?.[0]?.id || '');
    break;
  case 'model_label':
    write(provider?.modelLabel || 'Model ID');
    break;
  case 'model_placeholder':
    write(provider?.modelPlaceholder || provider?.models?.[0]?.id || '');
    break;
  case 'needs_custom_base_url':
    process.exit(provider?.needsCustomBaseUrl ? 0 : 1);
    break;
  case 'model_count':
    write(provider?.models?.length || 0);
    break;
  case 'model_option': {
    const model = provider?.models?.[index - 1];
    if (!model) break;
    const description = model.description ? ` - ${String(model.description).replace(/\.$/, '')}` : '';
    write(`${model.id}|${model.label}${description}`);
    break;
  }
  case 'model_ids':
    write((provider?.models || []).map((model) => model.id).join('\n'));
    break;
  case 'requires_key':
    process.exit(provider?.requiresKey ? 0 : 1);
    break;
  case 'key_label':
    write(provider?.keyLabel || 'API key');
    break;
  case 'is_provider':
    process.exit(provider ? 0 : 1);
    break;
  case 'is_precertified': {
    const baseUrl = normalizedBaseUrl(process.env.CRMY_AGENT_BASE_URL || '');
    const model = normalizedModel(process.env.CRMY_AGENT_MODEL || '');
    const match = precertified.find((entry) =>
      normalizedProvider(entry.provider) === normalizedProvider(providerId)
      && normalizedBaseUrl(entry.base_url) === baseUrl
      && normalizedModel(entry.model) === model
    );
    process.exit(match ? 0 : 1);
    break;
  }
  default:
    process.exit(1);
}
NODE
}

provider_label() {
  catalog_query "$1" label || printf '%s' "$1"
}

provider_default_base_url() {
  catalog_query "$1" default_base_url || printf ''
}

provider_default_model() {
  catalog_query "$1" default_model || printf ''
}

provider_model_label() {
  catalog_query "$1" model_label || printf 'Model ID'
}

provider_model_placeholder() {
  catalog_query "$1" model_placeholder || printf ''
}

provider_needs_custom_base_url() {
  catalog_query "$1" needs_custom_base_url >/dev/null 2>&1
}

provider_model_count() {
  catalog_query "$1" model_count || printf '0'
}

provider_model_option() {
  catalog_query "$1" model_option "$2" || printf ''
}

provider_model_ids() {
  catalog_query "$1" model_ids || printf ''
}

provider_requires_key() {
  catalog_query "$1" requires_key >/dev/null 2>&1
}

provider_key_label() {
  catalog_query "$1" key_label || printf 'API key'
}

model_is_precertified() {
  catalog_query "$AGENT_PROVIDER" is_precertified >/dev/null 2>&1
}

print_model_certification_hint() {
  if [ "$AGENT_ENABLED" != true ]; then
    return 0
  fi

  if model_is_precertified; then
    ok "Automatic Memory: enabled by CRMy-published model certification"
  else
    warn "Automatic Memory: review-only until this model passes 'crmy certify --output ./eval-runs'"
  fi
}

validate_provider() {
  catalog_query "$1" is_provider >/dev/null 2>&1
}

detect_ollama_model() {
  local base_url="${1:-http://localhost:11434/v1}"
  local tags_base="${base_url%/}"
  tags_base="${tags_base%/v1}"
  local tags_url="${tags_base}/api/tags"
  local preferred_models
  preferred_models="$(provider_model_ids "ollama")"

  OLLAMA_TAGS_URL="$tags_url" OLLAMA_PREFERRED_MODELS="$preferred_models" node <<'NODE' 2>/dev/null || true
(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);
  try {
    const res = await fetch(process.env.OLLAMA_TAGS_URL, { signal: controller.signal });
    if (!res.ok) process.exit(0);
    const json = await res.json();
    const models = (json.models || [])
      .map((model) => model && model.name)
      .filter(Boolean)
      .sort();
    const preferred = (process.env.OLLAMA_PREFERRED_MODELS || '').split('\n').filter(Boolean);
    console.log(preferred.find((model) => models.includes(model)) || models[0] || '');
  } catch {
    process.exit(0);
  } finally {
    clearTimeout(timer);
  }
})();
NODE
}

choose_provider_from_menu() {
  menu_line '  1) Skip model setup for now - demo still works'

  local count
  count="$(catalog_query "" provider_count || printf '0')"
  [ "$count" -gt 0 ] || fail "Workspace Agent provider catalog is empty."

  local i
  local label
  for i in $(seq 0 "$((count - 1))"); do
    label="$(catalog_query "" provider_label_by_index "$i")"
    menu_line "$(printf ' %2d) %s' "$((i + 2))" "$label")"
  done

  local choice
  choice="$(prompt_number "Model provider" "1" "$((count + 1))")"
  if [ "$choice" -eq 1 ]; then
    printf 'skip'
    return 0
  fi
  catalog_query "" provider_id_by_index "$((choice - 2))"
}

choose_model_from_menu() {
  local provider="$1"
  local detected="${2:-}"
  local count
  count="$(provider_model_count "$provider")"

  if [ -n "$detected" ]; then
    printf '%s' "$detected"
    return 0
  fi

  if [ "$count" -eq 0 ]; then
    prompt_required "$(provider_model_label "$provider")" "$(provider_model_placeholder "$provider")"
    return 0
  fi

  local i
  local option
  local model_id
  local label
  for i in $(seq 1 "$count"); do
    option="$(provider_model_option "$provider" "$i")"
    model_id="${option%%|*}"
    label="${option#*|}"
    menu_line "  $i) $label"
    menu_line "     $model_id"
  done
  menu_line "  $((count + 1))) Custom $(provider_model_label "$provider")"

  local choice
  choice="$(prompt_number "$(provider_model_label "$provider")" "1" "$((count + 1))")"
  if [ "$choice" -le "$count" ]; then
    option="$(provider_model_option "$provider" "$choice")"
    printf '%s' "${option%%|*}"
  else
    prompt_required "$(provider_model_label "$provider")" "$(provider_model_placeholder "$provider")"
  fi
}

configure_model_route() {
  if [ "$SKIP_MODEL" = true ] || [ "$AGENT_ENABLED" = "false" ]; then
    AGENT_ENABLED=false
    MODEL_ROUTE_LABEL="Skipped"
    ok "Workspace Agent model: skipped"
    return 0
  fi

  if [ -z "$INSTALLER_METADATA_JSON" ]; then
    if [ "$DRY_RUN" = true ] && [ -z "$AGENT_PROVIDER$AGENT_MODEL$AGENT_BASE_URL" ]; then
      AGENT_ENABLED=false
      MODEL_ROUTE_LABEL="Skipped"
      ok "Workspace Agent model: skipped"
      return 0
    fi
    if [ "$DRY_RUN" = true ]; then
      [ -n "$AGENT_PROVIDER" ] || fail "Dry-run model setup needs --model-provider because the catalog is loaded after install."
      [ -n "$AGENT_MODEL" ] || fail "Dry-run model setup needs --model because the catalog is loaded after install."
      [ -n "$AGENT_BASE_URL" ] || fail "Dry-run model setup needs --model-base-url because the catalog is loaded after install."
      AGENT_ENABLED=true
      MODEL_ROUTE_LABEL="$AGENT_PROVIDER - $AGENT_MODEL"
      ok "Workspace Agent model: $MODEL_ROUTE_LABEL"
      warn "Dry-run: model catalog validation will run after the CRMy CLI is installed."
      return 0
    fi
    fail "Workspace Agent model catalog was not loaded."
  fi

  if [ -n "$AGENT_PROVIDER" ] || [ -n "$AGENT_MODEL" ] || [ -n "$AGENT_BASE_URL" ]; then
    AGENT_PROVIDER="${AGENT_PROVIDER:-custom}"
    validate_provider "$AGENT_PROVIDER" || fail "Unknown model provider '$AGENT_PROVIDER'."
    if [ -z "$AGENT_BASE_URL" ]; then
      if provider_needs_custom_base_url "$AGENT_PROVIDER"; then
        if can_prompt; then
          AGENT_BASE_URL="$(prompt_required "Base URL" "$(provider_default_base_url "$AGENT_PROVIDER")")"
        else
          fail "$(provider_label "$AGENT_PROVIDER") needs a real base URL. Pass --model-base-url."
        fi
      else
        AGENT_BASE_URL="$(provider_default_base_url "$AGENT_PROVIDER")"
      fi
    fi
    AGENT_MODEL="${AGENT_MODEL:-$(provider_default_model "$AGENT_PROVIDER")}"
    if [ -z "$AGENT_BASE_URL" ]; then
      fail "A base URL is required when configuring provider '$AGENT_PROVIDER'."
    fi
    if provider_needs_custom_base_url "$AGENT_PROVIDER" && [ "$AGENT_BASE_URL_SOURCE" = "default" ]; then
      fail "$(provider_label "$AGENT_PROVIDER") needs a real base URL. Pass --model-base-url or enter one interactively."
    fi
    if [ -z "$AGENT_MODEL" ]; then
      if can_prompt; then
        AGENT_MODEL="$(prompt_required "$(provider_model_label "$AGENT_PROVIDER")" "$(provider_default_model "$AGENT_PROVIDER")")"
      else
        fail "A $(provider_model_label "$AGENT_PROVIDER") is required for $(provider_label "$AGENT_PROVIDER"). Pass --model."
      fi
    fi
    if [ -z "$AGENT_MODEL" ]; then
      fail "A $(provider_model_label "$AGENT_PROVIDER") is required when configuring $(provider_label "$AGENT_PROVIDER")."
    fi
    if provider_requires_key "$AGENT_PROVIDER" && [ -z "$AGENT_API_KEY" ]; then
      AGENT_API_KEY="$(prompt_secret "$(provider_key_label "$AGENT_PROVIDER")" true)"
      if [ -z "$AGENT_API_KEY" ]; then
        fail "$(provider_label "$AGENT_PROVIDER") requires an API key."
      fi
    fi
    AGENT_ENABLED=true
    MODEL_ROUTE_LABEL="$(provider_label "$AGENT_PROVIDER") - $AGENT_MODEL"
    ok "Workspace Agent model: $MODEL_ROUTE_LABEL"
    print_model_certification_hint
    return 0
  fi

  if ! can_prompt; then
    AGENT_ENABLED=false
    MODEL_ROUTE_LABEL="Skipped"
    ok "Workspace Agent model: skipped"
    return 0
  fi

  section "Workspace Agent Model"
  printf 'A model is only needed for live extraction from new notes/transcripts.\n'
  printf 'The demo workspace works without one.\n\n'

  AGENT_PROVIDER="$(choose_provider_from_menu)"
  if [ "$AGENT_PROVIDER" = "skip" ]; then
    AGENT_ENABLED=false
    MODEL_ROUTE_LABEL="Skipped"
    ok "Workspace Agent model: skipped"
    return 0
  fi

  local default_base
  default_base="$(provider_default_base_url "$AGENT_PROVIDER")"
  if provider_needs_custom_base_url "$AGENT_PROVIDER"; then
    AGENT_BASE_URL="$(prompt_required "Base URL" "$default_base")"
  else
    AGENT_BASE_URL="$(prompt_input "Base URL" "$default_base")"
  fi
  if [ -z "$AGENT_BASE_URL" ]; then
    fail "A base URL is required when configuring provider '$AGENT_PROVIDER'."
  fi

  local detected_model=""
  if [ "$AGENT_PROVIDER" = "ollama" ]; then
    detected_model="$(detect_ollama_model "$AGENT_BASE_URL")"
    if [ -n "$detected_model" ]; then
      ok "Detected Ollama model: $detected_model"
    else
      warn "Ollama model auto-detect did not find an installed model."
    fi
  fi

  AGENT_MODEL="$(choose_model_from_menu "$AGENT_PROVIDER" "$detected_model")"
  if [ -z "$AGENT_MODEL" ]; then
    fail "A $(provider_model_label "$AGENT_PROVIDER") is required when configuring $(provider_label "$AGENT_PROVIDER")."
  fi

  if provider_requires_key "$AGENT_PROVIDER"; then
    AGENT_API_KEY="$(prompt_secret "$(provider_key_label "$AGENT_PROVIDER")" true)"
  elif [ "$AGENT_PROVIDER" != "ollama" ]; then
    AGENT_API_KEY="$(prompt_secret "$(provider_key_label "$AGENT_PROVIDER")" false)"
  fi

  AGENT_ENABLED=true
  MODEL_ROUTE_LABEL="$(provider_label "$AGENT_PROVIDER") - $AGENT_MODEL"
  ok "Workspace Agent model: $MODEL_ROUTE_LABEL"
  print_model_certification_hint
}

configure_demo_data() {
  if [ "$NO_DEMO" = true ]; then
    ok "Demo data: skipped"
    return 0
  fi

  if ! can_prompt; then
    ok "Demo data: will load"
    return 0
  fi

  section "Demo Data"
  printf 'Demo data gives you sample customers, Memory, Signals, lineage, and test logins.\n\n'
  menu_line '  1) Load demo data - fastest path'
  menu_line '  2) Start empty - add your own records'

  local choice
  choice="$(prompt_number "Demo data" "1" "2")"
  case "$choice" in
    1)
      NO_DEMO=false
      ok "Demo data: will load"
      ;;
    2)
      NO_DEMO=true
      ok "Demo data: skipped"
      ;;
  esac
}

generate_password() {
  if [ -n "$ADMIN_PASSWORD" ]; then
    return 0
  fi

  if have_cmd openssl; then
    ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
  else
    ADMIN_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64'))")"
  fi
  PASSWORD_WAS_GENERATED=true
  ADMIN_PASSWORD_SOURCE="generated"
}

path_contains() {
  local dir="$1"
  case ":$PATH:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

pick_profile() {
  case "${SHELL:-}" in
    */zsh) printf '%s/.zshrc\n' "$HOME" ;;
    */bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        printf '%s/.bash_profile\n' "$HOME"
      else
        printf '%s/.bashrc\n' "$HOME"
      fi
      ;;
    *) printf '%s/.profile\n' "$HOME" ;;
  esac
}

cli_lists_command() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  [ -n "${CRMY_BIN:-}" ] || return 1

  local help
  help="$("$CRMY_BIN" --help 2>/dev/null || true)"
  printf '%s\n' "$help" | grep -Eq "^[[:space:]]+$1([[:space:]]|$)"
}

cli_lists_server_subcommand() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  [ -n "${CRMY_BIN:-}" ] || return 1

  local help
  help="$("$CRMY_BIN" server --help 2>/dev/null || true)"
  printf '%s\n' "$help" | grep -Eq "^[[:space:]]+$1([[:space:]]|$)"
}

cli_supports_installer_metadata() {
  if [ "$DRY_RUN" = true ]; then
    return 0
  fi
  [ -n "${CRMY_BIN:-}" ] || return 1
  "$CRMY_BIN" _installer-metadata --json >/dev/null 2>&1
}

install_cli_from_npm() {
  local target="$PACKAGE_NAME"
  if [ -n "$PACKAGE_VERSION" ]; then
    target="${PACKAGE_NAME}@${PACKAGE_VERSION}"
  fi

  if [ "$DRY_RUN" = true ]; then
    run_logged "Installing CRMy CLI into $NPM_PREFIX" npm install -g --prefix "$NPM_PREFIX" "$target"
    CRMY_BIN="$NPM_PREFIX/bin/crmy"
    printf '  Would link %s to %s/crmy\n' "$CRMY_BIN" "$LINK_DIR"
    return 0
  fi

  mkdir -p "$NPM_PREFIX"
  run_logged "Installing CRMy CLI into $NPM_PREFIX" npm install -g --prefix "$NPM_PREFIX" "$target"

  local crmy_bin="$NPM_PREFIX/bin/crmy"
  [ -x "$crmy_bin" ] || fail "CRMy installed, but $crmy_bin was not created."

  mkdir -p "$LINK_DIR"
  ln -sf "$crmy_bin" "$LINK_DIR/crmy"
  ok "Linked crmy command at $LINK_DIR/crmy"

  CRMY_BIN="$crmy_bin"
}

install_cli_from_source() {
  if ! have_cmd git; then
    fail "Git is required to build CRMy from source. Install git or rerun with --install-source npm."
  fi

  if [ "$DRY_RUN" = true ]; then
    run_logged "Fetching latest CRMy source" git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$SOURCE_DIR"
    run_logged "Installing source dependencies" npm install
    run_logged "Building CRMy from source" npm run build
    CRMY_BIN="$NPM_PREFIX/bin/crmy"
    printf '  Would create source wrapper at %s\n' "$CRMY_BIN"
    printf '  Would link %s to %s/crmy\n' "$CRMY_BIN" "$LINK_DIR"
    return 0
  fi

  mkdir -p "$(dirname "$SOURCE_DIR")" "$NPM_PREFIX/bin" "$LINK_DIR"
  if [ -d "$SOURCE_DIR/.git" ]; then
    run_logged "Fetching latest CRMy source" git -C "$SOURCE_DIR" fetch --depth 1 origin "$REPO_REF"
    run_logged "Checking out CRMy $REPO_REF" git -C "$SOURCE_DIR" checkout FETCH_HEAD
  else
    run_logged "Cloning CRMy source" git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$SOURCE_DIR"
  fi

  (
    cd "$SOURCE_DIR"
    run_logged "Installing source dependencies" npm install
    run_logged "Building CRMy from source" npm run build
  )

  local source_entry="$SOURCE_DIR/packages/cli/dist/index.js"
  [ -f "$source_entry" ] || fail "Source build completed, but $source_entry was not found."

  local crmy_bin="$NPM_PREFIX/bin/crmy"
  cat > "$crmy_bin" <<EOF
#!/usr/bin/env bash
exec node "$source_entry" "\$@"
EOF
  chmod +x "$crmy_bin"
  ln -sf "$crmy_bin" "$LINK_DIR/crmy"
  ok "Linked source-built crmy command at $LINK_DIR/crmy"
  CRMY_BIN="$crmy_bin"
}

install_cli() {
  case "$INSTALL_SOURCE" in
    npm)
      install_cli_from_npm
      ;;
    source)
      install_cli_from_source
      ;;
    auto)
      install_cli_from_npm
      if ! cli_lists_command doctor || ! cli_lists_server_subcommand start || ! cli_supports_installer_metadata; then
        if [ -n "$PACKAGE_VERSION" ]; then
          fail "Requested $PACKAGE_NAME@$PACKAGE_VERSION is missing the latest setup commands. Rerun without --version, or use --install-source source --repo-ref <ref>."
        fi
        warn "Published @crmy/cli is missing the latest setup commands; building the latest CRMy source."
        install_cli_from_source
      fi
      ;;
    *)
      fail "Unknown install source '$INSTALL_SOURCE'. Use auto, npm, or source."
      ;;
  esac
}

maybe_add_path() {
  if path_contains "$LINK_DIR"; then
    ok "$LINK_DIR is already on PATH"
    return 0
  fi

  local profile
  profile="$(pick_profile)"
  warn "$LINK_DIR is not on PATH yet."

  if [ "$DRY_RUN" = true ]; then
    printf '  Would add export PATH="%s:$PATH" to %s\n' "$LINK_DIR" "$profile"
    return 0
  fi

  if [ "$NON_INTERACTIVE" = true ] || ! { [ -r /dev/tty ] && [ -w /dev/tty ]; }; then
    warn "Add it with: export PATH=\"$LINK_DIR:\$PATH\""
    return 0
  fi

  if prompt_yes_no "Add $LINK_DIR to PATH in $profile?" "yes"; then
    mkdir -p "$(dirname "$profile")"
    {
      printf '\n# >>> CRMy installer >>>\n'
      printf 'export PATH="%s:$PATH"\n' "$LINK_DIR"
      printf '# <<< CRMy installer <<<\n'
    } >> "$profile"
    ok "Added $LINK_DIR to PATH in $profile"
  else
    warn "Skipping PATH update. You can run CRMy with: $LINK_DIR/crmy"
  fi
}

database_uses_default_local() {
  [ "$DATABASE_URL" = "$DEFAULT_DATABASE_URL" ]
}

port_5432_accepts_tcp() {
  node <<'NODE'
const net = require('net');
const socket = net.createConnection({ host: '127.0.0.1', port: 5432 });
const timer = setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 500);
socket.once('connect', () => {
  clearTimeout(timer);
  socket.end();
  process.exit(0);
});
socket.once('error', () => {
  clearTimeout(timer);
  process.exit(1);
});
NODE
}

localhost_5432_looks_like_postgres() {
  node <<'NODE'
const net = require('net');
const socket = net.createConnection({ host: '127.0.0.1', port: 5432 });
let finished = false;
const timer = setTimeout(() => finish(1), 700);

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket.destroy();
  process.exit(code);
}

socket.once('connect', () => {
  const sslRequest = Buffer.alloc(8);
  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(80877103, 4);
  socket.write(sslRequest);
});
socket.once('data', (chunk) => {
  const firstByte = chunk[0];
  finish(firstByte === 83 || firstByte === 78 ? 0 : 1);
});
socket.once('error', () => finish(1));
socket.once('close', () => finish(1));
NODE
}

ensure_postgres() {
  if [ "$SKIP_POSTGRES" = true ]; then
    warn "Skipping helper Postgres startup"
    return 0
  fi

  if ! database_uses_default_local; then
    ok "Using provided DATABASE_URL"
    return 0
  fi

  if [ "$DRY_RUN" = true ]; then
    run_logged "Starting local PostgreSQL with Docker" \
      docker run --name crmy-postgres \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -e POSTGRES_DB=crmy \
        -p 5432:5432 \
        -d pgvector/pgvector:pg16
    return 0
  fi

  if localhost_5432_looks_like_postgres; then
    ok "Detected PostgreSQL on localhost:5432; using the default DATABASE_URL"
    return 0
  fi

  if port_5432_accepts_tcp; then
    fail "Port 5432 is in use, but it does not look like PostgreSQL. Stop that service or rerun with --database-url."
    return 0
  fi

  if ! have_cmd docker; then
    warn "Docker was not found. Start PostgreSQL yourself or rerun with --database-url."
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker is installed but not running. Start Docker Desktop, then rerun if init cannot connect."
    return 0
  fi

  if docker ps --format '{{.Names}}' | grep -qx 'crmy-postgres'; then
    ok "Docker Postgres container crmy-postgres is already running"
    return 0
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx 'crmy-postgres'; then
    run_logged "Starting existing Docker Postgres container" docker start crmy-postgres
  else
    run_logged "Starting local PostgreSQL with Docker" \
      docker run --name crmy-postgres \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -e POSTGRES_DB=crmy \
        -p 5432:5432 \
        -d pgvector/pgvector:pg16
  fi
}

init_workspace() {
  if [ "$DRY_RUN" != true ]; then
    mkdir -p "$WORK_DIR"
  fi
  generate_password

  local demo_arg="--demo"
  if [ "$NO_DEMO" = true ]; then
    demo_arg="--no-demo"
  fi

  local init_env=(
    "DATABASE_URL=$DATABASE_URL"
    "CRMY_SERVER_URL=http://localhost:$PORT"
    "CRMY_ADMIN_EMAIL=$ADMIN_EMAIL"
    "CRMY_ADMIN_PASSWORD=$ADMIN_PASSWORD"
  )

  if [ -n "$AGENT_ENABLED" ]; then
    init_env+=("CRMY_AGENT_ENABLED=$AGENT_ENABLED")
  fi
  if [ "$AGENT_ENABLED" = true ]; then
    init_env+=(
      "CRMY_AGENT_PROVIDER=$AGENT_PROVIDER"
      "CRMY_AGENT_MODEL=$AGENT_MODEL"
      "CRMY_AGENT_BASE_URL=$AGENT_BASE_URL"
    )
    if [ -n "$AGENT_API_KEY" ]; then
      init_env+=("CRMY_AGENT_API_KEY=$AGENT_API_KEY")
    fi
  fi

  run_logged "Initializing CRMy workspace" \
    env "${init_env[@]}" \
      "$CRMY_BIN" init --yes "$demo_arg"
}

run_setup_check() {
  if [ "$SKIP_CHECK" = true ]; then
    warn "Skipping setup health check"
    return 0
  fi

  if [ "$DRY_RUN" = true ]; then
    if [ "$AGENT_ENABLED" = false ]; then
      run_visible "Checking CRMy setup" "$CRMY_BIN" doctor --port "$PORT" --skip-model-check
    else
      run_visible "Checking CRMy setup" "$CRMY_BIN" doctor --port "$PORT"
    fi
    return 0
  fi

  if cli_lists_command doctor; then
    if [ "$AGENT_ENABLED" = false ]; then
      run_visible "Checking CRMy setup" "$CRMY_BIN" doctor --port "$PORT" --skip-model-check
    else
      run_visible "Checking CRMy setup" "$CRMY_BIN" doctor --port "$PORT"
    fi
    return 0
  fi

  warn "This @crmy/cli version does not include doctor. The workspace was initialized; run '$CRMY_BIN server start --port $PORT' to open CRMy."
}

run_quickstart_check() {
  if [ "$SKIP_QUICKSTART" = true ]; then
    warn "Skipping connector-free quickstart proof"
    return 0
  fi

  if [ "$NO_DEMO" = true ]; then
    warn "Skipping connector-free quickstart proof because demo data was not loaded"
    return 0
  fi

  if [ "$DRY_RUN" = true ]; then
    run_visible "Proving connector-free quickstart" "$CRMY_BIN" quickstart --no-seed
    return 0
  fi

  if cli_lists_command quickstart; then
    run_visible "Proving connector-free quickstart" "$CRMY_BIN" quickstart --no-seed
    return 0
  fi

  warn "This @crmy/cli version does not include quickstart. Run '$CRMY_BIN agent-smoke' after install to prove the demo path."
}

command_for_user() {
  if path_contains "$LINK_DIR"; then
    printf 'crmy'
  else
    printf '%s/crmy' "$LINK_DIR"
  fi
}

print_next_steps() {
  local crmy_cmd
  crmy_cmd="$(command_for_user)"

  printf '\n%s%sCRMy is ready.%s\n' "$ORANGE" "$BOLD" "$RESET"
  printf '%s----------------------------------------%s\n\n' "$DIM" "$RESET"
  printf '%sWeb UI%s\n' "$CYAN" "$RESET"
  printf '  %s server start --port %s\n' "$crmy_cmd" "$PORT"
  printf '  http://localhost:%s/app\n\n' "$PORT"
  printf '%sMCP for local agents%s\n' "$GREEN" "$RESET"
  printf '  claude mcp add crmy -- %s mcp\n' "$crmy_cmd"
  printf '  codex mcp add crmy -- %s mcp\n\n' "$crmy_cmd"
  printf '%sAdmin login%s\n' "$YELLOW" "$RESET"
  printf '  Email:    %s\n' "$ADMIN_EMAIL"
  if [ -n "$ADMIN_PASSWORD" ]; then
    if [ "$ADMIN_PASSWORD_SOURCE" = "generated" ]; then
      printf '  Password: %s%s%s %s(generated by installer)%s\n\n' "$YELLOW" "$ADMIN_PASSWORD" "$RESET" "$DIM" "$RESET"
    else
      printf '  Password: %s%s%s %s(provided by you)%s\n\n' "$YELLOW" "$ADMIN_PASSWORD" "$RESET" "$DIM" "$RESET"
    fi
  else
    printf '  Password: %snot available in this shell output%s\n\n' "$DIM" "$RESET"
  fi
  printf '%sDatabase%s\n' "$CYAN" "$RESET"
  printf '  %s\n\n' "${DB_ROUTE_LABEL:-Configured}"
  printf '%sWorkspace Agent model%s\n' "$GREEN" "$RESET"
  printf '  %s\n\n' "${MODEL_ROUTE_LABEL:-Skipped}"
  printf '%sDemo data%s\n' "$ORANGE" "$RESET"
  if [ "$NO_DEMO" = true ]; then
    printf '  Skipped. Load sample customers and demo logins later with: %s seed-demo\n\n' "$crmy_cmd"
  else
    printf '  Loaded: sample customers, Memory, Signals, and lineage.\n'
    printf '  Demo logins: sample.admin@crmy.local / crmy-demo-123\n'
    printf '               sample.rep@crmy.local / crmy-demo-123\n\n'
  fi
  printf '%sNow get your agents selling - with context they can trust.%s\n\n' "$GREEN" "$RESET"
}

start_server_background() {
  if [ "$DRY_RUN" = true ]; then
    run_visible "Starting CRMy server in the background" "$CRMY_BIN" server start --port "$PORT"
    return 0
  fi

  if cli_lists_server_subcommand start; then
    "$CRMY_BIN" server start --port "$PORT"
    return 0
  fi

  warn "This CRMy CLI does not support background server management yet."
  warn "Start it manually with: $CRMY_BIN server --port $PORT"
}

maybe_start_server() {
  if [ "$START_SERVER" = true ]; then
    start_server_background
    return 0
  fi

  if [ "$DRY_RUN" = true ]; then
    return 0
  fi

  if [ "$NON_INTERACTIVE" = true ] || ! { [ -r /dev/tty ] && [ -w /dev/tty ]; }; then
    return 0
  fi

  printf '\nStart CRMy now?\n' >/dev/tty
  printf '  1) Start in background - recommended\n' >/dev/tty
  printf '  2) Start in foreground - show logs here\n' >/dev/tty
  printf '  3) Not now\n' >/dev/tty

  local choice
  choice="$(prompt_number "Server start" "1" "3")"
  case "$choice" in
    1) start_server_background ;;
    2) exec "$CRMY_BIN" server --port "$PORT" ;;
    3) ;;
  esac
}

main() {
  init_style
  parse_args "$@"
  print_banner
  print_boot_sequence
  check_platform
  check_node
  configure_database_route
  install_cli
  load_installer_metadata
  maybe_add_path
  configure_model_route
  configure_demo_data
  ensure_postgres
  if [ "$DRY_RUN" = true ]; then
    step "Using workspace directory $WORK_DIR"
    init_workspace
    run_setup_check
    run_quickstart_check
  else
    mkdir -p "$WORK_DIR"
    (
      cd "$WORK_DIR"
      init_workspace
      run_setup_check
      run_quickstart_check
    )
  fi
  print_next_steps
  maybe_start_server
}

main "$@"
