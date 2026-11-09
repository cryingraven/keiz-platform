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
| POST | `/near-auth/relay` | Public | `{ receiverId, methodName: "sign", argsBase64, gas, deposit }` | Submits `fast-auth.sign`; contract/guard/gas/deposit allowlisted, fails closed when unconfigured. |
| POST | `/verify` | Public | `{ accountId, publicKey, signature, nonce, recipient }` | Verifies NEP-413 + full-access key; sets cookies. |
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
| GET | `/current/collection` | Member | — | Per-workspace `keiz-collect` config or `null`. |
| PATCH | `/current/collection` | Admin | `{ contractId, treasury, assetId, tokenContract, decimals, status }` | Validates org id, treasury, token allowlist and code hash against RPC before saving. |

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
| GET | `/` | Member | `?status=&vendorId=` | Org-scoped list. |
| GET | `/summary` | Member | — | Counts/totals for the dashboard. |
| GET | `/:id` | Member | — | One bill with approvals. |
| POST | `/` | Member | `{ vendorId, number, issueDate?, dueDate, currency?, taxBps?, notes?, lineItems[] }` | Creates a DRAFT; totals recomputed server-side. |
| PATCH | `/:id` | Member | Same as create | DRAFT only. |
| POST | `/:id/submit` | Member | — | DRAFT → SUBMITTED. |
| POST | `/:id/decision` | Approver | `{ decision: "APPROVE"\|"REJECT", comment? }` | Separation of duties: creator cannot approve once another approver exists. |
| POST | `/:id/void` | Admin | — | Posts a reversal; never edits the journal. |

## Payments — `/api/payments`

| Method | Path | Role | Body / query | Notes |
|---|---|---|---|---|
| GET | `/` | Member | `?invoiceId=` | Payment history. |
| GET | `/open` | Member | — | `AWAITING_DEPOSIT`/`PROCESSING` payments. |
| GET | `/tokens` | Member | — | Cached 1Click token list (or mock list). |
| GET | `/:id` | Member | — | One payment. |
| GET | `/:id/events` | Member | — | Append-only `payment_events`. |
| POST | `/` | Member | `{ invoiceId, originAsset?, destinationAsset?, slippageBps?, payer?, idempotencyKey? }` | Dry quote then committed `EXACT_OUTPUT` quote; reserves a PaymentIntent. |
| POST | `/:id/deposit` | Member | `{ txHash }` | Verifies the deposit on NEAR RPC in `intents` mode, then submits to 1Click. |
| POST | `/:id/refresh` | Member | — | Polls the provider once. |
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
| GET | `/` | Member | `?status=&customerId=&currency=` | |
| GET | `/summary` | Member | `?currency=` | Outstanding/overdue totals. |
| GET | `/:id` | Member | — | One receivable with receipts. |
| POST | `/` | Member | `{ customerId, number, issueDate?, dueDate, currency?, taxBps?, notes?, lineItems[] }` | Creates a DRAFT. |
| POST | `/:id/collection-quote` | Member | `{ originAsset, refundTo }` | 1Click quote to the workspace collect contract with `customRecipientMsg`. |
| POST | `/:id/issue` | Member | — | DRAFT → ISSUED; posts AR/revenue/tax. |
| POST | `/:id/receipts` | Approver | `{ amount, receivedAt?, method?, reference?, txHash?, chainEventId?, receivableRef?, tokenContract?, sender? }` | Optimistic lock on `paidAmount`; posts cash/AR. |
| POST | `/:id/void` | Admin | — | Posts a reversal. |

## Accounting — `/api/accounting`

| Method | Path | Role | Query / body | Notes |
|---|---|---|---|---|
| GET | `/accounts` | Member | — | Per-org chart of accounts. |
| GET | `/summary` | Member | `?currency=&from=&to=` | |
| GET | `/trial-balance` | Member | `?currency=&asOf=` | Must balance. |
| GET | `/journal-entries` | Member | `?currency=&accountCode=&sourceType=&sourceId=&limit=` | Immutable journal. |
| POST | `/journal-entries` | Admin | `{ date?, memo, currency?, lines[] }` | Manual balanced entry. |
| GET | `/aging` | Member | `?side=AP\|AR&currency=` | |
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
After the plan is approved, read-only tools run automatically; only write/drafting tools
(`propose-payment`, and any future `write`/`spend` tool) suspend for an explicit
approve/decline. The stream ends with `done.suspended: true` while an approval is pending.
`card` events carry the detailed `ChatCard` envelope used by the custom UI; every card has a
`link` to the relevant detail page.

Tool calls receive `orgId` from the request context, never from model output. Chat can create
payment proposals but cannot execute them.

## Indexer — `/api/indexer`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| GET | `/events` | Member | — | `chain_events` for the org. |
| POST | `/backfill/:paymentId` | Admin | — | Re-read a payment's source transaction. |
| POST | `/collect` | Admin | — | Immediate collect sync; iterates every org with an ACTIVE collection. |

## Audit and demo

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/audit` | Admin | Append-only mutating-request log (no bodies). |
| POST | `/api/demo/seed` | Owner | Non-production only; writes demo data and calls ledger rebuild. |

## Health

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | `{ ok, paymentsMode, ... }`; used by the smoke test and probes. |

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
