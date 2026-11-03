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
    Ops["Invoices · Vendors"]
    PayMod["Payments"]
    AgentMod["Agent"]
    OutMod["OutLayer adapter"]
    ChatMod["Chat + Mastra"]
    Idx["Indexer"]
  end

  DB[("MongoDB")]
  RPC[("NEAR RPC")]
  OneClick["NEAR Intents 1Click"]
  OutLayer["OutLayer custody<br/>Intel TDX + NEAR MPC"]
  NEARAI["NEAR AI Cloud"]
  Auth0["Auth0 + NEAR Auth"]
  Relayer["Passkey relayer"]

  UI --> Proxy
  WalletUI --> Proxy
  Proxy --> Guards
  Guards --> AuthMod
  Guards --> Ops
  Guards --> PayMod
  Guards --> AgentMod
  Guards --> ChatMod
  Guards --> Idx

  AuthMod --> Auth0
  AuthMod --> Relayer
  Relayer --> Auth0
  AuthMod --> RPC

  Ops --> DB
  PayMod --> DB
  PayMod --> OneClick
  PayMod --> RPC

  AgentMod --> DB
  AgentMod --> OutMod
  OutMod --> OutLayer

  ChatMod --> NEARAI
  ChatMod --> DB

  Idx --> RPC
  Idx --> DB
```

---

## 2. Monorepo map

```mermaid
flowchart TB
  subgraph Web["apps/web"]
    Login["/login<br/>passkey + wallets"]
    Dash["/dashboard<br/>overview · invoices · vendors"]
    PayUI["payments · agent · assistant"]
    Lib["lib/auth · lib/passkey<br/>lib/chat-stream · lib/api"]
  end

  subgraph Shared["packages/shared"]
    Schemas["Zod schemas"]
    Money["money.ts<br/>parseUnits / formatUnits"]
    Status["status enums"]
    SSE["SSE parser"]
  end

  subgraph Api["apps/api"]
    Auth["auth"]
    Inv["invoices · vendors"]
    Payments["payments"]
    Agent["agent"]
    Outlayer["outlayer"]
    Chat["chat"]
    Indexer["indexer"]
    Audit["audit"]
    Demo["demo"]
  end

  Web --> Shared
  Api --> Shared
```

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

### 4.1 Passkey (NEAR Auth / FastAuth)

The passkey is an Auth0 factor. The NEAR key is MPC-derived and never reaches
the browser. The API relayer submits the `sign` action to `fast-auth`; it only
accepts `sign` on the configured contract, with gas ≤ 300 TGas and zero deposit.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web
  participant A as API
  participant N as Auth0 + NEAR Auth
  participant R as Relayer
  participant F as fast-auth contract
  participant P as NEAR RPC

  U->>W: Continue with passkey
  W->>N: Auth0 login with passkey
  N-->>W: Session + MPC signer
  W->>A: POST /auth/challenge
  A-->>W: message · recipient · nonce TTL 5m
  W->>N: requestMessageSignature
  N-->>W: signed intent request
  W->>W: createSignAction
  W->>A: POST /auth/passkey/relay
  A->>F: send_tx sign via funded relayer
  F-->>A: SuccessValue = MPC signature
  A-->>W: signature payload
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
  [*] --> QUOTED: quote preview
  QUOTED --> AWAITING_DEPOSIT: commit
  AWAITING_DEPOSIT --> PROCESSING: verified deposit
  AWAITING_DEPOSIT --> EXPIRED: deadline
  PROCESSING --> SUCCEEDED
  PROCESSING --> FAILED
  PROCESSING --> REFUNDED
  PROCESSING --> UNDERPAID
  PROCESSING --> NEEDS_REVIEW
  [*] --> PROCESSING: custody withdraw
```

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

  loop poll every 5s
    A->>OL: GET /wallet/v1/requests/:id
    OL-->>A: processing or success or failed
  end

  A->>DB: Payment SUCCEEDED
  A->>DB: Invoice PAID
