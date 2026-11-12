# KEIZ data model

Application collections are owned by Mongoose in `apps/api/src/**/*.schema.ts`. Mastra owns
its chat collections through a second Mongo client. All money is an integer **minor-unit
string** plus a `decimals` field; never cast it to `Number`. All timestamps come from
Mongoose `{ timestamps: true }` unless noted.

`.lean()` documents expose `_id`, not `id`. Convert with `String(doc._id)`.

## Cross-cutting conventions

- Almost every collection carries `orgId`. Every query must filter on it; never trust an
  `orgId` from a request body, query parameter, or model/tool output.
- `_id` is a Mongo `ObjectId` unless the table says otherwise. Foreign keys are stored as
  strings in application code (for example `invoiceId`, `vendorId`), not `ObjectId` refs.
- `userId` refers to the `users._id` value; `accountId` is the NEAR account string.
- Monetary fields (`total`, `subtotal`, `taxAmount`, `amount`, `paidAmount`, `debit`,
  `credit`, `amountUsd`) are strings of integer minor units.
- System journal postings are idempotent through `dedupeKey`; only manual entries omit it.

---

## Identity and tenancy

### `users`

| Field | Type | Notes |
|---|---|---|
| `accountId` | string | Unique, indexed. NEAR account id. |
| `network` | `mainnet` \| `testnet` | Binds the identity to one chain. Indexed. |
| `displayName`, `avatarUrl` | string? | Optional profile. |
| `activeOrgId` | string? | Workspace selected on the next sign-in. |
| `lastLoginAt` | Date? | |
| `tokenVersion` | number | Bumped to invalidate every token for the user. |
| `refreshJti` | string? | `select: false`. Current refresh-token id. |
| `previousRefreshJti` | string? | `select: false`. Grace window for parallel tabs. |
| `refreshGraceUntil` | Date? | `select: false`. |

### `memberships`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `userId` | string | Indexed. |
| `role` | `OWNER` \| `ADMIN` \| `APPROVER` \| `MEMBER` | Default `MEMBER`. |

Unique index: `(orgId, userId)`. The last OWNER cannot be demoted or removed.

### `organizations`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name. |
| `slug` | string | Unique, indexed. |
| `baseCurrency` | string | Default `USD`; used as the default currency in Accounting and Reporting. |
| `network` | `mainnet` \| `testnet` | Matches every member's network. Indexed. |
| `collection` | embedded object? | Per-workspace AR collection config. |
| `paymentSettings` | embedded object? | `arMode` (`CONTRACT` \| `TREASURY` \| `OFF`), `treasuryAccountId?`, `arAssetId?`. |

`collection` fields: `contractId`, `network`, `treasury`, `assetId`, `tokenContract`,
`decimals` (default 6), `status` (`PENDING` \| `ACTIVE` \| `PAUSED` \| `DISABLED`),
`deployedAt?`, `validatedAt?`.

`paymentSettings` is optional. When `arMode` is unset the effective mode is `CONTRACT` if
the collection is `ACTIVE`, else `TREASURY` if a treasury exists, else `OFF`.

Unique partial index: `collection.contractId` — one workspace per deployed collect contract.

---

## AP

### `vendors`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `name`, `email` | string | Required. |
| `nearAccountId` | string? | Optional NEAR payout identity. |
| `payoutChain` | string | Default `near`. |
| `payoutAddress` | string | Validated for `payoutChain`. |
| `bankName`, `bankAccount` | string? | Optional fiat details. |
| `status` | `ACTIVE` \| `ARCHIVED` | Default `ACTIVE`; delete archives. |

Index: `(orgId, createdAt)`.

### `invoices`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `vendorId` | string | Indexed. |
| `number` | string | Unique per org. |
| `issueDate`, `dueDate` | Date | |
| `currency` | string | Default `USD`; one of USD/EUR/SGD/IDR at the API boundary. |
| `decimals` | number | Default 2. |
| `lineItems[]` | embedded | `description`, `quantity`, `unitPrice`, `lineTotal` (all money as strings except decimals). |
| `subtotal`, `taxAmount`, `total` | string | Integer minor units. |
| `taxBps` | number | 0–10000. |
| `status` | enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, `PAYMENT_PENDING`, `PAID`, `VOID`. |
| `notes` | string? | |
| `createdByUserId` | string | Used by separation-of-duties. |
| `approvals[]` | embedded | `userId`, `accountId`, `decision`, `comment?`, `at`. Append-only. |
| `paidAt` | Date? | |
| `paymentId` | string? | Last settled payment. |

