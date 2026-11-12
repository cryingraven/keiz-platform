# KEIZ — Integration & contract requirements

This document is the boundary between KEIZ and its external integrations: chain contracts,
NEAR Intents, OutLayer custody, WebAuthn passkeys and the background queues. It records what is wired
today, what exists in the contracts but is not wired, and what is still missing.

---

## 1. What exists today

| Integration | Contract / interface | Where used |
|---|---|---|
| Wallet login | NEP-413 message signature; on-chain `view_access_key` full-access check | `auth/nep413.ts`, `auth/near-verify.service.ts` |
| Passkey login | Self-hosted WebAuthn (RP = KEIZ) + PRF-derived ed25519 key; AES-GCM seed wrap | `web/lib/passkey/*`, `auth/webauthn/*` |
| AP deposit | NEP-141 `ft_transfer` / `ft_transfer_call` to a 1Click deposit address | `web/components/pay-panel.tsx` |
| wNEAR origin | `wrap.near::near_deposit` + `ft_transfer` | `web/components/pay-panel.tsx` |
| Cross-chain payout | 1Click REST (`/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status`) | `payments/providers/intents.provider.ts` |
| Agent custody | OutLayer REST (`register`, `getAddress`, `getBalance`, `policy.get`, `withdraw`, `withdrawDryRun`, `getRequest`) | `outlayer/outlayer.service.ts` |
| Chain audit | NEAR RPC `tx`, `query`, `send_tx` | `payments/near-tx-verifier.ts`, `indexer/indexer.service.ts` |
| On-chain AR | `keiz-collect` receiver or plain treasury; persisted 1Click quotes; public share pay | `contracts/keiz-collect`, `receivables/ar-collection.service.ts`, `documents/public-payments.service.ts`, `indexer/indexer.service.ts` |
| One-click collect deploy | Dedicated deployer creates `<prefix>.<account>`, deploys pinned wasm, allowlists token, hands ownership to the user | `collections/*`, `queues/processors/collection-deploy.processor.ts` |
| On-chain AP treasury | `keiz-vault` policy-bound M-of-N treasury | `contracts/keiz-vault`, `contracts/deploy` |
| Workspace operations | Members, org switching, vendor/customer edit, draft-bill edit | `users/*`, `vendors/*`, `receivables/*`, `invoices/*` |

**Contract boundary:** the API never constructs an asset id, never signs a payment transfer
itself, and never accepts a client-supplied transaction hash without verifying it (1Click
mode). The collection-deployer key is a separate, allowlisted signer used only to create and
initialize a pinned `keiz-collect` contract; it cannot move customer funds. Keep those
invariants.

---

## 2. Implemented: on-chain AR collection (contract or treasury)

AR collection has two modes, selected per workspace in Settings → AR collection mode:

| Mode | Receiver | Receipt source |
|---|---|---|
| `CONTRACT` | workspace `keiz-collect` | `ft_on_transfer` receipt, indexed by `syncCollectReceipts` |
| `TREASURY` | plain NEAR treasury account | open `ar_collection_quotes` polled by the indexer |
| `OFF` | none | collection-quote endpoint rejects |

`contracts/keiz-collect` is a NEP-141 receiver that attributes incoming
transfers to a receivable reference. The full entry-point list and event schema live in
[`contracts/README.md`](../contracts/README.md).

### Interface summary

```rust
#[near_bindgen]
impl Contract {
    /// Called by the token contract after ft_transfer_call.
    /// Returns "0" to accept the full amount, or the amount to refund.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String)
        -> PromiseOrValue<U128>;

    // Append-only read model used by the indexer.
    pub fn get_receipt(&self, id: u64) -> Option<ReceiptView>;
    pub fn get_receipts(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<ReceiptView>;
    pub fn get_receipts_for_ref(&self, receivable_ref: String, from_index: Option<u64>, limit: Option<u64>) -> Vec<ReceiptView>;
    pub fn get_receipt_count(&self) -> u64;

    // Owner-only administration.
    pub fn sweep(&mut self, token: AccountId, to: AccountId, amount: U128, memo: Option<String>) -> Promise;
    pub fn set_allowed_token(&mut self, token: AccountId, allowed: bool);
    pub fn set_owner(&mut self, owner: AccountId);
    pub fn set_treasury(&mut self, treasury: AccountId);
    pub fn pause(&mut self);
    pub fn unpause(&mut self);

    // Views.
    pub fn is_token_allowed(&self, token: AccountId) -> bool;
    pub fn get_owner(&self) -> AccountId;
    pub fn get_org_id(&self) -> String;
    pub fn get_treasury(&self) -> AccountId;
    pub fn is_paused(&self) -> bool;
}
```

