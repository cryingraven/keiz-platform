# KEIZ — Integration & contract requirements

This document is the contract boundary for the integrations KEIZ still needs. It
covers what exists today, what is missing, and the exact interface each missing
piece must expose. Nothing here is deployed; it is the spec to implement against.

---

## 1. What exists today

| Integration | Contract / interface | Where used |
|---|---|---|
| Wallet login | NEP-413 message signature; on-chain `view_access_key` full-access check | `auth/nep413.ts`, `auth/near-verify.service.ts` |
| NEAR Auth login | Auth0 login, `fast-auth.sign` through a funded relayer, MPC-derived ed25519 key | `web/lib/near-auth.ts`, `auth/near-auth.service.ts`, `auth/near-tx.ts` |
| AP deposit | NEP-141 `ft_transfer` / `ft_transfer_call` to a 1Click deposit address | `web/components/pay-panel.tsx` |
| wNEAR origin | `wrap.near::near_deposit` + `ft_transfer` | `web/components/pay-panel.tsx` |
| Cross-chain payout | 1Click REST (`/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status`) | `payments/providers/intents.provider.ts` |
| Agent custody | OutLayer REST (`register`, `getAddress`, `getBalance`, `policy.get`, `withdraw`, `withdrawDryRun`, `getRequest`) | `outlayer/outlayer.service.ts` |
| Chain audit | NEAR RPC `tx`, `query`, `send_tx` | `payments/near-tx-verifier.ts`, `indexer/indexer.service.ts` |

**Contract boundary:** the API never constructs an asset id, never signs a
transfer itself, and never accepts a client-supplied transaction hash without
verifying it (1Click mode). Keep those invariants.

---

## 2. Implemented: on-chain AR collection (`keiz-collect`)

The Rust contract lives in `contracts/keiz-collect`. It is a NEP-141 receiver
that attributes incoming transfers to a receivable reference.

### Interface

```rust
/// NEP-141 receiver. `msg` is the KEIZ receivable reference, e.g. "AR-2001".
#[near_bindgen]
impl KeizCollect {
    /// Called by the token contract after ft_transfer_call.
    /// Return "0" to accept the full amount, or a non-zero string to refund.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128>;

    /// Append-only read model for the indexer.
    pub fn get_receipts(
        &self,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<ReceiptView>;

    /// Owner-only sweep to the workspace treasury.
    pub fn sweep(&mut self, token: AccountId, to: AccountId, amount: U128) -> Promise;

    /// Owner-only allowlist of accepted tokens.
    pub fn set_allowed_token(&mut self, token: AccountId, allowed: bool);
}
```

`ReceiptView { id, token, sender_id, amount, receivable_ref, block_height, observed_at }`.

A NEAR contract cannot read its transaction hash; the indexer adds
`tx_hash`/`log_index` when it records the receipt.

### Cross-chain AR with 1Click

Create a committed quote with `recipient = keiz-collect.<workspace>`,
`recipientType = DESTINATION_CHAIN`, and
`customRecipientMsg = {"receivableRef":"AR-2001"}`. 1Click calls
`ft_transfer_call` on the destination token, which invokes `ft_on_transfer`.
The destination token must be allowlisted in the contract and registered for
storage. 1Click is mainnet-only.

### Client flow

1. The customer sends `ft_transfer_call({ receiver_id: "keiz-collect.near",
   amount, msg: "AR-2001" })` from any NEP-141 token.
2. `ft_on_transfer` validates the token allowlist and `msg`, stores a receipt
   keyed by `(tx_hash, log_index)`, and returns `"0"` (accept).
3. `IndexerService` reads `get_receipts` (or the emitted `ft_transfer` event) and
   calls `ReceivablesService.recordReceipt` with `method: ONCHAIN`, `txHash`,
   and the idempotency key `chain:<txHash>:<logIndex>`.

### Why a contract

`ft_transfer` has no memo field. Without a receiver contract there is no
reliable way to attribute an incoming transfer to a receivable. Alternatives:

- a unique implicit account per receivable (works, but creates one account and
  storage deposit per invoice);
- a single treasury account plus manual matching (current behaviour).

### Follow-up

- The indexer now reads `get_receipts` from the configured collect contract and
  records `ONCHAIN` receipts with a stable `chainEventId`
  (`collect:<contract>:<receiptId>`). It rejects overpayments and unknown refs.
- Set `KEIZ_COLLECT_ORG_ID`, `KEIZ_COLLECT_TOKEN_CONTRACT` and
  `KEIZ_COLLECT_ASSET_DECIMALS` alongside the contract id.