Indexes: unique `(orgId, number)`, `(orgId, createdAt)`, `(orgId, status)`.

---

## Payments and rails

### `payments`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `invoiceId` | string | Indexed. |
| `provider` | `mock` \| `intents` \| `outlayer` | |
| `payer` | `USER` \| `AGENT` | Default `USER`. |
| `status` | enum | `QUOTED`, `AWAITING_DEPOSIT`, `PROCESSING`, `SUCCEEDED`, `UNDERPAID`, `REFUNDED`, `FAILED`, `EXPIRED`, `NEEDS_REVIEW`. |
| `rawStatus` | string? | Raw provider status, never shown in the UI. |
| `originAsset`, `destinationAsset` | string | Provider asset ids. Never construct these. |
| `swapType` | `EXACT_INPUT` \| `EXACT_OUTPUT` | AP uses `EXACT_OUTPUT`. |
| `amountIn`, `amountOut` | string | Minor units. |
| `amountInFormatted`, `amountOutFormatted`, `minAmountOut`, `minAmountIn`, `maxAmountIn` | string? | Display/quote helpers. |
| `originContract` | string? | NEP-141 contract parsed from `originAsset` for deposit verification. |
| `idempotencyKey` | string? | Unique per org when present. |
| `outlayerRequestId` | string? | Custody request id. |
| `originSymbol`, `destinationSymbol`, `destinationChain`, `destinationAddress` | string? | |
| `correlationId` | string? | 1Click correlation id. |
| `depositAddress`, `depositMemo` | string? | `depositAddress` is indexed. |
| `deadline` | Date? | |
| `txHash` | string? | Source deposit hash; unique per org when present. |
| `submittedAt` | Date? | |
| `originTxHashes[]`, `destinationTxHashes[]` | embedded | `{ hash, explorerUrl? }`. |
| `refundReason`, `error` | string? | |
| `createdByUserId` | string | |
| `payerAccountId` | string? | NEAR account that paid. |
| `agentActionId` | string? | Set when created by the agent. |

Indexes:

- `(orgId, createdAt)`, `(status, deadline)`, `(provider, status)`, `(provider, submittedAt)`
- unique partial `(orgId, txHash)` when `txHash` exists
- unique partial `(orgId, idempotencyKey)` when present
- unique partial `(orgId, invoiceId)` for `AWAITING_DEPOSIT`/`PROCESSING` — one live quote per
  invoice

### `payment_events`

Append-only audit trail. Never update or delete rows.

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `paymentId` | string | Indexed. |
| `status` | string | Local status at the time of the event. |
| `rawStatus` | string? | Provider status. |
| `payload` | object? | Extra context. |

Index: `(orgId, createdAt)`.

### `payment_intents`

One live payment obligation per invoice across every rail.

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `invoiceId` | string | Indexed. |
| `amount` | string | Minor units. |
| `currency` | string | Default `USD`. |
| `rail` | `oneclick` \| `outlayer` \| `vault` | `vault` is reserved, not executed. |
| `status` | `OPEN` \| `EXECUTING` \| `SETTLED` \| `FAILED` \| `CANCELLED` | Default `OPEN`. |
| `paymentId` | string? | Linked payment once created. |
| `createdByUserId` | string? | |
| `settledAt` | Date? | |

Indexes: unique partial `(orgId, invoiceId)` for `OPEN`/`EXECUTING`; `(orgId, status, createdAt)`.

### `payment_attempts`

One row per execution attempt against a rail.

| Field | Type | Notes |
|---|---|---|
| `intentId` | string | Indexed. |
| `orgId` | string | Indexed. |
| `rail` | `oneclick` \| `outlayer` \| `vault` | |
| `status` | string | Default `PENDING`. |
| `paymentId` | string? | |
| `providerRequestId` | string? | |
| `providerStatus` | string? | |
| `payload` | object? | |

Indexes: `(intentId, createdAt)`, `(orgId, createdAt)`.

---

## AR

### `customers`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `name`, `email` | string | Required. |
| `taxId`, `billingAddress` | string? | |
| `status` | `ACTIVE` \| `ARCHIVED` | Default `ACTIVE`. |