`ReceiptView { id, token, sender, amount, receivable_ref, block_height, observed_at }`.
A NEAR contract cannot read its transaction hash; the indexer adds
`tx_hash`/`log_index` when it records the receipt.

Message rules: the reference is either plain (`AR-2001`) or JSON
(`{"receivableRef":"AR-2001","orgId":"<workspace-id>"}`). It must be 4–64 characters, start
with `AR-`, and use only ASCII alphanumerics, `-` or `_`. A mismatched `orgId`, a
non-allowlisted token, or a paused contract returns the full amount to the token contract
(refund).

### Cross-chain AR with 1Click

`ArCollectionService.quote` creates the committed quote for a receivable:

- `CONTRACT` mode: `recipient` = the workspace `keiz-collect` contract;
  `customRecipientMsg` = `{"orgId":"<workspace-id>","receivableRef":"AR-2001"}`, which makes
  the provider send `recipientType: "DESTINATION_CHAIN"`.
- `TREASURY` mode: `recipient` = the workspace treasury account and no
  `customRecipientMsg`; the quote itself is the attribution key.
- `refundTo` = the customer's origin-chain address;
- `swapType` = `EXACT_OUTPUT`; origin assets are limited to USDC/USDT.

Every quote is persisted in `ar_collection_quotes` with `source = DASHBOARD | SHARE`, its
deposit address and the origin/destination chain. Public share payments use the same
service with `source: SHARE`; the share token resolves the receivable.

1Click calls `ft_transfer_call` on the destination token for contract mode, which invokes
`ft_on_transfer`. The destination token must be allowlisted in the contract and registered
for storage (`storage_deposit`), and 1Click is mainnet-only. Treasury mode receives a plain
NEP-141 transfer; the indexer records it from the delivery transaction.

### Client flow

1. The browser requests `POST /api/receivables/:id/collection-quote` with `originAsset` and
   `refundTo`; the API rejects receivables that are not `ISSUED`/`PARTIALLY_PAID`, disabled
   workspaces (`OFF`), and `CONTRACT` workspaces without an `ACTIVE` collection.
2. The quote is stored in `ar_collection_quotes` with a unique deposit address. Contract mode
   delivers to the collect contract; treasury mode delivers to the workspace treasury.
3. Contract mode: the customer sends `ft_transfer_call({ receiver_id: "<collect contract>",
   amount, msg })`; `ft_on_transfer` validates the token allowlist, pause state and reference,
   stores a receipt, and returns `"0"` (accept).
4. `IndexerService` runs both paths:
   - `syncCollectReceipts` iterates organizations with `collection.status = ACTIVE`, reads
     `get_receipt_count` / `get_receipts`, and records receipts keyed by
     `collect:<orgId>:<contractId>:<receiptId>`.
   - `syncOpenQuotes` polls open treasury/share quotes and, on `SUCCESS` with a destination
     hash, records an `ONCHAIN` receipt keyed by `arquote:<quoteId>`, capped at the
     outstanding amount. Without a destination hash it sets `NEEDS_REVIEW`.
5. Overpayments, unknown references, wrong statuses and wrong tokens are recorded as
   `IGNORED` in `chain_events` for the collect path; the cursor still advances.

### Workspace configuration

Settings → AR collection mode writes `Organization.paymentSettings` through
`PATCH /api/orgs/current/payments` (`arMode` = `CONTRACT` | `TREASURY` | `OFF`, plus
`treasuryAccountId` and `arAssetId`). The effective mode falls back to an active contract,
then a configured treasury, then `OFF`.

Settings → AR collection writes `Organization.collection` through
`PATCH /api/orgs/current/collection`. `OrgCollectionService.validate` checks, against the
organization's network RPC:

- `get_org_id()` matches the workspace;
- `get_treasury()` matches the configured treasury;
- `is_token_allowed(tokenContract)` is true;
- when `KEIZ_COLLECT_CODE_HASH` is set, the deployed wasm hash matches it. In production the
  variable is mandatory before a contract can be activated.

