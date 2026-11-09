#!/usr/bin/env bash
# Shared helpers for KEIZ contract deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WASM_DIR="$ROOT/contracts/target/wasm32-unknown-unknown/release"
COLLECT_WASM="$WASM_DIR/keiz_collect.wasm"
VAULT_WASM="$WASM_DIR/keiz_vault.wasm"

die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*"; }

require_env() {
  local name=$1
  [[ -n "${!name:-}" ]] || die "set $name"
}

is_true() { [[ "${1:-}" == "true" || "${1:-}" == "1" || "${1:-}" == "YES" ]]; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

rpc_url_for_network() {
  case "$1" in
    testnet) echo "${RPC_URL:-https://rpc.testnet.near.org}" ;;
    mainnet) echo "${RPC_URL:-https://rpc.mainnet.near.org}" ;;
    *) die "unknown NETWORK: $1" ;;
  esac
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "need sha256sum or shasum"
  fi
}

build_wasm() {
  if [[ -f "$COLLECT_WASM" && -f "$VAULT_WASM" ]]; then
    return
  fi
  note "Building contracts"
  local cargo_bin="${CARGO_BIN:-cargo}"
  # Prefer the rustup toolchain: Homebrew rustc may not have wasm std.
  if [[ -x "$HOME/.cargo/bin/cargo" ]]; then
    cargo_bin="$HOME/.cargo/bin/cargo"
  fi
  "$cargo_bin" build --manifest-path "$ROOT/contracts/Cargo.toml" \
    --workspace --target wasm32-unknown-unknown --release
}

init_signer() {
  local signer_mode="${SIGN_WITH:-legacy-keychain}"
  case "$signer_mode" in
    legacy-keychain)
      SIGNER=(sign-with-legacy-keychain send)
      ;;
    access-key-file)
      require_env SIGNER_KEY_FILE
      [[ -f "$SIGNER_KEY_FILE" ]] || die "SIGNER_KEY_FILE not found: $SIGNER_KEY_FILE"
      SIGNER=(sign-with-access-key-file "$SIGNER_KEY_FILE" send)
      ;;
    ledger)
      SIGNER=(sign-with-ledger send)
      ;;
    plaintext-key)
      require_env SIGNER_PRIVATE_KEY
      echo "warning: plaintext key mode is for local operations only" >&2
      SIGNER=(sign-with-plaintext-private-key "$SIGNER_PRIVATE_KEY" send)
      ;;
    *)
      die "SIGN_WITH must be legacy-keychain, access-key-file, ledger or plaintext-key"
      ;;
  esac
}

run() {
  if is_true "${DRY_RUN:-false}"; then
    printf '[dry-run]'
    printf ' %q' "$@"
    echo
  else
    "$@"
  fi
}

rpc_query() {
  local url=$1
  local params=$2
  curl -fsS "$url" \
    -H 'content-type: application/json' \
    --data "$(jq -nc --argjson params "$params" \
      '{jsonrpc:"2.0",id:"keiz-deploy",method:"query",params:$params}')"
}

contract_view() {
  local account=$1 method=$2 args=${3:-'{}'}
  local url
  url=$(rpc_url_for_network "$NETWORK")
  local payload
  payload=$(jq -nc --arg account "$account" --arg method "$method" --arg args "$args" \
    '{request_type:"call",finality:"final",account_id:$account,method_name:$method,args:($args|@base64)}')
  local response
  response=$(rpc_query "$url" "$payload")
  if ! jq -e '.result.result' >/dev/null 2>&1 <<<"$response"; then
    die "view $method failed on $account: $(jq -r '.error.message // .error // "no result"' <<<"$response")"
  fi
  jq -r '.result.result' <<<"$response" | base64 -d
}

account_exists() {
  local account=$1
  local url
  url=$(rpc_url_for_network "$NETWORK")
  local payload
  payload=$(jq -nc --arg account "$account" \
    '{request_type:"view_account",finality:"final",account_id:$account}')
  local response
  response=$(rpc_query "$url" "$payload")
  jq -e '.result.amount' >/dev/null 2>&1 <<<"$response"
}

assert_accounts() {
  if is_true "${DRY_RUN:-false}"; then
    note "dry-run: skipping account existence checks"
    return
  fi
  local account
  for account in "$COLLECT_ACCOUNT" "$VAULT_ACCOUNT" "$OWNER_ACCOUNT"; do
    account_exists "$account" || die "account does not exist on $NETWORK: $account"
  done
}

deploy_collect() {
  local init_args
  init_args=$(jq -nc \
    --arg owner "$OWNER_ACCOUNT" \
    --arg treasury "$TREASURY_ACCOUNT" \
    --arg org "$ORG_ID" \
    '{owner:$owner,treasury:$treasury,org_id:$org}')
  note "Deploying keiz-collect to $COLLECT_ACCOUNT"
  run near contract deploy "$COLLECT_ACCOUNT" \
    use-file "$COLLECT_WASM" \
    with-init-call new json-args "$init_args" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" "${SIGNER[@]}"
}

