# KEIZ — Technical Architecture

This document is the map of how KEIZ is wired: runtimes, trust boundaries, the
invoice and payment state machines, and the three login/settlement/agent flows.
Diagrams are Mermaid and render on GitHub.

- **Web** — Next.js 16 App Router, React 19, Tailwind 4
- **API** — NestJS 12, Mongoose 9, MongoDB
- **Chain** — NEAR RPC, NEAR Intents 1Click, NEAR Auth (FastAuth), OutLayer custody, NEAR AI Cloud

---

## 1. System context

```mermaid
flowchart LR
  subgraph Client["Browser"]
    UI["Next.js App Router"]
    WalletUI["near-connect / NEAR Auth SDK"]
  end

  subgraph Edge["Next.js server"]
    Proxy["/api/* rewrite<br/>security headers"]
  end

  subgraph API["NestJS 12 API"]
    Guards["JWT · Roles · Rate limit · Audit"]
    AuthMod["Auth"]
    UsersMod["Users · Members · Orgs"]
    Ops["Invoices (AP) · Vendors"]
    ARMod["Receivables (AR) · Customers"]
    AccMod["Accounting · Journal"]
    PayMod["Payments · Intents"]
    AgentMod["Agent"]
    OutMod["OutLayer adapter"]
    ChatMod["Chat + Mastra"]
    Idx["Indexer"]
    AuditMod["Audit"]
    QueueMod["Queue producer"]
  end

  DB[("MongoDB")]
  RPC[("NEAR RPC")]
  OneClick["NEAR Intents 1Click"]
  OutLayer["OutLayer custody<br/>Intel TDX + NEAR MPC"]
  NEARAI["NEAR AI Cloud"]
  Auth0["Auth0 + NEAR Auth"]
  Relayer["NEAR Auth relayer"]

  UI --> Proxy
  WalletUI --> Proxy
  Proxy --> Guards
  Guards --> AuthMod
  Guards --> UsersMod
  Guards --> Ops
  Guards --> ARMod
  Guards --> AccMod
  Guards --> PayMod
  Guards --> AgentMod
  Guards --> ChatMod
  Guards --> Idx
  Guards --> AuditMod

  AuthMod --> Auth0
  AuthMod --> Relayer
  Relayer --> Auth0
  AuthMod --> RPC

  UsersMod --> DB
  Ops --> DB
  ARMod --> DB
  AccMod --> DB
  PayMod --> DB
  PayMod --> OneClick
  PayMod --> RPC
  AuditMod --> DB

  AgentMod --> DB
  AgentMod --> OutMod
  OutMod --> OutLayer

  ChatMod --> NEARAI
  ChatMod --> DB

  Idx --> RPC
  Idx --> DB

  PayMod -.-> QueueMod
  OutMod -.-> QueueMod
  Idx -.-> QueueMod
  AuthMod -.-> QueueMod
```

---

## 2. Monorepo map

```mermaid
flowchart TB
  subgraph Web["apps/web"]
    Login["/login<br/>NEAR Auth + wallets"]
    Dash["/dashboard<br/>overview · bills · receivables<br/>customers · vendors · team"]
    Ops["payments · accounting · agent<br/>audit · settings · assistant"]
    Lib["lib/auth · lib/near-auth<br/>lib/chat-stream · lib/api · lib/csv"]
  end

  subgraph Shared["packages/shared"]
    Schemas["Zod schemas"]
    Money["money.ts<br/>parseUnits / formatUnits"]
    Status["status enums"]
    SSE["SSE parser"]
  end

  subgraph Api["apps/api"]
    Auth["auth"]
    Users["users · members · orgs"]
    Inv["invoices (AP) · vendors"]
    AR["receivables (AR) · customers"]
    Books["accounting"]
    Payments["payments · intents"]
    Agent["agent"]
    Outlayer["outlayer"]
    Chat["chat"]
    Indexer["indexer"]
    Queues["queues (producer)"]
    Audit["audit"]
    Demo["demo"]
  end

  subgraph Worker["apps/api worker"]
    Jobs["payments · outlayer<br/>indexer · near-auth"]
  end

  Web --> Shared
  Api --> Shared
  Queues --> Jobs
```