Index: `(orgId, createdAt)`.

### `receivables`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `customerId` | string | Indexed. |
| `number` | string | Unique per org. |
| `issueDate`, `dueDate` | Date | |
| `currency` | string | Default `USD`. |
| `decimals` | number | Default 2. |
| `lineItems[]` | embedded | Same shape as invoice lines. |
| `subtotal`, `taxAmount`, `total` | string | Minor units. |
| `paidAmount` | string | Default `"0"`; updated under an optimistic lock. |
| `taxBps` | number | |
| `status` | enum | `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `VOID`. |
| `notes` | string? | |
| `createdByUserId` | string | |
| `receipts[]` | embedded | See below. |
| `issuedAt`, `voidedAt` | Date? | |

Embedded `receipts`: `receiptId` (client-generated, idempotent), `amount`, `currency`,
`decimals`, `receivedAt`, `method` (`BANK_TRANSFER` \| `ONCHAIN` \| `CASH` \| `CARD` \| `OTHER`),
`reference?`, `txHash?`, `chainEventId?`, `receivableRef?`, `tokenContract?`, `sender?`,
`recordedByUserId`.

Indexes: unique `(orgId, number)`; `(orgId, createdAt)`; `(orgId, status)`;
`(orgId, dueDate)`; `(orgId, currency, status, dueDate)`; unique sparse
`receipts.chainEventId`.

Receipts use an optimistic lock on `paidAmount`: the update filter includes the previous
value, so concurrent receipts cannot overpay.

### `ar_collection_quotes`

One 1Click quote per receivable collection attempt. Contract-mode receipts are still
recorded by the collect indexer; treasury-mode quotes are reconciled from their deposit
address.

| Field | Type | Notes |
|---|---|---|
| `orgId`, `receivableId`, `receivableNumber` | string | Indexed. |
| `mode` | `CONTRACT` \| `TREASURY` | Chosen when the quote was created. |
| `source` | `DASHBOARD` \| `SHARE` | Public share quotes are `SHARE`; default `DASHBOARD`. |
| `destinationAddress` | string | Collect contract or treasury account. |
| `destinationAssetId`, `decimals` | | Destination NEP-141 asset and decimals. |
| `originAsset`, `refundTo` | string | 1Click origin inputs. |
| `depositAddress`, `depositMemo`, `correlationId` | string? | 1Click quote result. `depositAddress` is unique. |
| `amount`, `amountFormatted` | string | Destination minor units. |
| `amountIn`, `amountInFormatted`, `originSymbol`, `destinationSymbol` | string? | Origin deposit amount and display symbols. |
| `originChain`, `destinationChain` | string? | Origin/destination blockchain ids from 1Click. |
| `status` | enum | `AWAITING_DEPOSIT`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `REFUNDED`, `UNDERPAID`, `NEEDS_REVIEW`, `OVERPAID`, `EXPIRED`. |
| `originTxHashes[]`, `destinationTxHashes[]` | string[] | From the status poll. |
| `appliedReceiptId`, `appliedAt` | | Set when a treasury delivery is posted to the receivable. |
| `createdByUserId` | string | |

Indexes: unique `depositAddress`; `(orgId, status, createdAt)`; `(receivableId, createdAt)`.
Treasury receipts are idempotent via `receipts.chainEventId = arquote:<quoteId>` and are
capped at the outstanding amount (overpayments set the quote to `OVERPAID`).

---

## Shared documents

### `document_shares`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `documentType` | `bill` \| `invoice` | `bill` = AP invoice collection, `invoice` = AR receivable. |
| `documentId` | string | Document id. |
| `tokenHash` | string | SHA-256 of the bearer token; unique. Raw token is returned once. |
| `expiresAt` | Date | Public link expiry. Indexed. |
| `revokedAt` | Date \| null | Null while active. |
| `createdByUserId` | string | |
| `viewCount` | number | Incremented by public views. |
| `lastViewedAt` | Date \| null | |

Indexes: unique `(orgId, documentType, documentId)` and unique `tokenHash`. One share
record is rotated in place so old links invalidate immediately.

---

## Accounting

### `accounts`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `code`, `name` | string | |
| `type` | `ASSET` \| `LIABILITY` \| `EQUITY` \| `REVENUE` \| `EXPENSE` | |
| `normalBalance` | `debit` \| `credit` | |
| `system` | boolean | Seeded accounts cannot be deleted. Default `true`. |
| `archived` | boolean | Default `false`. |

Unique index: `(orgId, code)`.

### `journal_entries`

Immutable. Corrections are reversal entries.

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `date` | Date | Business date, not insert date. |
| `memo` | string | |
| `sourceType` | `invoice` \| `receivable` \| `receipt` \| `manual` \| `opening` | |
| `sourceId` | string | |
| `event` | `APPROVED` \| `PAID` \| `VOID` \| `ISSUED` \| `RECEIVED` \| `REVERSED` \| `OPENING` \| `MANUAL` | |
| `currency` | string | Per-currency ledger; no FX translation. |
| `decimals` | number | Default 2. |
| `dedupeKey` | string? | Set for system postings only. |
| `reversalOf` | ObjectId? | Points at the reversed entry. |
| `postedByUserId` | string? | |
| `lines[]` | embedded | `accountId`, `accountCode`, `accountName`, `debit`, `credit` (strings). |

`lines` must balance (sum debit = sum credit) and cannot be zero-value. Indexes:
`(orgId, date)`, `(orgId, sourceType, sourceId)`, `(orgId, lines.accountCode, date)`, and
unique partial `(orgId, dedupeKey)` when `dedupeKey` exists.

System dedupe keys: `invoice:<id>:APPROVED|PAID|VOID`,
`receivable:<id>:ISSUED|VOID`, `receipt:<receiptId>:RECEIVED`,
`opening:<orgId>:<currency>`.

---

## Agent

### `agent_wallets`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Unique, indexed. |
| `accountId` | string | |
| `publicKey` | string? | Local wallets only. |
| `provider` | `local` \| `outlayer` | Default `local`. |
| `outlayerWalletId`, `outlayerNetwork`, `outlayerHandoffUrl` | string? | |
| `outlayerApiKeyEncrypted` | string? | AES-256-GCM, `select: false`, never returned or logged. |
| `encryptedSecret` | string? | Local key, `select: false`. |
| `policy` | embedded | `perTxLimitUsd`, `dailyLimitUsd`, `approvalThresholdUsd`, `allowedAssets[]`, `active`. |
| `status` | `ACTIVE` \| `PAUSED` | Default `ACTIVE`. |

### `agent_actions`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `walletId`, `invoiceId` | string | |
| `type` | `PAYMENT` | Default `PAYMENT`. |
| `asset`, `amountUsd` | string | |
| `status` | enum | `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `REJECTED`, `EXECUTED`, `BLOCKED`, `FAILED`, `NEEDS_REVIEW`. |
| `reason` | string? | |
| `policyDecision` | object? | The evaluated policy result. |
| `decidedByUserId` | string? | |
| `paymentId`, `paymentIntentId` | string? | |
| `outlayerRequestId`, `outlayerApprovalId` | string? | |
| `outlayerRequired`, `outlayerApproved` | number? | |
| `executedAt` | Date? | |

