#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_cmd near
require_cmd jq
require_cmd curl
require_env NETWORK
require_env OWNER_ACCOUNT
require_env ORG_ID
require_env COLLECT_ACCOUNT
require_env VAULT_ACCOUNT
require_env COLLECT_TOKEN_CONTRACT
require_env COLLECT_ASSET_ID
require_env PER_TX_LIMIT
require_env DAILY_LIMIT
require_env THRESHOLD

[[ "$NETWORK" == "testnet" || "$NETWORK" == "mainnet" ]] || die "NETWORK must be testnet or mainnet"
TREASURY_ACCOUNT="${TREASURY_ACCOUNT:-$OWNER_ACCOUNT}"
COLLECT_DECIMALS="${COLLECT_DECIMALS:-6}"
DRY_RUN="${DRY_RUN:-false}"
INTENTS_ENABLED="${INTENTS_ENABLED:-false}"
STORAGE_DEPOSIT_NEAR="${STORAGE_DEPOSIT_NEAR:-0.02 NEAR}"

if [[ "$NETWORK" == "mainnet" ]]; then
  [[ "${CONFIRM_MAINNET:-}" == "YES" ]] || die "set CONFIRM_MAINNET=YES to touch mainnet"
  if ! is_true "$DRY_RUN"; then
    [[ "${EXECUTE_MAINNET:-}" == "YES" ]] || die "set EXECUTE_MAINNET=YES after reviewing the dry run"
    [[ -n "${ALLOWED_RECIPIENTS_JSON:-}" ]] || die "mainnet requires ALLOWED_RECIPIENTS_JSON"
  fi
  INTENTS_ENABLED="${INTENTS_ENABLED:-true}"
fi

build_wasm
[[ -f "$COLLECT_WASM" && -f "$VAULT_WASM" ]] || die "wasm build missing: $WASM_DIR"
init_signer
assert_accounts

LOCAL_HASH=$(sha256_file "$COLLECT_WASM")
if [[ -n "${KEIZ_COLLECT_CODE_HASH:-}" && "$KEIZ_COLLECT_CODE_HASH" != "$LOCAL_HASH" ]]; then
  die "KEIZ_COLLECT_CODE_HASH does not match local wasm ($LOCAL_HASH)"
fi
note "Network: $NETWORK"
note "Collect wasm sha256: $LOCAL_HASH"
note "Dry run: $DRY_RUN"

deploy_collect
register_token
deploy_vault

if ! is_true "$DRY_RUN"; then
  verify_collect
  verify_code_hash "$LOCAL_HASH"
  record_output "$LOCAL_HASH"
fi

echo
echo "Collect contract: $COLLECT_ACCOUNT"
echo "Vault contract:   $VAULT_ACCOUNT"
echo "Wasm sha256:      $LOCAL_HASH"
echo "Set KEIZ_COLLECT_CODE_HASH=$LOCAL_HASH and the collect details in Settings → AR collection."
