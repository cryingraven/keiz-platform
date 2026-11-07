# KEIZ — Integration & contract requirements

This document is the contract boundary for the integrations KEIZ still needs. It
covers what exists today, what is missing, and the exact interface each missing
piece must expose. Nothing here is deployed; it is the spec to implement against.

---

## 1. What exists today

| Integration | Contract / interface | Where used |
|---|---|---|
| Wallet login | NEP-413 message signature; on-chain `view_access_key` full-access check | `auth/nep413.ts`, `auth/near-verify.service.ts` |
| Passkey login | `fast-auth.sign` through a funded relayer; MPC-derived ed25519 key | `auth/near-tx.ts`, `auth/passkey.service.ts` |
| AP deposit | NEP-141 `ft_transfer` / `ft_transfer_call` to a 1Click deposit address | `web/components/pay-panel.tsx` |
| wNEAR origin | `wrap.near::near_deposit` + `ft_transfer` | `web/components/pay-panel.tsx` |
| Cross-chain payout | 1Click REST (`/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status`) | `payments/providers/intents.provider.ts` |
| Agent custody | OutLayer REST (`register`, `getAddress`, `getBalance`, `policy.get`, `withdraw`, `withdrawDryRun`, `getRequest`) | `outlayer/outlayer.service.ts` |
| Chain audit | NEAR RPC `tx`, `query`, `send_tx` | `payments/near-tx-verifier.ts`, `indexer/indexer.service.ts` |

**Contract boundary:** the API never constructs an asset id, never signs a
transfer itself, and never accepts a client-supplied transaction hash without
verifying it (1Click mode). Keep those invariants.

---

## 2. Missing: on-chain AR collection (`keiz-collect`)

Customer receipts are currently trusted strings. To reconcile incoming payments
automatically, deploy a NEP-141 receiver per workspace (or one shared contract
with an `org/workspace` field) and index its receipts.

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

`ReceiptView { tx_hash, sender_id, token, amount, receivable_ref, observed_at }`.

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

### Required follow-up

- Add `receipts.receivableRef` and `chainEventId` columns.
- Reject duplicate `(txHash, logIndex)` at the database level.
- Only accept `ONCHAIN` receipts from the indexer, never from the browser.

---

## 3. Missing: passkey payment signing

Passkey login currently authenticates only. A passkey cannot sign an
`ft_transfer`, so passkey-only deployments are read-only for payments.

### Option A — second relayer action (recommended for hackathon)

Extend the relayer to accept a **pre-signed** `ft_transfer` request:

```ts
type RelayTransfer = {
  receiverId: string;      // token contract
  methodName: 'ft_transfer';
  argsBase64: string;      // { receiver_id, amount, memo? }
  gas: string;             // <= 100 TGas
  deposit: string;         // must be "1"
  fastAuthSignature: string; // the MPC signature returned by fast-auth.sign
};
```

The relayer must:

- allow only `ft_transfer` on token contracts in `NEAR_DEPOSIT_ALLOWLIST`;
- cap gas and require `deposit === "1"`;
- verify `fastAuthSignature` was produced for this exact action (bind the
  signature to a hash of the serialized transaction);
- rate-limit per account and per IP.

This is a **fund-moving relayer**, so it must be treated as a higher-risk
component than the current `sign`-only relayer: separate keys, separate quota,
and an audit row for every submission.

### Option B — NEP-366 meta-transactions

Wrap the `ft_transfer` in a `SignedDelegate` and submit it through a relayer.
This is more generic but requires a `DelegateAction` builder and a relayer that
already supports NEP-366. Use this if you expect more contract calls later.

---

## 4. Missing: local agent execution / policy vault

The `provider: "local"` agent wallet generates an ed25519 key that is never used
to sign anything. Either remove local custody or make it real with a policy
vault.

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
contract**, so a compromised API cannot bypass it. Until this exists, local
agents must not be described as custody.

---

## 5. Missing: OutLayer policy write

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

## 6. Missing: destination payout verification

`Payment.destinationTxHashes` is display-only. For production:

- verify the destination transfer on the target chain (`eth_getTransactionByHash`,
  Solana `getTransaction`, etc.);
- check `amount >= amountOut`, token contract, and recipient;
- store the verification result in `payment_events` with `rawStatus`.
- Do not mark the invoice `PAID` from 1Click `SUCCESS` alone if the destination
  cannot be verified; move to `NEEDS_REVIEW` instead.

This needs a small verifier service per chain, not a smart contract.

---

## 7. Missing: webhooks / queue

All three pollers (`payments`, `outlayer`, `indexer`) are in-process and assume a
single API instance. Before scaling out:

- move pollers to a worker process (BullMQ/Redis, SQS, or a dedicated Nest app);
- add a 1Click webhook endpoint if/when the provider offers one;
- make every handler idempotent on `(provider, providerRequestId, status)`.

The database already has the right idempotency keys; only the execution model
needs to change.

---

## 8. Missing: B2B workspace operations

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
