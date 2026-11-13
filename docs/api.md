# KEIZ API reference

The NestJS API listens on `:3001`. The browser calls `/api/*`; Next rewrites that to the API so
the httpOnly session cookie stays same-origin. Do not call `:3001` directly from the browser.

Unless marked **Public**, every route requires a valid access-token cookie. The JWT carries
`orgId`, `role`, `sub` (user id) and `accountId`; services never read `orgId` from a body or
query parameter. `JwtAuthGuard` reloads the membership and `tokenVersion` on every request.

Role legend:

| Label | Who can call |
|---|---|
| Public | No session required. |
| Member | Any authenticated membership (OWNER, ADMIN, APPROVER, MEMBER). |
| Approver | APPROVER, ADMIN, OWNER. |
| Admin | ADMIN, OWNER. |
| Owner | OWNER only. |

Defaults: `POST` returns `201`, other methods `200`. Validation and business errors return
`400`; missing session `401`; role failure `403`; missing tenant-scoped row `404`; duplicate
quote or live intent `409`. Rate limits: global 120 req/min, auth challenge/verify/relay
10 req/min, chat messages 20 req/min, AR collection quote 10 req/min.

---

## Auth — `/api/auth`

Requests and responses use httpOnly cookies `keiz_access` (15m) and `keiz_refresh` (7d, rotated
with reuse detection).

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| POST | `/challenge` | Public | `{ accountId, network }` | Creates a one-time NEP-413 challenge (5m TTL, bound to `CHAIN_NETWORK`). |
| POST | `/passkey/signup/options` | Public | `{ accountId, nearPublicKey }` | WebAuthn registration options for a new implicit passkey account. |
| POST | `/passkey/signup/verify` | Public | `{ accountId, nearPublicKey, credential, wrappedSeed, nep413 }` | Verifies WebAuthn + NEP-413 proof of the derived key; creates the user and sets cookies. |
| POST | `/passkey/login/options` | Public | — | Usernameless WebAuthn authentication options. |
| POST | `/passkey/login/verify` | Public | `{ credential, accountId? }` | Verifies the passkey assertion; sets cookies. |
| POST | `/passkey/recovery/verify` | Public | `{ accountId, publicKey, signature, nonce, recipient }` | NEP-413 recovery-key login; issues a session flagged `recovery`. |
| POST | `/passkey/unlock` | Member | `{ credentialId }` | Returns the AES-GCM seed wrap for the caller's credential. |
| GET | `/passkey/credentials` | Member | — | Lists the caller's passkeys (no secrets). |
| POST | `/passkey/credentials` | Member | `{ nearPublicKey, credential, wrappedSeed, nep413 }` | Adds a passkey after proving the seed with NEP-413; for a wallet account the derived key must already be an on-chain full-access key. |
| DELETE | `/passkey/credentials/:id` | Member | `?confirmRecovery=true` | Removes a passkey; the last one requires confirmation. |
| POST | `/verify` | Public | `{ accountId, publicKey, signature, nonce, recipient }` | Wallet NEP-413 login: verifies the signature + full-access key; sets cookies. |
| POST | `/refresh` | Public | — (refresh cookie) | Rotates refresh token; reuse revokes the family. |
| POST | `/logout` | Public | — (refresh cookie) | Clears cookies. |
| GET | `/me` | Public | — | Session object or `{ user: null }`; never 401. |
| GET | `/orgs` | Member | — | Workspaces this user belongs to. |
| POST | `/switch-org` | Member | `{ orgId }` | Verifies membership and reissues cookies. |

## Members — `/api/members`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/` | Member | — | Memberships in the current org. |
| POST | `/` | Admin | `{ accountId, role? }` | Adds an existing NEAR account directly; no invite token. |
| PATCH | `/:userId` | Admin | `{ role }` | Cannot demote the last OWNER. |
| DELETE | `/:userId` | Admin | — | Cannot remove the last OWNER. |