register_token() {
  note "Registering collect contract with $COLLECT_TOKEN_CONTRACT"
  run near contract call-function as-transaction "$COLLECT_TOKEN_CONTRACT" storage_deposit \
    json-args "$(jq -nc --arg account "$COLLECT_ACCOUNT" '{account_id:$account,registration_only:true}')" \
    prepaid-gas '30 Tgas' attached-deposit "${STORAGE_DEPOSIT_NEAR:-0.02 NEAR}" \
    sign-as "$OWNER_ACCOUNT" network-config "$NETWORK" "${SIGNER[@]}"
  run near contract call-function as-transaction "$COLLECT_ACCOUNT" set_allowed_token \
    json-args "$(jq -nc --arg token "$COLLECT_TOKEN_CONTRACT" '{token:$token,allowed:true}')" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
    sign-as "$OWNER_ACCOUNT" network-config "$NETWORK" "${SIGNER[@]}"
}

deploy_vault() {
  local approvers recipients policy init_args
  approvers="${APPROVERS_JSON:-[\"$OWNER_ACCOUNT\"]}"
  recipients="${ALLOWED_RECIPIENTS_JSON:-[]}"
  policy=$(jq -nc \
    --arg per "$PER_TX_LIMIT" \
    --arg daily "$DAILY_LIMIT" \
    --arg token "$COLLECT_TOKEN_CONTRACT" \
    --argjson recipients "$recipients" \
    --argjson intents "${INTENTS_ENABLED:-false}" \
    '{per_tx_limit:$per,daily_limit:$daily,allowed_assets:[$token],allowed_recipients:$recipients,intents_enabled:$intents,active:true}')
  init_args=$(jq -nc \
    --arg owner "$OWNER_ACCOUNT" \
    --argjson approvers "$approvers" \
    --argjson threshold "$THRESHOLD" \
    --argjson policy "$policy" \
    '{owner:$owner,approvers:$approvers,threshold:$threshold,policy:$policy}')
  note "Deploying keiz-vault to $VAULT_ACCOUNT"
  run near contract deploy "$VAULT_ACCOUNT" \
    use-file "$VAULT_WASM" \
    with-init-call new json-args "$init_args" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" "${SIGNER[@]}"
}

verify_collect() {
  [[ "$(contract_view "$COLLECT_ACCOUNT" get_org_id)" == "\"$ORG_ID\"" ]] \
    || die "collect get_org_id mismatch"
  [[ "$(contract_view "$COLLECT_ACCOUNT" get_treasury)" == "\"$TREASURY_ACCOUNT\"" ]] \
    || die "collect treasury mismatch"
  [[ "$(contract_view "$COLLECT_ACCOUNT" is_token_allowed "{\"token\":\"$COLLECT_TOKEN_CONTRACT\"}")" == "true" ]] \
    || die "collect token is not allowlisted"
  note "Collect verification passed"
}

verify_code_hash() {
  local url code deployed
  url=$(rpc_url_for_network "$NETWORK")
  code=$(rpc_query "$url" "$(jq -nc --arg account "$COLLECT_ACCOUNT" \
    '{request_type:"view_code",finality:"final",account_id:$account}')" \
    | jq -r '.result.code_base64 // empty')
  [[ -n "$code" ]] || die "could not read deployed collect code"
  local tmp
  tmp=$(mktemp)
  printf '%s' "$code" | base64 -d > "$tmp"
  deployed=$(sha256_file "$tmp")
  rm -f "$tmp"
  [[ "$deployed" == "$1" ]] || die "deployed code hash mismatch (local=$1 deployed=$deployed)"
  note "Deployed code hash matches local wasm"
}

record_output() {
  local out_dir="$ROOT/contracts/deploy/out"
  mkdir -p "$out_dir"
  local safe_org
  safe_org=$(printf '%s' "$ORG_ID" | tr -c 'A-Za-z0-9_-' '_')
  jq -n \
    --arg network "$NETWORK" \
    --arg orgId "$ORG_ID" \
    --arg collect "$COLLECT_ACCOUNT" \
    --arg treasury "$TREASURY_ACCOUNT" \
    --arg token "$COLLECT_TOKEN_CONTRACT" \
    --arg asset "$COLLECT_ASSET_ID" \
    --argjson decimals "$COLLECT_DECIMALS" \
    --arg vault "$VAULT_ACCOUNT" \
    --arg hash "$1" \
    '{network:$network,orgId:$orgId,collect:{contractId:$collect,treasury:$treasury,tokenContract:$token,assetId:$asset,decimals:$decimals},vault:{contractId:$vault},keizCollectCodeHash:$hash}' \
    > "$out_dir/${NETWORK}-${safe_org}.json"
  note "Wrote $out_dir/${NETWORK}-${safe_org}.json"
}
