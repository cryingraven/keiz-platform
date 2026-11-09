#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NETWORK=testnet
export DRY_RUN="${DRY_RUN:-false}"
export INTENTS_ENABLED="${INTENTS_ENABLED:-false}"
export COLLECT_TOKEN_CONTRACT="${COLLECT_TOKEN_CONTRACT:-usdc.testnet}"
export COLLECT_ASSET_ID="${COLLECT_ASSET_ID:-nep141:usdc.testnet}"
export COLLECT_DECIMALS="${COLLECT_DECIMALS:-6}"
export PER_TX_LIMIT="${PER_TX_LIMIT:-1000000000}"
export DAILY_LIMIT="${DAILY_LIMIT:-5000000000}"
export THRESHOLD="${THRESHOLD:-1}"

exec "$SCRIPT_DIR/deploy.sh"