Web routes (App Router, client-rendered):

| Route | Purpose |
|---|---|
| `/` | Landing page. |
| `/login` | The only sign-in entry: NEAR Auth card + NEAR wallet selector. |
| `/dashboard` | Overview. |
| `/dashboard/invoices`, `/dashboard/invoices/[id]` | AP bills and detail (approve, quote, pay). |
| `/dashboard/receivables`, `/dashboard/receivables/[id]` | AR invoices, receipts and collection quote. |
| `/dashboard/customers`, `/dashboard/customers/[id]` | Customers and their receivables. |
| `/dashboard/vendors`, `/dashboard/vendors/[id]` | Vendors, payout details and bills. |
| `/dashboard/team` | Members and roles. |
| `/dashboard/payments`, `/dashboard/payments/[id]` | Payment history, open quotes and payment timeline. |
| `/dashboard/accounting` | Journal, trial balance, aging, manual entry. |
| `/dashboard/agent` | Agent wallet, policy, actions and custody handoff. |
| `/dashboard/audit` | Append-only audit log (ADMIN/OWNER). |
| `/dashboard/settings` | AR collection contract config and workspace settings. |
| `/dashboard/chat` | Full-page assistant (also available as a drawer). |
| `/privacy`, `/terms` | Legal pages. |

---

## 3. Request lifecycle

Every browser call goes through the Next proxy, so the httpOnly session cookie
stays same-origin. The global guards run before any controller.

```mermaid
flowchart TD
  A["Browser fetch /api/..."] --> B["Next rewrite → Nest :3001"]
  B --> C{"JwtAuthGuard"}
  C -->|no or invalid| D["401"]
  C -->|valid| E["Load membership + tokenVersion"]
  E --> F{"RolesGuard"}
  F -->|role not allowed| G["403"]
  F -->|allowed| H{"Throttler"}
  H -->|over limit| I["429"]
  H -->|ok| J["Controller"]
  J --> K["Service: orgId from JWT"]
  K --> L[("MongoDB")]
  K --> M["External API"]
  L --> N["AuditInterceptor<br/>mutating requests only"]
  M --> N
```

---

## 4. Authentication

### 4.1 NEAR Auth (Auth0 + MPC)

Auth0 handles passkey/Google/Apple/email login. The browser SDK derives the
MPC key, requests a NEP-413 message signature, and builds the `sign` action.
The API relayer submits it to `fast-auth`; only the configured contract and
`jwt#https://<auth0-domain>/` guard are accepted, with a 1 yoctoNEAR deposit.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant N as Auth0
  participant A as API
  participant F as fast-auth contract
  participant P as NEAR RPC

  U->>W: Continue with NEAR Auth
  W->>N: login (passkey / social / email)
  N-->>W: session + signing JWT
  W->>A: POST /auth/challenge
  A-->>W: message · recipient · nonce TTL 5m
  W->>N: requestMessageSignature (NEP-413)
  N-->>W: JWT with signed message payload
  W->>A: POST /auth/near-auth/relay (sign action)
  A->>F: sign via funded relayer
  F-->>A: SuccessValue = MPC signature
  A-->>W: successValue
  W->>A: POST /auth/verify
  A->>P: view_account + view_access_key
  Note over A,P: UNKNOWN_ACCOUNT + implicit hex is allowed once
  A-->>W: access + refresh cookies
```

### 4.2 Wallet (NEP-413)

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant C as near-connect
  participant A as API
  participant P as NEAR RPC

  U->>W: NEAR Wallets
  W->>C: connect
  C-->>W: wallet + account
  W->>A: POST /auth/challenge
  A-->>W: message · recipient · nonce
  W->>C: signMessage NEP-413
  C-->>W: signature + publicKey
  W->>A: POST /auth/verify
  A->>P: view_access_key permission check
  A-->>W: access + refresh cookies
```

NEP-413 payload: Borsh `tag(2^31+413) || message || nonce[32] || recipient || Option<callback>`
→ SHA-256 → Ed25519. Nonces are single-use and TTL-indexed.

---

### 4.3 On-chain AR/AP contracts

