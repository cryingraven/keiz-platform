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

`treasury` is optional and defaults to `owner`. The contract has no upgrade/migrate entry
point; changing code means deploying a new account and updating the workspace's AR collection
settings. Owner-only setters rotate `owner`, `treasury` and the token allowlist.

### Message format

Customers pay with `ft_transfer_call`:

```json
{
  "receiver_id": "keiz-collect.testnet",
  "amount": "25000000",
  "msg": "{\"receivableRef\":\"AR-2001\",\"orgId\":\"workspace-id\"}"
}
```

- Plain `AR-2001` is also accepted.
- The reference must be 4–64 characters, start with `AR-`, and contain only ASCII
  alphanumerics, `-` or `_`. Anything else is rejected and the transfer is refunded.
- `orgId` is optional. When present and the contract's `org_id` is non-empty, it must match,
  otherwise the transfer is refunded.
- The token must be allowlisted and the contract must not be paused. Invalid token, message,
  org or pause state returns the full amount, which the token contract refunds to the sender.

### Entry points

| Method | Access | Purpose |
|---|---|---|
| `new(owner, treasury, org_id)` | init | Deploy the receiver. |
| `ft_on_transfer(sender_id, amount, msg)` | token contract | Record a receipt and return `0` to accept; non-zero refunds. |
| `get_receipt(id)` | view | One `ReceiptView`. |
| `get_receipts(from_index, limit)` | view | Page through receipts (default 50, max 100). |
| `get_receipts_for_ref(receivable_ref, from_index, limit)` | view | Receipts for one receivable reference. |
| `get_receipt_count()` | view | Total receipt count; the indexer's high-water mark. |
| `sweep(token, to, amount, memo)` | owner | `ft_transfer` out of the contract. `to` is not forced to the treasury. |
| `set_allowed_token(token, allowed)` | owner | Token allowlist. |
| `is_token_allowed(token)` | view | Allowlist check used by Settings validation. |
| `set_owner(owner)` / `set_treasury(treasury)` | owner | Rotate admin accounts. |
| `pause()` / `unpause()` | owner | Stop accepting receipts. `sweep` also requires unpaused. |
| `get_owner()` / `get_org_id()` / `get_treasury()` / `is_paused()` | view | Admin/introspection. |

`ReceiptView` is `{ id, token, sender, amount, receivable_ref, block_height, observed_at }`;
`amount` is a `U128` integer in the token's smallest unit.

### Events and indexing

Receipts are stored and emitted as:

```
EVENT_JSON:{"standard":"keiz","version":"1.0.0","event":"receipt","data":{...}}
```

The `data` object carries `id`, `token`, `sender`, `amount` (string), `receivableRef`, `orgId`,
`blockHeight` and `observedAt`. Contracts cannot read their transaction hash, so the indexer
supplies `txHash`/`logIndex` when it records the receipt.

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

`Policy` is exactly:

| Field | Type | Meaning |
|---|---|---|
| `per_tx_limit` | `U128` | Maximum amount per proposal. |
| `daily_limit` | `U128` | Maximum amount per token per UTC day. |
| `allowed_assets` | `AccountId[]` | NEP-141 tokens the vault may transfer. Non-empty. |
| `allowed_recipients` | `AccountId[]` | Optional allowlist; empty means any recipient. |
| `intents_enabled` | `bool` | Permit `intents_deposit` proposals. |
| `active` | `bool` | Master switch for proposals and execution. |

Init and `set_policy` reject `per_tx_limit == 0`, `daily_limit == 0`,
`per_tx_limit > daily_limit`, and an empty `allowed_assets`.

`propose` takes a single `ProposeArgs` object:

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

`kind` is `direct` (default) or `intents_deposit`. For 1Click cross-chain payouts, use
`kind: "intents_deposit"`, set `to` to the committed quote's deposit address, and include a
non-empty `correlation_id` plus `deadline`. `intents_deposit` also requires
`policy.intents_enabled`. A deadline that has already passed blocks execution.

### Proposal lifecycle

1. `propose(args)` — owner or an allowlisted approver. The full policy and daily limit are
   checked before the proposal is stored. Returns the proposal id.
2. `approve(id)` — approvers only, one approval per account. Below the threshold it emits
   `approval` and returns without moving funds. At the threshold it re-checks the policy,
   verifies the deadline, reserves the daily amount atomically and emits `executed` before
   issuing `ft_transfer` to the token contract with 1 yoctoNEAR.
3. `reject(id)` — owner or approver; marks the proposal rejected.
4. `cancel(id)` — the original proposer or owner; marks the proposal rejected and emits
   `cancelled`.

The policy is checked at proposal **and** again at execution, so a policy change between
approvals is enforced by the contract. The daily counter is keyed by token and UTC day.

### Entry points