- Per-workspace deployment is still manual; the current env config is one
  collect contract per deployment.
- Only the indexer creates `ONCHAIN` receipts; the browser cannot.

---

## 3. Implemented: on-chain AP treasury (`keiz-vault`)

`contracts/keiz-vault` is the policy-bound treasury for vendor payments. It
supports M-of-N approval, per-transaction and daily limits, allowed assets and
recipients, pause, and an `intents_deposit` proposal kind for 1Click payouts.
Policy is re-checked at execution time inside the contract.

For cross-chain AP, the API creates a 1Click `EXACT_OUTPUT` quote, then the vault
proposes/approves an `intents_deposit` transfer to the quote's deposit address.
The API submits the vault tx hash to `/v0/deposit/submit` and verifies the
destination transfer before marking the invoice paid.

The NEAR Auth relayer remains `fast-auth.sign` only. Vault proposals/approvals
are wallet-signed, or use a separate transaction relayer with its own contract
and method allowlist.


### `keiz-vault` interface

```rust
#[near_bindgen]
impl KeizVault {
    /// Owner or an allowlisted operator proposes a transfer.
    pub fn propose(&mut self, token: AccountId, to: AccountId, amount: U128) -> u64;

    /// Approvers (M of N) approve; execution happens when the threshold is met.
    pub fn approve(&mut self, proposal_id: u64) -> PromiseOrValue<()>;

    /// Enforced on-chain, not just in the API.
    pub fn set_policy(&mut self, policy: Policy);

    pub fn get_policy(&self) -> Policy;
}

pub struct Policy {
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub approval_threshold: U128,
    pub allowed_assets: Vec<AccountId>,
    pub allowed_recipients: Vec<AccountId>, // optional
    pub active: bool,
}
```

The key property is that the limit is checked **at execution time inside the
contract**, so a compromised API cannot bypass it. The contract now exists in
`contracts/keiz-vault`; local agents must still not be described as custody
until it is deployed and wired.

---

## 4. Missing: OutLayer policy write

Custody policy is read-only in KEIZ; owners must use the handoff URL. A wallet
with no policy is unrestricted. Two acceptable fixes:

1. **Preferred:** use an OutLayer API that writes policy
   (`policy.set` / `policy.update`) and call it from
   `PATCH /agent/wallet/policy` when `provider === "outlayer"`. Fail the request
   if the policy is `none`.
2. **Fallback:** block `execute` for custody wallets whose `policy.get()`
   returns `none`/`null`, and surface "Set a policy before funding" in the UI.

Never silently allow an unrestricted custody wallet to spend.

---

## 5. Partially implemented: destination payout verification

A missing destination transaction hash now forces `NEEDS_REVIEW` instead of
marking the invoice paid. Still missing:

- verify the destination transfer on the target chain (`eth_getTransactionByHash`,
  Solana `getTransaction`, etc.);
- check `amount >= amountOut`, token contract, and recipient;
- store the verification result in `payment_events` with `rawStatus`.
- Do not mark the invoice `PAID` from 1Click `SUCCESS` alone if the destination
  cannot be verified; move to `NEEDS_REVIEW` instead.

This needs a small verifier service per chain, not a smart contract.

---

## 6. Implemented: webhooks / queue

Payments, OutLayer custody, the indexer and the NEAR Auth relayer now run as
BullMQ jobs. The API produces jobs and the separate worker
(`pnpm --filter @keiz/api worker`) processes them; Redis is required
(`REDIS_URL`). Payment/OutLayer polls are per-payment delayed jobs plus
repeatable sweepers; the relayer queue uses concurrency 1. `QUEUES_ENABLED=false`
makes producers no-ops for tests.

Still missing: a 1Click webhook endpoint (provider-dependent) and notification
fan-out.

---

## 7. Missing: B2B workspace operations

These are API/product contracts, not smart contracts, but they block real use:

| Capability | Needed endpoint(s) |
|---|---|
| Team invites / roles | `POST /orgs/:id/members`, `PATCH /orgs/:id/members/:userId`, `DELETE …` |
| Org switching | `GET /orgs`, `POST /auth/switch-org` |
| Vendor/customer edit | `PATCH /vendors/:id`, `PATCH /customers/:id`, archive |
| Draft bill edit | `PATCH /invoices/:id` (DRAFT only) |
| Attachments | presigned upload + `attachments` collection |
| Exports | `GET /invoices/export.csv`, `GET /accounting/journal.csv` |
| Notifications | email/webhook on submit/approve/pay |

`UsersService.addMember` already exists and is used by tests; it needs a guarded
controller and an invite token flow before it is exposed.