`contracts/keiz-collect` receives NEP-141 customer payments and records them by
receivable reference. 1Click can deliver cross-chain AR by sending
`ft_transfer_call` with `customRecipientMsg = {"receivableRef":"AR-2001"}`.

`contracts/keiz-vault` is the AP treasury. It checks policy at proposal and again
at execution, requires M-of-N approval, and can pay either a vendor directly or
a committed 1Click deposit address for cross-chain payouts. The intended split is
that the API coordinates the 1Click quote/status while the contract only moves
NEP-141 tokens; that wiring is not implemented yet, so the vault is operated
separately. The NEAR Auth relayer remains restricted to `fast-auth.sign` and is
not used for treasury calls.

### 4.4 Payment intents and rails

`PaymentIntent` is the single live payment obligation for an invoice. It records
the chosen rail (`oneclick`, `outlayer`, `vault`) and is unique for
`OPEN`/`EXECUTING` states. `PaymentAttempt` records each rail execution. A rail
must reserve an intent before moving funds; terminal payment status updates the
intent and attempts atomically. This is the cross-rail double-payment guard.

`oneclick` and `outlayer` are executed today. `vault` is **reserved**: the enum value and
indexes exist, but `InvoicesService`/`PaymentsService` have no vault execution path yet. Do
not treat a `vault` intent as a live payment until that wiring lands.

```mermaid
stateDiagram-v2
  [*] --> OPEN: reserve
  OPEN --> EXECUTING: rail claims
  OPEN --> CANCELLED: quote cancelled
  EXECUTING --> SETTLED: rail reports success
  EXECUTING --> FAILED: rail reports failure
  EXECUTING --> CANCELLED: abandoned
```

## 5. Invoice and 1Click settlement

The invoice is approved first, then a quote is committed. The deposit is signed
in the user's wallet. In `intents` mode the API verifies the transaction against
NEAR RPC before forwarding it to 1Click.

```mermaid
sequenceDiagram
  autonumber
  actor F as Finance
  participant W as Web
  participant A as API
  participant OC as 1Click
  participant NW as NEAR wallet
  participant P as NEAR RPC
  participant DB as MongoDB

  F->>W: Approve invoice
  F->>W: Get a quote
  W->>A: POST /payments
  A->>OC: GET /v0/tokens
  A->>OC: POST /v0/quote dry=true
  A->>OC: POST /v0/quote dry=false
  OC-->>A: deposit address + deadline
  A->>DB: payment AWAITING_DEPOSIT + events
  A-->>W: quote + deposit address

  F->>NW: sign ft_transfer 1 yoctoNEAR
  NW-->>W: tx hash
  W->>A: POST /payments/:id/deposit
  A->>P: tx sender · receiver · amount · success
  A->>OC: POST /v0/deposit/submit
  A->>DB: payment PROCESSING

  loop poll every 4s
    A->>OC: GET /v0/status
    OC-->>A: status
  end

  A->>DB: payment SUCCEEDED
  A->>DB: invoice PAID
```

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> SUBMITTED: submit
  SUBMITTED --> APPROVED: approve
  SUBMITTED --> REJECTED: reject
  APPROVED --> PAYMENT_PENDING: quote committed
  PAYMENT_PENDING --> PAID: settlement succeeded
  PAYMENT_PENDING --> APPROVED: failed or refunded or expired
  DRAFT --> VOID
  SUBMITTED --> VOID
  APPROVED --> VOID
```

```mermaid
stateDiagram-v2
  [*] --> AWAITING_DEPOSIT: 1Click quote committed
  AWAITING_DEPOSIT --> PROCESSING: verified deposit
  AWAITING_DEPOSIT --> EXPIRED: deadline or cancel
  [*] --> PROCESSING: custody withdraw accepted
  PROCESSING --> SUCCEEDED
  PROCESSING --> FAILED
  PROCESSING --> REFUNDED
  PROCESSING --> UNDERPAID
  PROCESSING --> NEEDS_REVIEW