## Organizations — `/api/orgs`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/current` | Member | — | Workspace profile: name, slug, base currency, network, timestamps. |
| PATCH | `/current` | Admin | `{ name?, slug?, baseCurrency? }` | Slug is unique and lowercase-kebab. `baseCurrency` is USD-only; any other value is rejected with 400. |
| GET | `/current/collection` | Member | — | Per-workspace `keiz-collect` config or `null`. |
| PATCH | `/current/collection` | Admin | `{ contractId, treasury, assetId, tokenContract, decimals, status }` | Validates org id, treasury, token allowlist and code hash against RPC before saving. |
| GET | `/current/payments` | Member | — | Effective AR mode (`CONTRACT` / `TREASURY` / `OFF`), treasury, asset and collection status. |
| PATCH | `/current/payments` | Admin | `{ arMode, treasuryAccountId?, arAssetId? }` | Treasury mode requires a treasury account; `arAssetId` must be a `nep141:` asset. |
| GET | `/current/collection/deploy` | Member | — | One-click deploy capabilities: enabled/reason, deployer, supported assets, latest deployment. |
| POST | `/current/collection/deploy` | Admin | `{ assetId, treasury?, prefix? }` | Mainnet only. Queues a `keiz-collect` deploy; one live deployment per workspace. |
| GET | `/current/collection/deploy/:id` | Member | — | Deployment status, steps and transaction hashes. |
| POST | `/current/collection/deploy/:id/retry` | Admin | — | Re-queues a `FAILED` deployment; on-chain steps are idempotent. |

## Vendors — `/api/vendors`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/` | Member | — | Active vendors. |
| POST | `/` | Admin | `{ name, email, nearAccountId?, payoutChain, payoutAddress, bankName?, bankAccount? }` | Address validated for the chain. |
| GET | `/:id` | Member | — | One vendor. |
| PATCH | `/:id` | Admin | Same as create | Full replacement. |
| DELETE | `/:id` | Admin | — | Archives (`status: ARCHIVED`). |

## Bills (AP) — `/api/invoices`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/` | Member | `?status=&vendorId=&from=&to=&dateField=` | Org-scoped list. `dateField` is `issueDate` (default), `dueDate` or `createdAt`. |
| GET | `/summary` | Member | — | Counts/totals for the dashboard. |
| GET | `/:id` | Member | — | One bill with approvals. |
| POST | `/` | Member | `{ vendorId, number?, issueDate?, dueDate, currency?, taxBps?, notes?, lineItems[] }` | Creates a DRAFT; totals recomputed server-side. `number` is optional — the API assigns `BIL-YY/MM/XXXXX` from the issue-date month. An explicit number is accepted for imports. |
| PATCH | `/:id` | Member | Same as create, minus `number` | DRAFT only; the document number is immutable. |
| POST | `/:id/submit` | Member | — | DRAFT → SUBMITTED. |
| POST | `/:id/decision` | Approver | `{ decision: "APPROVE"\|"REJECT", comment? }` | Separation of duties: creator cannot approve once another approver exists. |
| POST | `/:id/void` | Admin | — | Posts a reversal; never edits the journal. |

## Payments — `/api/payments`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/` | Member | `?invoiceId=&from=&to=` | Payment history. |
| GET | `/open` | Member | — | `AWAITING_DEPOSIT`/`PROCESSING` payments. |
| GET | `/tokens` | Member | — | Cached 1Click token list (or mock list). |
| GET | `/:id` | Member | — | One payment. |
| GET | `/:id/events` | Member | — | Append-only `payment_events`. |
| POST | `/` | Member | `{ invoiceId, originAsset?, destinationAsset?, slippageBps?, payer?, idempotencyKey? }` | Dry quote then committed `EXACT_OUTPUT` quote; reserves a PaymentIntent. |
| POST | `/:id/deposit` | Member | `{ txHash }` | Verifies the deposit on NEAR RPC in `intents` mode, then submits to 1Click. |
| POST | `/:id/refresh` | Member | — | Polls the provider once. OutLayer custody payments return 400; their poller refreshes them automatically. |
| POST | `/:id/cancel` | Admin | — | `AWAITING_DEPOSIT` only; marks `EXPIRED`. |
| POST | `/:id/simulate` | Admin | `?status=SUCCEEDED\|FAILED\|REFUNDED` | Mock + non-production only. |

## Customers — `/api/customers`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/` | Member | `?includeArchived=true&q=` | Active by default. |
| GET | `/:id` | Member | — | One customer with contact details. |
| POST | `/` | Member | `{ name, email, taxId?, billingAddress? }` | |
| PATCH | `/:id` | Admin | Same as create | |
| DELETE | `/:id` | Admin | — | Archives. |
| POST | `/:id/restore` | Admin | — | Restores an archived customer. |