```

```mermaid
stateDiagram-v2
  [*] --> PENDING_APPROVAL: policy threshold
  [*] --> APPROVED: custody proposal
  PENDING_APPROVAL --> APPROVED: human approval
  PENDING_APPROVAL --> REJECTED
  APPROVED --> EXECUTING: atomic claim
  EXECUTING --> EXECUTED
  EXECUTING --> BLOCKED: local pre-check
  EXECUTING --> FAILED
  EXECUTED --> NEEDS_REVIEW: custody needs review
```

---

## 7. AI assistant

The Mastra agent is server-side. Every tool receives `orgId` from the request
context; the model never chooses the tenant. Chat can create proposals but has
no path to move funds.

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
  A->>M: agent.stream(messages, requestContext)
  M->>AI: chat completion with tools
  AI-->>M: tool call
  M->>T: execute tool
  T->>DB: scoped query by orgId
  DB-->>T: rows
  T-->>M: result
  M->>AI: tool result
  AI-->>M: final answer
  M-->>A: text + tool chunks
  A-->>W: SSE meta · thread · text · tool · done
```

Without `NEARAI_API_KEY`, the same tools run through the deterministic local
provider, so the demo and tests stay offline.

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
  ORGANIZATION ||--|| AGENT_WALLET : owns
  AGENT_WALLET ||--o{ AGENT_ACTION : proposes
  INVOICE ||--o{ AGENT_ACTION : targets
  AGENT_ACTION ||--o| PAYMENT : creates
  ORGANIZATION ||--o{ CHAIN_EVENT : indexes
  ORGANIZATION ||--o{ AUDIT_EVENT : records

  ORGANIZATION {
    string id PK
    string name
    string slug
  }
  MEMBERSHIP {
    string orgId FK
    string userId FK
    string role
  }
  VENDOR {
    string orgId FK
    string name
    string payoutChain
    string payoutAddress
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
    string outlayerRequestId
  }
  AGENT_WALLET {
    string orgId FK
    string provider
    string accountId
    string outlayerWalletId
  }
  AGENT_ACTION {
    string orgId FK
    string invoiceId FK
    string status
    string amountUsd
  }
```

Money is stored as an integer string in the asset's smallest unit plus a
`decimals` field. Never use `Number` on a monetary value.

---

## 9. Trust boundaries

```mermaid
flowchart LR
  subgraph Browser["Untrusted: browser"]
    B["Session cookie<br/>wallet or passkey signature"]
  end

  subgraph KEIZ["Trusted: KEIZ API"]
    K["Org scoping · RBAC · policy pre-checks<br/>encrypted secrets · audit log"]
  end

  subgraph Partners["Third parties"]
    OC["1Click<br/>sees quote and deposit"]
    OL["OutLayer TEE<br/>holds keys · enforces policy"]
    AU["Auth0 + fast-auth + MPC<br/>identity and passkey signing"]
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
- **Passkey relayer** can only submit `sign` to `fast-auth`, within gas and
  deposit caps. It cannot move funds.
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

- Two long-running processes: Next and Nest.
- Pollers (`payments`, `outlayer`, `indexer`) are in-process and assume a single
  API instance. There is no Redis or queue.
- Mongo is required for app state and Mastra memory. Use the same database name
  for both clients.
- `pnpm dev` runs Turbo; `pnpm build` builds shared → api → web. Stop dev before
  building because both write `apps/api/dist`.

---

## 11. Testing map

| Suite | Covers |
|---|---|
| `pnpm test` | money math, NEP-413 vectors, agent policy, SSE mapping, OutLayer status map |
| `pnpm --filter @keiz/api smoke` | auth scoping + refresh reuse, invoices, 1Click mock settlement, RBAC, duplicate quotes, audit, local chat |
| `pnpm --filter @keiz/api smoke:outlayer` | custody register, describe, delegated policy, withdraw, polling, invoice settlement |
| `pnpm --filter @keiz/api smoke:mastra` | Mastra stream chunks, request-scoped tools, memory, thread isolation |
| `pnpm typecheck` / `pnpm build` | TypeScript and production bundles |

## 12. Related docs

- [Security model](../README.md#security-model)
- [Agent custody](../README.md#agent-custody-outlayer)
- [Passkey login](../README.md#passkey-login-near-auth)
- [Agent instructions](../AGENTS.md)