```

`QUOTED` belongs to `PaymentIntent`, not `Payment`: the committed quote is persisted directly
as `AWAITING_DEPOSIT`. A 1Click `SUCCESS` without a destination transaction hash is stored as
`NEEDS_REVIEW`, not `SUCCEEDED`.

---

## 5.1 AP, AR and the ledger

Bills and customer invoices are subledgers; the journal is the accounting source of truth.
Mongo is a single node, so a status change and its journal entry cannot be atomic. The API
commits the business state first, posts with a deterministic `dedupeKey`, and exposes an
idempotent `rebuild` for any gap. Journal entries are immutable; a void posts a reversal.

```mermaid
sequenceDiagram
  autonumber
  actor F as Finance
  participant A as API
  participant S as Subledger
  participant L as Accounting
  participant DB as MongoDB

  F->>A: Approve vendor bill
  A->>S: status APPROVED
  A->>L: postApApproved
  L->>DB: journal entry · invoice:id:APPROVED

  F->>A: Settle vendor payment
  A->>S: status PAID
  A->>L: postApPaid
  L->>DB: journal entry · invoice:id:PAID

  F->>A: Issue customer invoice
  A->>S: status ISSUED
  A->>L: postArIssued
  L->>DB: journal entry · receivable:id:ISSUED

  F->>A: Record receipt
  A->>S: receipt + paidAmount
  A->>L: postArReceipt
  L->>DB: journal entry · receipt:id:RECEIVED
```

| Event | Debit | Credit |
|---|---|---|
| Vendor bill approved | 5100 Operating expenses (subtotal), 1300 Input tax (tax) | 2000 Accounts payable (total) |
| Vendor bill paid | 2000 Accounts payable | 1010 Cash & stablecoins |
| Vendor bill voided | 2000 Accounts payable | 5100 Operating expenses, 1300 Input tax |
| Customer invoice issued | 1100 Accounts receivable (total) | 4000 Revenue (subtotal), 2100 Tax payable (tax) |
| Customer receipt | 1010 Cash & stablecoins | 1100 Accounts receivable |
| Customer invoice voided | 4000 Revenue, 2100 Tax payable | 1100 Accounts receivable |
| Manual journal | chosen | chosen (must balance) |
| Opening balance | 1010 Cash & stablecoins | 3000 Retained earnings |

Balances are computed with `$toDecimal` over integer minor-unit strings. Reports are kept
per currency: there is no FX translation, matching the payment limitation. Trial balance,
P&L, AP/AR aging and the journal are served by `accounting`.

---

## 6. Agent custody (OutLayer)

Custody wallets are TEE-held. KEIZ stores only an encrypted API key. The policy
is encrypted on-chain and evaluated inside the TEE before every signature.

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  participant W as Web
  participant A as API
  participant OL as OutLayer
  participant TEE as Intel TDX
  participant P as NEAR / Intents
  participant DB as MongoDB

  O->>W: Enable custody / create wallet
  W->>A: POST /agent/wallet
  A->>OL: POST /register
  OL-->>A: wallet id · API key · handoff
  A->>A: encrypt API key AES-256-GCM
  A->>DB: AgentWallet provider=outlayer

  O->>W: Propose payment
  W->>A: POST /agent/actions
  A->>DB: AgentAction APPROVED (delegated)

  O->>W: Execute
  W->>A: POST /agent/actions/:id/execute
  A->>OL: withdrawDryRun
  OL->>TEE: decrypt policy + check limits
  TEE-->>OL: allowed
  A->>OL: withdraw with idempotency key
  OL->>TEE: sign transfer
  TEE-->>OL: signed
  OL->>P: broadcast
  OL-->>A: request_id or pending_approval
  A->>DB: Payment provider=outlayer PROCESSING

  loop queued poll: 2s, then 5s / 30s / 5m backoff
    A->>OL: GET /wallet/v1/requests/:id
    OL-->>A: processing or success or failed
  end

  A->>DB: Payment SUCCEEDED
  A->>DB: Invoice PAID
```

```mermaid
stateDiagram-v2
  [*] --> PENDING_APPROVAL: local policy threshold
  [*] --> APPROVED: custody proposal or auto-approved
  PENDING_APPROVAL --> APPROVED: human approval
  PENDING_APPROVAL --> REJECTED
  APPROVED --> EXECUTING: atomic claim
  EXECUTING --> EXECUTED: rail/request succeeded
  EXECUTING --> BLOCKED: local policy or daily cap
  EXECUTING --> FAILED: rail reports failed/refunded
  EXECUTING --> NEEDS_REVIEW: side effect may have happened
  EXECUTING --> APPROVED: error before any side effect
```