## Receivables (AR) — `/api/receivables`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/` | Member | `?status=&customerId=&currency=&from=&to=&dateField=` | `dateField` is `issueDate` (default), `dueDate` or `createdAt`. |
| GET | `/summary` | Member | `?currency=&from=&to=&dateField=` | Outstanding/overdue totals; honors the same date filter. |
| GET | `/:id` | Member | — | One receivable with receipts. |
| POST | `/` | Member | `{ customerId, number?, issueDate?, dueDate, currency?, taxBps?, notes?, lineItems[] }` | Creates a DRAFT. `number` is optional — the API assigns `INV-YY/MM/XXXX` from the issue-date month. An explicit number is accepted for imports. |
| POST | `/:id/collection-quote` | Member | `{ originAsset, refundTo }` | 1Click quote. `CONTRACT` mode uses the collect contract + `customRecipientMsg`; `TREASURY` delivers to the workspace treasury. |
| POST | `/:id/issue` | Member | — | DRAFT → ISSUED; posts AR/revenue/tax. |
| POST | `/:id/receipts` | Approver | `{ amount, receivedAt?, method?, reference?, txHash?, chainEventId?, receivableRef?, tokenContract?, sender? }` | Optimistic lock on `paidAmount`; posts cash/AR. |
| POST | `/:id/void` | Admin | — | Posts a reversal. |

## Shared documents — `/api/documents`, `/api/public/documents`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/documents/:type/:id/pdf` | Member | — | Authenticated PDF for `type=bill\|invoice`. |
| GET | `/documents/:type/:id/share` | Member | — | Active-link metadata; never returns the token. |
| POST | `/documents/:type/:id/share` | Approver | `{ expiresInDays? }` | Creates or rotates the hashed public token. |
| DELETE | `/documents/:type/:id/share` | Approver | — | Revokes the link immediately. |
| GET | `/public/documents/:token` | Public | — | Sanitized document JSON; rate limited. |
| GET | `/public/documents/:token/pdf` | Public | — | Public PDF; rate limited. |
| GET | `/public/documents/:token/pay` | Public | — | Payment options for an invoice share: mode, amount due, USDC/USDT assets, open quote. |
| POST | `/public/documents/:token/pay` | Public | `{ originAsset, refundTo }` | Creates (or reuses) a 1Click quote scoped to the share token. Invoices only, 5/min. |
| GET | `/public/documents/:token/pay/:quoteId` | Public | — | Quote status + receivable paid state; quote must belong to the share. |

`bill` maps to the AP `invoices` collection, `invoice` to AR `receivables`. Public
responses exclude approvals, ledger entries, payment details, payout/bank details and
any internal ids. Public payment routes accept no org or receivable ids; the share token
resolves both. Bills are not payable from a share link.

## Accounting — `/api/accounting`

| Method | Path | Role | Query / body | Notes |
|---|---|---|---|---|
| GET | `/accounts` | Member | — | Per-org chart of accounts. |
| GET | `/summary` | Member | `?currency=&from=&to=` | |
| GET | `/trial-balance` | Member | `?currency=&asOf=` | Must balance. |
| GET | `/journal-entries` | Member | `?currency=&accountCode=&sourceType=&sourceId=&q=&page=&pageSize=` | Immutable journal. `sourceType` also accepts `expense` and `revenue`. Returns `{ items, page, pageSize, total, totalPages }`. |
| GET | `/journal-entries/export` | Member | `?currency=&from=&to=&accountCode=&sourceType=&sourceId=&q=&format=csv` | Exports all matching ledger lines as CSV, including the optional document `number`. |
| POST | `/journal-entries` | Admin | `{ date?, memo, currency?, lines[] }` | Manual balanced entry. |
| GET | `/expenses` | Member | `?currency=&from=&to=` | Direct expenses, newest first. Each entry carries an `EXP-YY/MM/XXXXX` number. |
| POST | `/expenses` | Admin | `{ date?, amount, currency?, accountCode, cashAccountCode?, memo }` | Debits the expense account and credits cash; posts to the journal. |
| GET | `/revenues` | Member | `?currency=&from=&to=` | Direct revenue, newest first. Each entry carries a `REV-YY/MM/XXXX` number. |
| POST | `/revenues` | Admin | `{ date?, amount, currency?, accountCode, cashAccountCode?, memo }` | Debits cash and credits the revenue account; posts to the journal. |
| GET | `/aging` | Member | `?side=AP\|AR&currency=` | |
| GET | `/reports` | Member | `?currency=&from=&to=` | Cash flow, P&L and balance sheet for a period. |
| GET | `/reports/export` | Member | `?currency=&from=&to=&format=pdf\|xlsx\|csv&report=cash-flow\|profit-and-loss\|balance-sheet\|all` | Downloads one statement or the full report pack. `report` defaults to `all`, `format` to `pdf`. |
| POST | `/rebuild` | Admin | — | Idempotent backfill of missing system postings. |

