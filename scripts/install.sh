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

NO_DEMO=false
SKIP_POSTGRES=false
SKIP_CHECK=false
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
  --model-provider <id>     Configure Workspace Agent provider
                           anthropic, openai, azure_openai, google_gemini,
                           aws_bedrock, mistral, litellm, openrouter, ollama,
                           databricks, nvidia_nim, custom
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
  --skip-quickstart         Alias for --skip-check
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
        SKIP_CHECK=true
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

provider_label() {
  case "$1" in
    anthropic) printf 'Anthropic' ;;
    openai) printf 'OpenAI' ;;
    openrouter) printf 'OpenRouter' ;;
    ollama) printf 'Ollama (local)' ;;
    litellm) printf 'LiteLLM Proxy' ;;
    azure_openai) printf 'Azure OpenAI' ;;
    google_gemini) printf 'Google Gemini' ;;
    aws_bedrock) printf 'Amazon Bedrock' ;;
    mistral) printf 'Mistral' ;;
    databricks) printf 'Databricks AI Gateway' ;;
    nvidia_nim) printf 'NVIDIA NIM' ;;
    custom) printf 'Other OpenAI-compatible' ;;
    *) printf '%s' "$1" ;;
  esac
}

provider_default_base_url() {
  case "$1" in
    anthropic) printf 'https://api.anthropic.com/v1' ;;
    openai) printf 'https://api.openai.com/v1' ;;
    openrouter) printf 'https://openrouter.ai/api/v1' ;;
    ollama) printf 'http://localhost:11434/v1' ;;
    litellm) printf 'http://localhost:4000/v1' ;;
    azure_openai) printf 'https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1' ;;
    google_gemini) printf 'https://generativelanguage.googleapis.com/v1beta/openai' ;;
    aws_bedrock) printf 'https://bedrock-mantle.us-east-1.api.aws/v1' ;;
    mistral) printf 'https://api.mistral.ai/v1' ;;
    databricks) printf 'https://YOUR-WORKSPACE.cloud.databricks.com/serving-endpoints' ;;
    nvidia_nim) printf 'https://integrate.api.nvidia.com/v1' ;;
    custom) printf 'https://your-gateway.example.com/v1' ;;
    *) printf '' ;;
  esac
}

provider_default_model() {
  case "$1" in
    anthropic) printf 'claude-sonnet-4-20250514' ;;
    openai) printf 'gpt-5.2' ;;
    openrouter) printf 'anthropic/claude-sonnet-4' ;;
    ollama) printf 'qwen2.5:7b-instruct' ;;
    google_gemini) printf 'gemini-2.5-flash' ;;
    aws_bedrock) printf 'openai.gpt-oss-120b' ;;
    mistral) printf 'mistral-large-latest' ;;
    nvidia_nim) printf 'meta/llama-3.1-70b-instruct' ;;
    *) printf '' ;;
  esac
}

provider_model_label() {
  case "$1" in
    azure_openai) printf 'Deployment name' ;;
    litellm) printf 'Proxy model name' ;;
    openrouter) printf 'Model route' ;;
    ollama) printf 'Installed model' ;;
    databricks) printf 'Served model or endpoint model' ;;
    nvidia_nim) printf 'NIM model ID' ;;
    aws_bedrock) printf 'Bedrock model ID' ;;
    *) printf 'Model ID' ;;
  esac
}

provider_model_placeholder() {
  case "$1" in
    azure_openai) printf 'my-gpt-deployment' ;;
    litellm) printf 'customer-context-agent' ;;
    databricks) printf 'my-serving-endpoint' ;;
    custom) printf 'your-model-id' ;;
    *) printf '%s' "$(provider_default_model "$1")" ;;
  esac
}

provider_needs_custom_base_url() {
  case "$1" in
    azure_openai|databricks|custom) return 0 ;;
    *) return 1 ;;
  esac
}

provider_model_count() {
  case "$1" in
    anthropic) printf '3' ;;
    openai) printf '4' ;;
    google_gemini) printf '2' ;;
    aws_bedrock) printf '2' ;;
    mistral) printf '3' ;;
    openrouter) printf '2' ;;
    ollama) printf '2' ;;
    nvidia_nim) printf '2' ;;
    *) printf '0' ;;
  esac
}