---

## 7. AI assistant

The Mastra agent is server-side. Every tool receives `orgId` from the request
context; the model never chooses the tenant. Chat can create proposals but has
no path to move funds.

The agent is plan-first and human-in-the-loop:

1. `plan-actions` is the only tool allowed before a plan is approved. A
   `beforeToolCall` hook blocks every other tool until `planApproved` is set.
2. Read-only tools run automatically after plan approval. Write/drafting tools
   (`propose-payment`, plus future `write`/`spend` tools) use
   `requireApproval: true`; Mastra suspends and emits `tool-call-approval`, the API
   maps it to an SSE `approval` event, and the UI renders a custom confirmation card.
3. `POST /chat/approvals` verifies the suspended run belongs to the caller via
   `listSuspendedRuns({ threadId, resourceId })`, then calls
   `approveToolCall` / `declineToolCall` and streams the continuation.
4. Tool results are validated against Zod `outputSchema`s and emitted as
   `card` events. Every card has a link to the relevant detail page.

```mermaid
sequenceDiagram
  autonumber
  participant W as Web
  participant A as API
  participant M as Mastra agent
  participant T as Tools
  participant DB as MongoDB
  participant AI as NEAR AI Cloud

  W->>A: POST /chat/messages
  A->>M: agent.stream(requestContext, plan gate)
  M->>AI: chat completion
  AI-->>M: call plan-actions
  M-->>A: tool-call-approval (suspended)
  A-->>W: SSE plan + approval · done(suspended)
  W->>A: POST /chat/approvals (approve plan)
  A->>M: approveToolCall
  M->>T: execute plan-actions
  T-->>M: plan card (gate opens)
  M->>AI: plan result
  AI-->>M: call list-invoices (read)
  M->>T: execute read tool
  T->>DB: scoped query by orgId
  DB-->>T: rows
  T-->>M: typed card envelope
  A-->>W: SSE card (hidden until final)
  M->>AI: tool result
  AI-->>M: final answer
  M-->>A: text + tool chunks
  A-->>W: SSE card · text · tool · done

  Note over W,A: Writes (propose-payment) still suspend for approval.

```

Without `NEARAI_API_KEY`, the deterministic local provider runs the same tools
through an in-memory `LocalRunStore` and emits the same plan/approval/card
protocol, so the demo and tests stay offline.

---

## 8. Data model

Application collections are owned by Mongoose. Mastra owns its own
`mastra_threads` / `mastra_messages` collections through a second Mongo client.