Indexes: `(orgId, createdAt)`, `(orgId, status)`.

Execution is claimed atomically (`APPROVED → EXECUTING`). Policy is evaluated at proposal and
again at execution; custody policy is delegated to OutLayer.

### `agent_daily_spend`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `day` | string | UTC day key. |
| `spentCents` | number | Updated with an atomic conditional `$inc`. |

Unique index: `(orgId, day)`.

### `agent_providers`

Seeded specialist agents available to hire. Global registry; no secrets.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique, indexed. |
| `name`, `description` | string | |
| `capability` | string | `tax-review`, `collections-draft`, `receipt-match`. Indexed with `active`. |
| `priceUsd` | string | Fixed per job in this slice. |
| `asset` | string | Default `nep141:usdc.near`. |
| `accountId` | string | Provider payout account; used in the real rail, not the mock demo. |
| `mode` | `local` \| `http` | Local handlers are deterministic and offline. |
| `active` | boolean | |

### `agent_jobs`

One hire of a specialist agent. Replaces nothing in `agent_actions`; it is a separate
economic job with its own result.

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `walletId` | string | Parent agent wallet. |
| `providerId`, `providerName`, `capability` | string | Resolved server-side. |
| `title`, `task` | string | |
| `input` | object? | Provider-specific (invoice number, receivable number). |
| `budgetUsd`, `costUsd`, `asset` | string | `costUsd` is the provider price; the budget is the human-approved ceiling. |
| `kind` | `HIRE` \| `API` | API is reserved for the paid-service slice. |
| `status` | enum | `QUOTED`, `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `PAID`, `DONE`, `BLOCKED`, `FAILED`, `CANCELLED`. |
| `policyDecision` | object? | Per-tx, daily, approval threshold and block reason. |
| `approvedByUserId` | string? | |
| `payment` | object? | `method` (`mock` in this build), `status`, `txHash`, `paidAt`. |
| `result` | object? | Structured provider output. |
| `resultSummary` | string? | Human-readable result used by cards. |
| `error` | string? | |
| `completedAt` | Date? | |

Indexes: `(orgId, createdAt)`, `(orgId, status)`.

Execution is claimed atomically (`APPROVED → EXECUTING`), the daily budget is reserved with
the same `agent_daily_spend` conditional `$inc`, and the reservation is released on failure.
Hires currently settle in mock mode; no on-chain agent-to-agent transfer is claimed.

---

## Chain and operations

### `chain_events`

Normalised on-chain observation, upserted by `(txHash, eventIndex)` so re-polling cannot
duplicate history.

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | Indexed. |
| `paymentId` | string? | Indexed. |
| `txHash` | string | For collect receipts this is the stable `collect:<orgId>:<contract>:<id>` key. |
| `eventIndex` | number | Default 0. |
| `kind` | string | |
| `status` | string? | `SUCCESS` / `IGNORED` for collect receipts. |
| `blockHeight` | number? | |
| `senderAccountId` | string | |
| `payload` | object? | |
| `observedAt` | Date | |

Indexes: unique `(txHash, eventIndex)`, `(orgId, observedAt)`.

### `indexer_cursors`

| Field | Type | Notes |
|---|---|---|
| `key` | string | Unique, indexed. Example `collect:<orgId>:<contractId>`. |
| `value` | number | Last processed receipt id; default `-1`. |

### `collection_deployments`

One-click deploy progress for a workspace `keiz-collect` contract. Contract calls
are idempotent, so a failed deployment can be retried without creating a second
account.

| Field | Type | Notes |
|---|---|---|
| `orgId`, `requestedByUserId` | string | Org comes from the JWT. |
| `status` | enum | `QUEUED`, `DEPLOYING`, `ALLOWLISTING`, `TRANSFERRING`, `VERIFYING`, `ACTIVE`, `FAILED`. |
| `network` | `mainnet` only | Testnet keeps the manual form. |
| `contractId`, `treasury`, `ownerAccountId` | string | `contractId` is `<prefix>.<deployer>`. |
| `assetId`, `tokenContract`, `decimals` | | Resolved server-side from the 1Click token list. |
| `steps` | object | Per-step `status`, `txHash`, `error`, `at`. |
| `txHashes` | string[] | All submitted hashes, in order. |
| `error`, `startedAt`, `finishedAt` | | Failure reason and timing. |

Indexes: `(orgId, createdAt)`; unique partial `(orgId)` while a deployment is
non-terminal, so two clicks cannot deploy two contracts.

### `auth_challenges`

| Field | Type | Notes |
|---|---|---|
| `nonce` | string | Unique, indexed; base64 32-byte nonce and lookup key. |
| `accountId` | string | Indexed. |
| `message`, `recipient` | string | NEP-413 payload. |
| `network` | `mainnet` \| `testnet` | Must match `CHAIN_NETWORK`. |
| `expiresAt` | Date | TTL index deletes the challenge. |
| `used` | boolean | Default `false`; single use. |

### `audit_events`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string? | Indexed. |
| `actorUserId` | string? | Indexed. |
| `accountId` | string? | |
| `action`, `method`, `path` | string | |
| `status` | number | HTTP status. |
| `ip` | string? | |
| `metadata` | object? | No request bodies. |

Index: `(orgId, createdAt)`.

### Mastra chat storage

`mastra_threads` and `mastra_messages` are owned by `@mastra/mongodb` through a second Mongo
client, not by Mongoose. There is no local thread schema. Both clients must point at the same
database name. Semantic recall/vector search is disabled because standalone Mongo has no Atlas
Search; message history works normally.