`COLLECT_DEPLOY_ENABLED=true` also exposes one-click deployment from Settings. The API
creates `<prefix>.<COLLECT_DEPLOYER_ACCOUNT>`, deploys the pinned wasm, registers the token,
allowlists it and calls `set_owner` for the signed-in user. No key is added to the contract
account; the deployer is not a generic relayer.

`(collection.contractId)` has a unique partial index, so one contract cannot serve two
workspaces. Only the indexer writes `ONCHAIN` receipts; the browser cannot.

### Why a contract

`ft_transfer` has no memo field. Contract mode gives every incoming transfer an on-chain
receivable reference. Treasury mode is contract-free but depends on the quote record:
the indexer watches `ar_collection_quotes.depositAddress` and records the delivery from
1Click's destination transaction. That handles payments started from KEIZ (dashboard or
share link), but an arbitrary transfer sent directly to the treasury has no reference and
must be matched manually.

Alternatives considered:

- a unique implicit account per receivable (works, but creates one account and
  storage deposit per invoice);
- a single treasury account plus manual matching (implemented as `TREASURY` for app-created
  quotes).

---

## 3. Implemented contract: on-chain AP treasury (`keiz-vault`)

`contracts/keiz-vault` is the policy-bound treasury for vendor payments. It supports M-of-N
approval, per-transaction and daily limits, allowed assets and recipients, pause, and an
`intents_deposit` proposal kind for 1Click payouts. Policy is re-checked at execution time
inside the contract.

```rust
pub struct Policy {
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub allowed_assets: Vec<AccountId>,
    pub allowed_recipients: Vec<AccountId>, // empty = any
    pub intents_enabled: bool,
    pub active: bool,
}

#[near_bindgen]
impl Contract {
    pub fn propose(&mut self, args: ProposeArgs) -> u64;
    pub fn approve(&mut self, id: u64) -> Promise;
    pub fn reject(&mut self, id: u64);
    pub fn cancel(&mut self, id: u64);
    pub fn set_policy(&mut self, policy: Policy);
    pub fn set_approvers(&mut self, approvers: Vec<AccountId>, threshold: u32);
    pub fn set_threshold(&mut self, threshold: u32);
    pub fn pause(&mut self);
    pub fn unpause(&mut self);
    pub fn get_policy(&self) -> Policy;
    pub fn get_proposal(&self, id: u64) -> Option<Proposal>;
    pub fn get_proposals(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Proposal>;
    pub fn get_daily_spend(&self, token: AccountId) -> DailySpend;
}
```

The key property is that the limit is checked **at proposal and again at execution inside the
contract**, so a compromised or stale API cannot bypass it. The daily amount is reserved
atomically at execution; an `intents_deposit` proposal additionally requires
`intents_enabled`, a non-empty `correlation_id`, and an unexpired `deadline`.

For cross-chain AP, the API is expected to create a 1Click `EXACT_OUTPUT` quote, then the
vault proposes/approves an `intents_deposit` transfer to the quote's deposit address. The API
submits the vault tx hash to `/v0/deposit/submit` and verifies the destination transfer before
marking the invoice paid.

**Wiring status:** the contract, deploy scripts and policy model exist, but the vault is
operated separately from the app. Invoice approval is not yet connected to on-chain proposals.
The `vault` value in `PaymentIntent.rail` is reserved and has no execution path in
`AgentService`/`PaymentsService` yet. Do not describe the vault as the live AP rail until that
wiring lands.

There is no NEAR Auth relayer. Vault proposals/approvals are wallet-signed or signed by the
passkey-derived key. Any future transaction relayer needs its own contract and method allowlist.

---

## 4. Read-only by design: OutLayer custody policy

Custody policy is intentionally managed in OutLayer, not KEIZ:

- `GET /api/agent/wallet` reads `policy.get()` and exposes it read-only.
- `PATCH /api/agent/wallet/policy` returns **400** for `provider === "outlayer"`; the owner
  must use the handoff URL (`https://app.outlayer.ai/wallet?key=...`) to change policy.
- The handoff URL contains the full-authority API key. It is returned to OWNER only and must
  be opened on a trusted device.
- Execution calls `withdrawDryRun` first and refuses any `policy_check.decision` other than
  `allowed` or `requires_approval`. `no_policy_allow` is blocked, so a no-policy custody
  wallet cannot spend.
- Payouts are USD-only and the action stays `EXECUTING` until OutLayer reports `success`.
  `needs_review` is terminal and is never auto-retried.