```mermaid
erDiagram
  ORGANIZATION ||--o{ MEMBERSHIP : has
  USER ||--o{ MEMBERSHIP : joins
  ORGANIZATION ||--o{ VENDOR : owns
  ORGANIZATION ||--o{ INVOICE : owns
  VENDOR ||--o{ INVOICE : bills
  INVOICE ||--o{ PAYMENT : paid_by
  PAYMENT ||--o{ PAYMENT_EVENT : emits
  INVOICE ||--o{ PAYMENT_INTENT : reserves
  PAYMENT_INTENT ||--o{ PAYMENT_ATTEMPT : attempts
  PAYMENT_INTENT ||--o| PAYMENT : links
  ORGANIZATION ||--o{ CUSTOMER : owns
  CUSTOMER ||--o{ RECEIVABLE : billed
  RECEIVABLE ||--o{ RECEIPT : collects
  ORGANIZATION ||--o{ ACCOUNT : owns
  ORGANIZATION ||--o{ JOURNAL_ENTRY : posts
  JOURNAL_ENTRY ||--o{ JOURNAL_LINE : contains
  ORGANIZATION ||--|| AGENT_WALLET : owns
  AGENT_WALLET ||--o{ AGENT_ACTION : proposes
  ORGANIZATION ||--o{ AGENT_DAILY_SPEND : caps
  INVOICE ||--o{ AGENT_ACTION : targets
  AGENT_ACTION ||--o| PAYMENT : creates
  ORGANIZATION ||--o{ CHAIN_EVENT : indexes
  ORGANIZATION ||--o{ INDEXER_CURSOR : advances
  ORGANIZATION ||--o{ AUDIT_EVENT : records
  USER ||--o{ AUTH_CHALLENGE : requests

  ORGANIZATION {
    string id PK
    string name
    string slug
    string network
    object collection
  }
  MEMBERSHIP {
    string orgId FK
    string userId FK
    string role
  }
  USER {
    string accountId PK
    string network
    string activeOrgId
    int tokenVersion
  }
  VENDOR {
    string orgId FK
    string name
    string payoutChain
    string payoutAddress
    string status
  }
  INVOICE {
    string orgId FK
    string vendorId FK
    string number
    string status
    string total
    int decimals
  }
  PAYMENT {
    string orgId FK
    string invoiceId FK
    string provider
    string status
    string rawStatus
    string depositAddress
    string outlayerRequestId
    string agentActionId
  }
  PAYMENT_INTENT {
    string orgId FK
    string invoiceId FK
    string rail
    string status
    string paymentId
  }
  PAYMENT_ATTEMPT {
    string intentId FK
    string orgId FK
    string rail
    string status
    string providerRequestId
  }
  CUSTOMER {
    string orgId FK
    string name
    string email
    string status
  }
  RECEIVABLE {
    string orgId FK
    string customerId FK
    string number
    string status
    string total
    string paidAmount
  }
  RECEIPT {
    string receiptId PK
    string amount
    string method
    string chainEventId
    string receivedAt
  }
  ACCOUNT {
    string orgId FK
    string code
    string name
    string type
    string normalBalance
  }
  JOURNAL_ENTRY {
    string orgId FK
    date date
    string sourceType
    string sourceId
    string dedupeKey
    string currency
  }
  JOURNAL_LINE {
    string accountCode
    string debit
    string credit
  }
  AGENT_WALLET {
    string orgId FK
    string provider
    string accountId
    string outlayerWalletId
    object policy
  }
  AGENT_ACTION {
    string orgId FK
    string invoiceId FK
    string status
    string amountUsd
    string paymentIntentId
    string outlayerRequestId
  }
  AGENT_DAILY_SPEND {
    string orgId FK
    string day
    int spentCents
  }
  CHAIN_EVENT {
    string orgId FK
    string txHash
    int eventIndex
    string kind
  }
  INDEXER_CURSOR {
    string key PK
    int value
  }
  AUTH_CHALLENGE {
    string nonce PK
    string accountId
    date expiresAt
    bool used
  }
  AUDIT_EVENT {
    string orgId FK
    string actorUserId
    string method
    string path
    int status
  }
```

Money is stored as an integer string in the asset's smallest unit plus a
`decimals` field. Never use `Number` on a monetary value.

Key indexes and invariants:

- `payment_intents` is unique on `(orgId, invoiceId)` for `OPEN`/`EXECUTING` — one live
  obligation per invoice across all rails.
- `payments` is unique on `(orgId, invoiceId)` for `AWAITING_DEPOSIT`/`PROCESSING`,
  and on `(orgId, txHash)` and `(orgId, idempotencyKey)` when present.
- `invoices` and `receivables` are unique on `(orgId, number)`.
- `receivables.receipts.chainEventId` is a unique sparse index, so re-indexing a collect
  receipt cannot duplicate a row.
- `journal_entries` is unique on `(orgId, dedupeKey)` when `dedupeKey` exists; manual entries
  omit it. Journal rows are immutable.
- `agent_daily_spend` is unique on `(orgId, day)` and updated with a conditional `$inc`.
- `agent_wallets` is unique per org; `memberships` is unique on `(orgId, userId)`.
- `auth_challenges` has a TTL index on `expiresAt`.

See [Data model reference](./data-model.md) for every collection and field.

---

## 9. Trust boundaries

