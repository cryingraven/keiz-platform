#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NETWORK=mainnet
export DRY_RUN="${DRY_RUN:-true}"
export INTENTS_ENABLED="${INTENTS_ENABLED:-true}"

exec "$SCRIPT_DIR/deploy.sh"
