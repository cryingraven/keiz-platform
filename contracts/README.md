# KEIZ contracts

Rust contracts for on-chain AR/AP settlement.

| Contract | Direction | Purpose |
|---|---|---|
| `keiz-collect` | AR | NEP-141 receiver that records customer payments against a receivable reference. |
| `keiz-vault` | AP | Policy-bound treasury that pays vendors after M-of-N approval. |

## Build and test

```bash
cd contracts
cargo test --workspace
cargo build --workspace --target wasm32-unknown-unknown --release
```

The wasm build requires the rustup-managed toolchain. If `rustc` resolves to
Homebrew, use `PATH="$HOME/.cargo/bin:$PATH" cargo ...`.

## AR: `keiz-collect`

Init:

```json
{ "owner": "owner.testnet", "treasury": "treasury.testnet", "org_id": "workspace-id" }
```

Customers pay with `ft_transfer_call`:

```json
{
  "receiver_id": "keiz-collect.testnet",
  "amount": "25000000",
  "msg": "{\"receivableRef\":\"AR-2001\",\"orgId\":\"workspace-id\"}"
}
```

Plain `AR-2001` is also accepted. When `orgId` is present it must match the contract's
init `org_id`, otherwise the transfer is refunded. The token must be allowlisted; otherwise the
contract returns the full amount (refund). Receipts are stored and emitted as:

```
EVENT_JSON:{"standard":"keiz","version":"1.0.0","event":"receipt",...}
```

Contracts cannot read their transaction hash, so the indexer supplies
`txHash`/`logIndex`; the contract supplies `id`, token, sender, amount,
receivable ref, block height and timestamp.

### Cross-chain AR with 1Click

Create a committed quote with:

- `destinationAsset` = allowlisted NEAR NEP-141 asset
- `recipient` = `keiz-collect` account
- `recipientType` = `DESTINATION_CHAIN`
- `customRecipientMsg` = `{"receivableRef":"AR-2001"}`
- `refundTo` = the customer's origin-chain address

1Click calls `ft_transfer_call` on the destination token, which calls
`ft_on_transfer` with the message. Never use `customRecipientMsg` against a
receiver that does not implement `ft_on_transfer`.

## AP: `keiz-vault`

Init:

```json
{
  "owner": "owner.testnet",
  "approvers": ["alice.testnet", "bob.testnet"],
  "threshold": 2,
  "policy": {
    "per_tx_limit": "1000000000",
    "daily_limit": "5000000000",
    "allowed_assets": ["usdc.testnet"],
    "allowed_recipients": ["vendor.testnet"],
    "intents_enabled": true,
    "active": true
  }
}
```

`propose` accepts:

```json
{
  "token": "usdc.testnet",
  "to": "vendor.testnet",
  "amount": "25000000",
  "kind": "direct",
  "correlation_id": null,
  "deadline": null,
  "memo": "INV-1001"
}
```

For 1Click cross-chain payouts, use `kind: "intents_deposit"`, set `to` to the
committed quote's deposit address, and include `correlation_id` + `deadline`.
The policy and daily limit are re-checked at execution; a proposal only executes
when the approval threshold is reached.

Contracts cannot call HTTP, so the API owns quote creation and `/v0/status`
polling. The vault only executes `ft_transfer` to the deposit address. After
execution, the indexer submits that transaction to `/v0/deposit/submit` and
verifies the destination transfer before marking the invoice paid.

## Relayer boundary

The NEAR Auth relayer (`/auth/near-auth/relay`) remains `fast-auth.sign` only.
It is never used for treasury calls. AP proposals/approvals are wallet-signed by
OWNER/APPROVER accounts; adding a transaction relayer would require its own
contract/method allowlist and threat model.

## Deploy

Preview both networks first; no transactions are sent when `DRY_RUN=true`.

### Testnet

```bash
DRY_RUN=true \
OWNER_ACCOUNT=owner.testnet \
ORG_ID=<workspace-id> \
COLLECT_ACCOUNT=keiz-collect.testnet \
VAULT_ACCOUNT=keiz-vault.testnet \
./contracts/deploy/testnet.sh

# remove DRY_RUN=true to execute
```

The testnet wrapper defaults to `usdc.testnet`, 6 decimals, and explicit policy
limits in token minor units. Override `COLLECT_TOKEN_CONTRACT`,
`COLLECT_ASSET_ID`, `PER_TX_LIMIT`, `DAILY_LIMIT`, `THRESHOLD`,
`APPROVERS_JSON`, `ALLOWED_RECIPIENTS_JSON`, `TREASURY_ACCOUNT` as needed.

### Mainnet

```bash
CONFIRM_MAINNET=YES \
OWNER_ACCOUNT=owner.near \
ORG_ID=<workspace-id> \
COLLECT_ACCOUNT=keiz-collect.near \
VAULT_ACCOUNT=keiz-vault.near \
COLLECT_TOKEN_CONTRACT=usdc.near \
COLLECT_ASSET_ID=nep141:usdc.near \
PER_TX_LIMIT=1000000 \
DAILY_LIMIT=5000000 \
THRESHOLD=2 \
APPROVERS_JSON='["alice.near","bob.near"]' \
ALLOWED_RECIPIENTS_JSON='["vendor.near"]' \
./contracts/deploy/mainnet.sh

# review the dry-run output, then explicitly execute:
DRY_RUN=false EXECUTE_MAINNET=YES CONFIRM_MAINNET=YES … ./contracts/deploy/mainnet.sh
```

Mainnet requires `CONFIRM_MAINNET=YES` and, for a real broadcast, both
`DRY_RUN=false` and `EXECUTE_MAINNET=YES`. It also requires a non-empty
`ALLOWED_RECIPIENTS_JSON`. `INTENTS_ENABLED` defaults to `true` on mainnet and
`false` on testnet.

After a real deploy the script verifies the contract org id, treasury, token
allowlist, and deployed wasm hash, then writes
`contracts/deploy/out/<network>-<orgId>.json`. Use that output in
**Settings → AR collection**, and set `KEIZ_COLLECT_CODE_HASH` to the printed
wasm hash so the API can verify future workspace contracts.

Signer modes (`SIGN_WITH`): `legacy-keychain` (default), `access-key-file`
(`SIGNER_KEY_FILE`), `ledger`, or `plaintext-key` (`SIGNER_PRIVATE_KEY`).
Plaintext keys are for local operations only.

Account creation and funding are intentionally not automated. Create and fund
the collect/vault accounts first, import the signer (`near account
import-account`), then deploy.

1Click is mainnet-only. Testnet is for contract deployment and local tests;
cross-chain quote/deposit flows must be tested on mainnet with approved assets.