```mermaid
flowchart LR
  subgraph Browser["Untrusted: browser"]
    B["Session cookie<br/>wallet or NEAR Auth signature"]
  end

  subgraph KEIZ["Trusted: KEIZ API"]
    K["Org scoping · RBAC · policy pre-checks<br/>encrypted secrets · audit log"]
  end

  subgraph Partners["Third parties"]
    OC["1Click<br/>sees quote and deposit"]
    OL["OutLayer TEE<br/>holds keys · enforces policy"]
    AU["Auth0 + fast-auth + MPC<br/>identity and NEAR Auth signing"]
    AI["NEAR AI Cloud<br/>sees prompts and tool results"]
  end

  subgraph Chain["Public chain"]
    N["NEAR + Intents<br/>public transactions"]
  end

  B --> K
  K --> OC
  K --> OL
  K --> AU
  K --> AI
  K --> N
```

- **1Click is mainnet-only.** There is no testnet deployment.
- **OutLayer keys never leave the TEE.** The API key is full wallet authority;
  it is stored encrypted and only exposed through the OWNER handoff URL.
- **The NEAR Auth relayer** can only submit `sign` to `fast-auth`, for the
  expected guard id, within the gas cap and with a 1 yoctoNEAR deposit. It
  cannot move funds.
- **NEAR AI** receives the prompt, the conversation window, and tool results.
  Use the local provider for offline or sensitive demos.

---

## 10. Runtime and deployment

```mermaid
flowchart LR
  Web["apps/web<br/>:3000"] -->|"/api/* rewrite"| API["apps/api<br/>:3001"]
  API --> Mongo[("MongoDB")]
  API --> RPC[("NEAR RPC")]
  API --> OneClick["1Click"]
  API --> OutLayer["OutLayer"]
  API --> NEARAI["NEAR AI Cloud"]
  API --> Auth0["Auth0 / fast-auth"]
```

- Two long-running processes plus a worker: Next, Nest, and the BullMQ worker.
- Pollers/queue processors (`payments`, `outlayer`, `indexer`, `near-auth`) run in the worker; Redis is required (`REDIS_URL`). The API only produces jobs. Tests set `QUEUES_ENABLED=false`.
- Queue cadence: payment polls run per payment (4s default) plus a sweep every
  `PAYMENT_SWEEP_INTERVAL_MS` (30s); OutLayer polls start at 2s with 5s/30s/5m backoff plus a
  5m sweeper; the indexer syncs every `INDEXER_INTERVAL_MS` (30s); the NEAR Auth relay queue
  runs with concurrency 1. `POST /api/indexer/collect` triggers an immediate collect sync.
- Mongo is required for app state and Mastra memory. Use the same database name
  for both clients.
- `pnpm dev` runs Turbo; `pnpm build` builds shared → api → web. Stop dev before
  building because both write `apps/api/dist`.

---

## 11. Testing map

| Suite | Covers |
|---|---|
| `pnpm test` | 84 unit tests (69 API + 15 shared): money math, invoice totals, ledger posting rules, NEP-413 vectors, network guards, agent policy, SSE mapping, chat card builders, plan gate, OutLayer status map |
| `pnpm --filter @keiz/api smoke` | 50 checks: auth scoping + refresh reuse, invoices, 1Click mock settlement, AP/AR postings, receipts, trial balance, aging, rebuild, RBAC, members + org switching, duplicate quotes, audit, local chat plan/approval/cards, NEAR Auth relayer fencing |
| `pnpm --filter @keiz/api smoke:outlayer` | custody register, describe, delegated policy, withdraw, polling, invoice settlement |
| `pnpm --filter @keiz/api smoke:mastra` | Mastra plan suspension, approve/resume, typed cards, request-scoped tools, memory, thread isolation |
| `pnpm contracts:test` | collect message parsing and vault policy validation |
| `pnpm typecheck` / `pnpm build` | TypeScript and production bundles |

## 12. Related docs

- [API reference](./api.md)
- [Data model](./data-model.md)
- [Integrations & contracts](./integrations.md)
- [Contract README](../contracts/README.md)
- [Security model](../README.md#security-model)
- [Agent custody](../README.md#agent-custody-outlayer)
- [Login (NEAR Auth + wallet)](../README.md#login-near-auth--wallet)
- [Agent instructions](../AGENTS.md)