## Agent wallet — `/api/agent`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/wallet` | Member | — | Wallet, balances, policy; never returns secrets. |
| POST | `/wallet` | Admin | — | Get or create the org wallet (custody when `OUTLAYER_ENABLED=true`). |
| POST | `/wallet/custody` | Owner | — | Upgrade a local wallet to OutLayer custody. |
| PATCH | `/wallet/policy` | Owner | `{ perTxLimitUsd, dailyLimitUsd, approvalThresholdUsd, allowedAssets[], active }` | Local wallets only; custody policy returns 400. |
| GET | `/stats` | Member | — | Spend/action counters. |
| GET | `/actions` | Member | — | Action history. |
| POST | `/actions` | Member | `{ invoiceId, asset, reason? }` | Creates a proposal; custody proposals are auto-approved. |
| POST | `/actions/:id/decision` | Admin | `?decision=APPROVE\|REJECT` | |
| POST | `/actions/:id/execute` | Admin | — | Atomic `APPROVED → EXECUTING`; custody runs `withdrawDryRun` first. |
| GET | `/providers` | Member | — | Seeded specialist agents, capabilities and prices. |
| GET | `/jobs` | Member | — | Recent agent hires for this org. |
| GET | `/jobs/:id` | Member | — | One hire with policy decision, payment, result and error. |
| POST | `/jobs` | Admin | `{ provider, task, budgetUsd?, input? }` | Creates a hire. Above the approval threshold it is `PENDING_APPROVAL`; otherwise `APPROVED`. |
| POST | `/jobs/:id/approve` | Admin | — | `PENDING_APPROVAL → APPROVED`. |
| POST | `/jobs/:id/execute` | Admin | — | Atomic `APPROVED → EXECUTING`; re-checks policy, reserves daily spend and runs the provider. |
| POST | `/jobs/:id/cancel` | Admin | — | Cancels a quoted, pending or approved hire. |

Agent hires reuse the same `agent_wallets` policy and `agent_daily_spend` reservation as
payment proposals. The current build settles hires in **mock** mode; the job records
`payment.method = "mock"`, and no on-chain transfer is claimed.

## Chat — `/api/chat`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| POST | `/messages` | Member | `{ message, threadId? }` | SSE stream. Events: `meta`, `thread`, `plan`, `card`, `approval`, `approval_result`, `text`, `tool` (`phase: call\|result`), `suspended` (via `done.suspended`), `done`, `error`. |
| GET | `/approvals` | Member | `?threadId=` | Pending tool approvals for a thread; tenant-scoped. |
| POST | `/approvals` | Member | `{ runId, threadId, toolCallId, approved, reason? }` | Approves or declines a suspended tool call and streams the continuation (SSE). |
| GET | `/threads` | Member | — | Mastra threads for this user/org. |
| GET | `/threads/:id` | Member | — | Thread with messages. |
| DELETE | `/threads/:id` | Member | — | Deletes the thread. |

Every request that needs tools first emits `plan-actions`, then suspends for the plan approval.
After the plan is approved, read-only tools run automatically; write/drafting and spend tools
(`propose-payment`, `create-vendor`, `create-customer`, `create-bill`, `create-receivable`,
`hire-agent`) suspend for an explicit approve/decline. The stream ends with
`done.suspended: true` while an approval is pending.
`card` events carry the detailed `ChatCard` envelope used by the custom UI; every card has a
`link` to the relevant detail page.

Tool calls receive `orgId` from the request context, never from model output. Chat can create
records, hire agents within policy, and create payment proposals, but it cannot approve bills,
execute payments or move funds.

## Indexer — `/api/indexer`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/events` | Member | — | `chain_events` for the org. |
| POST | `/backfill/:paymentId` | Admin | — | Re-read a payment's source transaction. |
| POST | `/collect` | Admin | — | Immediate collect sync; iterates every org with an ACTIVE collection. |

The worker's `syncAll` job also polls open `ar_collection_quotes` and records treasury
deliveries as `ONCHAIN` receipts. Run `pnpm worker` for both.

## Audit and demo

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/audit` | Admin | Append-only mutating-request log (no bodies). |
| POST | `/api/demo/seed` | Owner | Hidden in production unless `DEMO_SEED_ENABLED=true`. Seeds vendors, bills, receivables, direct expenses/revenue and calls ledger rebuild. |

## Health

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | `{ ok, paymentsMode, demoSeedEnabled, ... }`; used by probes and the dashboard’s demo-seed button. |

---

## Conventions

- **Tenant scoping:** every Mongo query filters on `orgId` from the JWT. IDs in paths are
  still checked against `orgId`, so another tenant's id returns 404.
- **Money:** integer minor units as strings. `formatDollars` takes major units;
  `formatMoney` takes minor units. Never use `Number` on a monetary value.
- **Idempotency:** payments accept an optional `idempotencyKey`; system journal postings use a
  deterministic `dedupeKey`; AR receipts use `chainEventId`.
- **No destructive accounting:** journal entries are never updated or deleted. Corrections are
  reversal entries.
