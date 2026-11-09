#!/usr/bin/env bash
set -euo pipefail

# Deploy both KEIZ contracts on NEAR testnet.
# Requires: near-cli-rs (`cargo install cargo-near` is not enough for deployment),
# wasm built with:
#   cd contracts && cargo build --workspace --target wasm32-unknown-unknown --release
#
# Required:
#   COLLECT_ACCOUNT=keiz-collect.testnet
#   VAULT_ACCOUNT=keiz-vault.testnet
#   OWNER_ACCOUNT=owner.testnet
# Optional:
#   TREASURY_ACCOUNT=$OWNER_ACCOUNT
#   APPROVERS_JSON='["alice.testnet","bob.testnet"]'
#   THRESHOLD=2
#   USDC_CONTRACT=usdc.testnet
#   VENDOR_RECIPIENT=vendor.testnet

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WASM_DIR="$ROOT/contracts/target/wasm32-unknown-unknown/release"
: "${COLLECT_ACCOUNT:?set COLLECT_ACCOUNT}"
: "${VAULT_ACCOUNT:?set VAULT_ACCOUNT}"
: "${OWNER_ACCOUNT:?set OWNER_ACCOUNT}"
: "${ORG_ID:?set ORG_ID}"
TREASURY_ACCOUNT="${TREASURY_ACCOUNT:-$OWNER_ACCOUNT}"
APPROVERS_JSON="${APPROVERS_JSON:-[\"$OWNER_ACCOUNT\"]}"
THRESHOLD="${THRESHOLD:-1}"
USDC_CONTRACT="${USDC_CONTRACT:-usdc.testnet}"
VENDOR_RECIPIENT="${VENDOR_RECIPIENT:-$OWNER_ACCOUNT}"

net=(network-config testnet)
sign=(sign-with-key "$HOME/.near-credentials/testnet/$OWNER_ACCOUNT.json" send)

near contract deploy "$COLLECT_ACCOUNT" \
  use-file "$WASM_DIR/keiz_collect.wasm" \
  with-init-call new json-args "{\"owner\":\"$OWNER_ACCOUNT\",\"treasury\":\"$TREASURY_ACCOUNT\",\"org_id\":\"$ORG_ID\"}" \
  with-attached-deposit 0 "${net[@]}" "${sign[@]}"

# Register the receiver with each accepted NEP-141 token. Repeat for more tokens.
near contract call-function as-transaction "$USDC_CONTRACT" storage_deposit \
  json-args "{\"account_id\":\"$COLLECT_ACCOUNT\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' "${net[@]}" "${sign[@]}"
near contract call-function as-transaction "$COLLECT_ACCOUNT" set_allowed_token \
  json-args "{\"token\":\"$USDC_CONTRACT\",\"allowed\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' "${net[@]}" "${sign[@]}"

near contract deploy "$VAULT_ACCOUNT" \
  use-file "$WASM_DIR/keiz_vault.wasm" \
  with-init-call new json-args "{
    \"owner\":\"$OWNER_ACCOUNT\",
    \"approvers\":$APPROVERS_JSON,
    \"threshold\":$THRESHOLD,
    \"policy\":{
      \"per_tx_limit\":\"1000000000\",
      \"daily_limit\":\"5000000000\",
      \"allowed_assets\":[\"$USDC_CONTRACT\"],
      \"allowed_recipients\":[\"$VENDOR_RECIPIENT\"],
      \"intents_enabled\":true,
      \"active\":true
    }
  }" \
  with-attached-deposit 0 "${net[@]}" "${sign[@]}"

echo "Collect: $COLLECT_ACCOUNT"
echo "Vault:   $VAULT_ACCOUNT"