provider_model_option() {
  case "$1:$2" in
    anthropic:1) printf 'claude-sonnet-4-20250514|Claude Sonnet 4 - recommended balance' ;;
    anthropic:2) printf 'claude-opus-4-20250514|Claude Opus 4 - higher capability' ;;
    anthropic:3) printf 'claude-3-5-haiku-20241022|Claude Haiku 3.5 - fast/lightweight' ;;
    openai:1) printf 'gpt-5.2|GPT-5.2 - recommended current option' ;;
    openai:2) printf 'gpt-5.1|GPT-5.1 - strong reasoning' ;;
    openai:3) printf 'gpt-5|GPT-5 - baseline GPT-5 reasoning' ;;
    openai:4) printf 'gpt-5-mini|GPT-5 mini - lower latency/cost' ;;
    google_gemini:1) printf 'gemini-2.5-flash|Gemini 2.5 Flash - fast function calling' ;;
    google_gemini:2) printf 'gemini-2.5-pro|Gemini 2.5 Pro - higher capability' ;;
    aws_bedrock:1) printf 'openai.gpt-oss-120b|GPT OSS 120B on Bedrock - example route' ;;
    aws_bedrock:2) printf 'us.anthropic.claude-sonnet-4-6|Claude Sonnet on Bedrock - example model ID' ;;
    mistral:1) printf 'mistral-large-latest|Mistral Large - high capability' ;;
    mistral:2) printf 'mistral-medium-latest|Mistral Medium - balanced' ;;
    mistral:3) printf 'mistral-small-latest|Mistral Small - lower latency' ;;
    openrouter:1) printf 'anthropic/claude-sonnet-4|Claude Sonnet 4 via OpenRouter' ;;
    openrouter:2) printf 'openai/gpt-5.2|GPT-5.2 via OpenRouter' ;;
    ollama:1) printf 'qwen2.5:7b-instruct|Qwen 2.5 7B Instruct - local default' ;;
    ollama:2) printf 'llama3.1:8b|Llama 3.1 8B - common local option' ;;
    nvidia_nim:1) printf 'meta/llama-3.1-70b-instruct|Llama 3.1 70B Instruct - example route' ;;
    nvidia_nim:2) printf 'nvidia/llama-3.3-nemotron-super-49b-v1.5|Nemotron Super 49B - NVIDIA-hosted route' ;;
    *) printf '' ;;
  esac
}

provider_requires_key() {
  case "$1" in
    anthropic|openai|openrouter|azure_openai|google_gemini|aws_bedrock|mistral|databricks|nvidia_nim) return 0 ;;
    *) return 1 ;;
  esac
}

provider_key_label() {
  case "$1" in
    anthropic) printf 'Anthropic API key' ;;
    openai) printf 'OpenAI API key' ;;
    openrouter) printf 'OpenRouter API key' ;;
    azure_openai) printf 'Azure OpenAI API key' ;;
    google_gemini) printf 'Gemini API key' ;;
    aws_bedrock) printf 'Bedrock API key' ;;
    mistral) printf 'Mistral API key' ;;
    databricks) printf 'Databricks token' ;;
    nvidia_nim) printf 'NVIDIA API key' ;;
    litellm) printf 'LiteLLM virtual key (optional)' ;;
    custom) printf 'API key (optional)' ;;
    *) printf 'API key' ;;
  esac
}

validate_provider() {
  case "$1" in
    anthropic|openai|azure_openai|google_gemini|aws_bedrock|mistral|litellm|openrouter|ollama|databricks|nvidia_nim|custom) return 0 ;;
    *) return 1 ;;
  esac
}

detect_ollama_model() {
  local base_url="${1:-http://localhost:11434/v1}"
  local tags_base="${base_url%/}"
  tags_base="${tags_base%/v1}"
  local tags_url="${tags_base}/api/tags"

  OLLAMA_TAGS_URL="$tags_url" node <<'NODE' 2>/dev/null || true
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
    const preferred = ['qwen2.5:7b-instruct', 'llama3.1:8b'];
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
  menu_line '  2) Anthropic'
  menu_line '  3) OpenAI'
  menu_line '  4) Azure OpenAI'
  menu_line '  5) Google Gemini'
  menu_line '  6) Amazon Bedrock'
  menu_line '  7) Mistral'
  menu_line '  8) LiteLLM Proxy'
  menu_line '  9) OpenRouter'
  menu_line ' 10) Ollama (local)'
  menu_line ' 11) Databricks AI Gateway'
  menu_line ' 12) NVIDIA NIM'
  menu_line ' 13) Other OpenAI-compatible'

  local choice
  choice="$(prompt_number "Model provider" "1" "13")"
  case "$choice" in
    1) printf 'skip' ;;
    2) printf 'anthropic' ;;
    3) printf 'openai' ;;
    4) printf 'azure_openai' ;;
    5) printf 'google_gemini' ;;
    6) printf 'aws_bedrock' ;;
    7) printf 'mistral' ;;
    8) printf 'litellm' ;;
    9) printf 'openrouter' ;;
    10) printf 'ollama' ;;
    11) printf 'databricks' ;;
    12) printf 'nvidia_nim' ;;
    13) printf 'custom' ;;
  esac
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
      if ! cli_lists_command doctor || ! cli_lists_server_subcommand start; then
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
    run_visible "Checking CRMy setup" "$CRMY_BIN" doctor
    return 0
  fi

  if cli_lists_command doctor; then
    run_visible "Checking CRMy setup" "$CRMY_BIN" doctor
    return 0
  fi

  warn "This @crmy/cli version does not include doctor. The workspace was initialized; run '$CRMY_BIN server start --port $PORT' to open CRMy."
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
  configure_model_route
  configure_demo_data
  ensure_postgres
  install_cli
  maybe_add_path
  if [ "$DRY_RUN" = true ]; then
    step "Using workspace directory $WORK_DIR"
    init_workspace
    run_setup_check
  else
    mkdir -p "$WORK_DIR"
    (
      cd "$WORK_DIR"
      init_workspace
      run_setup_check
    )
  fi
  print_next_steps
  maybe_start_server
}

main "$@"