If OutLayer ever exposes a policy-write API, the minimal change is a `PATCH
/agent/wallet/policy` branch for custody wallets; until then, do not silently allow an
unrestricted custody wallet to spend.

### 4.1 Agent jobs (mock settlement)

`agent_jobs` reuses the local agent policy but does not move real funds:

- Providers are seeded from `agent_providers`; the model never supplies a payout account.
- `AgentJobsService` calls `AgentService.previewSpend` before creating a job and
  `authorizeSpend` again at execution, so the per-tx, daily and approval rules still apply.
- The daily reservation is released if the provider handler fails.
- Settlement is recorded as `payment.method = "mock"`; there is no 1Click or OutLayer
  transfer in this slice. Do not claim an on-chain agent-to-agent payment until that rail
  is implemented and tested.

---

## 5. Partially implemented: destination payout verification

The API verifies the **source** deposit against NEAR RPC in `PAYMENTS_MODE=intents`: success,
`ft_transfer` on the quoted token contract, the quoted deposit address, and
`amount >= amountIn`.

Destination verification is still missing. Today a 1Click `SUCCESS` without a destination
transaction hash is downgraded to `NEEDS_REVIEW` instead of marking the invoice paid. Still
needed:

- verify the destination transfer on the target chain (`eth_getTransactionByHash`, Solana
  `getTransaction`, etc.);
- check `amount >= amountOut`, token contract, and recipient;
- store the verification result in `payment_events` with `rawStatus`;
- never mark the invoice `PAID` from 1Click `SUCCESS` alone when the destination cannot be
  verified; move to `NEEDS_REVIEW`.

This needs a small verifier service per chain, not a smart contract.

---

## 6. Implemented: webhooks / queue

Payments, OutLayer custody and the indexer run as BullMQ jobs. The API
produces jobs and the separate worker (`pnpm --filter @keiz/api worker`) processes them;
Redis is required (`REDIS_URL`). `QUEUES_ENABLED=false` makes producers no-ops for tests.

| Queue | Trigger | Cadence |
|---|---|---|
| `payments` | per-payment poll + repeatable sweep | `PAYMENT_SWEEP_INTERVAL_MS` (default 30s) |
| `outlayer` | per-payment poll + repeatable sweep | 2s first poll, 5s/30s/5m backoff, 5m sweep |
| `indexer` | repeatable sync: payments, collect receipts, AR quotes | `INDEXER_INTERVAL_MS` (default 30s) |
| `collections` | one-click `keiz-collect` deploy job | one job per deployment request |

`POST /api/indexer/collect` is an ADMIN/OWNER maintenance trigger that indexes every active
workspace collection immediately.

Still missing: a 1Click webhook endpoint (provider-dependent) and notification fan-out.

---

## 7. Workspace operations

Implemented:

| Capability | Endpoint(s) |
|---|---|
| Team members | `GET /api/members`, `POST /api/members`, `PATCH /api/members/:userId`, `DELETE /api/members/:userId` |
| Org switching | `GET /api/auth/orgs`, `POST /api/auth/switch-org` |
| Vendor edit/archive | `PATCH /api/vendors/:id`, `DELETE /api/vendors/:id` |
| Customer edit/archive/restore | `PATCH /api/customers/:id`, `DELETE /api/customers/:id`, `POST /api/customers/:id/restore` |
| Draft bill edit | `PATCH /api/invoices/:id` (DRAFT only, totals recomputed) |
| AR collection config | `GET/PATCH /api/orgs/current/collection` |
| AR rail mode | `GET/PATCH /api/orgs/current/payments` (`CONTRACT` / `TREASURY` / `OFF`) |
| One-click contract deploy | `GET/POST /api/orgs/current/collection/deploy`, `POST /api/orgs/current/collection/deploy/:id/retry` |
| Public invoice payment | `GET/POST /api/public/documents/:token/pay`, `GET /api/public/documents/:token/pay/:quoteId` |
| CSV export | client-side download on bills, receivables and journal pages |
| Report export | server-side PDF/XLSX from `/api/accounting/reports/export` |

Still missing:

| Capability | Needed work |
|---|---|
| Invites | An invite-token flow around `POST /members`; today an admin adds an existing NEAR account id directly. |
| Server-side CSV exports | API endpoints for CSV exports (the UI currently exports the loaded page). PDF/XLSX report exports are implemented. |
| Attachments | Presigned upload + an `attachments` collection. |
| Notifications | Email/webhook on submit/approve/pay. |