| Method | Access | Purpose |
|---|---|---|
| `new(owner, approvers, threshold, policy)` | init | Deploy the treasury. |
| `propose(args)` | owner/approver | Create a proposal; returns `u64`. |
| `approve(id)` | approver | Approve; executes at threshold. |
| `reject(id)` | owner/approver | Reject a proposal. |
| `cancel(id)` | proposer/owner | Cancel a proposal. |
| `set_policy(policy)` | owner | Replace policy; emits `policy`. |
| `set_approvers(approvers, threshold)` | owner | Replace the approver set and threshold. |
| `set_threshold(threshold)` | owner | Change the threshold (1..approvers). |
| `pause()` / `unpause()` | owner | Block propose/approve/reject. |
| `get_policy()` / `get_threshold()` / `get_approvers()` / `get_owner()` / `is_paused()` | view | Introspection. |
| `get_proposal(id)` / `get_proposals(from_index, limit)` | view | Proposal read model (default 50, max 100). |
| `get_daily_spend(token)` | view | `{ day, spent }` for the current token/day key. |

`Proposal` is `{ id, proposer, token, to, amount, kind, correlation_id, deadline, memo,
approvals, executed, rejected, created_at }`. Events use the same `EVENT_JSON` envelope with
`event` set to `proposal`, `approval`, `executed`, `rejected`, `cancelled`, or `policy`.

Contracts cannot call HTTP, so the API owns quote creation and `/v0/status`
polling. The vault only executes `ft_transfer` to the deposit address. After
execution, the indexer submits that transaction to `/v0/deposit/submit` and
verifies the destination transfer before marking the invoice paid.

> The vault is operated separately today. Invoice approval is not yet wired to on-chain
> proposals; the `vault` payment rail is reserved in `PaymentIntent` but has no execution path
> in the API.

## Relayer boundary

The NEAR Auth relayer (`/auth/near-auth/relay`) remains `fast-auth.sign` only.
It is never used for treasury calls. AP proposals/approvals are wallet-signed by
OWNER/APPROVER accounts; adding a transaction relayer would require its own
contract/method allowlist and threat model.

## Deploy

Preview both networks first; no transactions are sent when `DRY_RUN=true`. The script builds
the wasm if `contracts/target/wasm32-unknown-unknown/release/keiz_{collect,vault}.wasm` is
missing, requires `near`, `jq` and `curl`, and never creates or funds accounts.

Required variables (checked by `deploy.sh`):

| Variable | Notes |
|---|---|
| `OWNER_ACCOUNT`, `ORG_ID` | Owner signer and the workspace id stored in the collect contract. |
| `COLLECT_ACCOUNT`, `VAULT_ACCOUNT` | Existing, funded accounts. |
| `COLLECT_TOKEN_CONTRACT` | NEP-141 token allowlisted by both contracts. |
| `COLLECT_ASSET_ID` | 1Click asset id written to the deployment output. |
| `PER_TX_LIMIT`, `DAILY_LIMIT`, `THRESHOLD` | Integer minor units and an approval threshold. |

Optional: `TREASURY_ACCOUNT` (default collector `OWNER_ACCOUNT`), `COLLECT_DECIMALS`
(default `6`), `STORAGE_DEPOSIT_NEAR` (default `0.02 NEAR`), `APPROVERS_JSON`
(default `[OWNER_ACCOUNT]`), `ALLOWED_RECIPIENTS_JSON` (default `[]`), `INTENTS_ENABLED`
(default `false` on testnet, `true` on mainnet), `RPC_URL`, and
`KEIZ_COLLECT_CODE_HASH` (when set, the script aborts if it differs from the local wasm).
`SIGN_WITH` selects the signer (see below).

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
`contracts/deploy/out/<network>-<orgId>.json` with:

```json
{
  "network": "testnet",
  "orgId": "...",
  "collect": { "contractId": "...", "treasury": "...", "tokenContract": "...", "assetId": "...", "decimals": 6 },
  "vault": { "contractId": "..." },
  "keizCollectCodeHash": "..."
}
```

Use the `collect` object in **Settings → AR collection**, and set
`KEIZ_COLLECT_CODE_HASH` to `keizCollectCodeHash` so the API verifies the deployed code before
activating a workspace contract.

Signer modes (`SIGN_WITH`): `legacy-keychain` (default), `access-key-file`
(`SIGNER_KEY_FILE`), `ledger`, or `plaintext-key` (`SIGNER_PRIVATE_KEY`).
Plaintext keys are for local operations only. The script also registers the collect account
with the token contract (`storage_deposit`, `registration_only`) before allowlisting it.

Account creation and funding are intentionally not automated. Create and fund
the collect/vault accounts first, import the signer (`near account
import-account`), then deploy.

1Click is mainnet-only. Testnet is for contract deployment and local tests;
cross-chain quote/deposit flows must be tested on mainnet with approved assets.

