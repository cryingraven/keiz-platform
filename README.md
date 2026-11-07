# KEIZ

A B2B spend workspace: vendor bills (AP), customer invoices (AR), a **double-entry ledger**, multi-step approval, cross-chain settlement through **NEAR Intents**, an AI finance assistant on **NEAR AI**, and a policy-bound **agent wallet**. Login uses **NEP-413** signed messages.

![KEIZ](https://img.shields.io/badge/NEAR-Intents-4f46e5) ![NEP-413](https://img.shields.io/badge/auth-NEP--413-0f9d76)

**Docs:** [Architecture & diagrams](docs/architecture.md) · [Docs index](docs/README.md) · [Agent instructions](AGENTS.md)

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| API | NestJS 12, Mongoose 9 |
| Shared | TypeScript, Zod 4 |
| Auth | NEP-413 signed message → JWT (httpOnly cookies) |
| Payments | NEAR Intents 1Click (with a deterministic mock provider) |
| AI | Mastra agent + NEAR AI Cloud (`nearai/...`), local fallback |
| Chain data | NEAR RPC + append-only Mongo event log |
| Accounting | Per-org chart of accounts, immutable journal, AP/AR subledgers |
| Agent custody | OutLayer (Intel TDX + NEAR MPC) — optional |

## Quick start

```bash
pnpm install
cp .env.example .env          # then set JWT_SECRET and AGENT_WALLET_MASTER_KEY
docker compose up -d          # MongoDB on :27017
pnpm dev                      # web :3000, api :3001
```

No Docker? Use the throwaway in-memory Mongo:

```bash
pnpm --filter @keiz/api db:memory
```

Then create demo data (after signing in, or from the CLI):

```bash
pnpm --filter @keiz/api seed demo.near
```

Open <http://localhost:3000>, sign in with a passkey or a NEAR wallet, and press **Load demo data** if the workspace is empty.

## What is implemented

- **Passkey login (NEAR Auth)** — Auth0 passkey sign-in backed by MPC. The backend verifies the NEP-413 signature it receives, with a tight relayer that only forwards `sign` calls to the configured `fast-auth` contract. Wallet login remains available.
- **Invoice lifecycle (AP)** — DRAFT → SUBMITTED → APPROVED / REJECTED → PAYMENT_PENDING → PAID, with an append-only approval trail. Totals are computed with integer minor units and 5-decimal-safe tax math.
- **Customer invoices (AR)** — customers, customer invoices (DRAFT → ISSUED → PARTIALLY_PAID → PAID, plus VOID) and manual receipts with an optional transaction hash. Overdue is computed from the due date, never stored.
- **Double-entry accounting** — a per-org chart of accounts and an immutable, balanced journal. Approving a bill posts expense + input tax against AP; paying it clears AP against cash. Issuing a customer invoice posts AR against revenue + tax payable; a receipt posts cash against AR. Voiding reverses the original entry instead of editing it. Trial balance, P&L, AP/AR aging and the journal live under `/dashboard/accounting`.
- **NEAR Intents settlement** — `GET /v0/tokens` → dry quote → committed quote (`dry:false`) → deposit → `POST /v0/deposit/submit` → status polling. Statuses are mapped to a local enum; raw provider strings never reach the UI.
- **Vendor payouts** — vendors store a payout chain and address. The invoice total is paid as `EXACT_OUTPUT` in USDC on the vendor's chain.
- **Agent wallet** — two providers:
  - **OutLayer custody** (when `OUTLAYER_ENABLED=true`): the agent gets an OutLayer wallet, API key, NEAR implicit account and Intents balance. Keys live in an Intel TDX enclave; spending policy is encrypted on-chain and enforced before signing. KEIZ stores only the encrypted API key.
  - **Local** (fallback): generated ed25519 keypair, AES-256-GCM at rest, local USD caps. Useful for the offline/mock demo.
- **AI assistant** — a Mastra agent with five tools over your own invoices, vendors and spend. It can create payment *proposals* but has no path to move funds. Streams tokens and tool calls over SSE; memory is stored by Mastra in Mongo. Uses NEAR AI Cloud when `NEARAI_API_KEY` is set, otherwise a deterministic local fallback that calls the same tools.
- **History indexing** — every payment transition is appended to `payment_events`; on-chain deposits are normalised into `chain_events` with a unique `(txHash, eventIndex)` index so re-polling cannot duplicate rows.

## Demo without mainnet funds

1Click has **no testnet**, so the default `PAYMENTS_MODE=mock` uses an in-process provider with the same quote/deposit/status contract. The invoice page exposes a **simulate settlement** shortcut. Set `PAYMENTS_MODE=intents` to use the real API — mainnet funds will move.

## AP, AR and the ledger

Every workspace gets the same chart of accounts on its first posting. Journal entries are
immutable and must balance; corrections are reversal entries. All amounts stay integer
minor-unit strings, and reports aggregate with `$toDecimal`, never `$toDouble`.

| Event | Debit | Credit |
|---|---|---|
| Vendor bill approved | 5100 Operating expenses (subtotal), 1300 Input tax (tax) | 2000 Accounts payable (total) |
| Vendor bill paid | 2000 Accounts payable | 1010 Cash & stablecoins |
| Vendor bill voided | 2000 Accounts payable | 5100 Operating expenses, 1300 Input tax |
| Customer invoice issued | 1100 Accounts receivable (total) | 4000 Revenue (subtotal), 2100 Tax payable (tax) |
| Customer receipt | 1010 Cash & stablecoins | 1100 Accounts receivable |
| Customer invoice voided | 4000 Revenue, 2100 Tax payable | 1100 Accounts receivable |

System postings carry a deterministic `dedupeKey` (`invoice:<id>:PAID`, `receipt:<id>:RECEIVED`, …),
so retries and pollers cannot double-post. Mongo is a single node with no multi-document
transactions, so posting happens after the business state change and is best-effort;
`POST /api/accounting/rebuild` backfills anything missing and is safe to run repeatedly.
Manual journal entries and rebuilds are ADMIN/OWNER; recording a customer receipt is APPROVER+.

The ledger is kept **per currency** (USD, EUR, SGD, IDR) with no FX translation, matching the
existing no-FX limitation on payments.

## API surface

```
POST /api/auth/challenge          create a NEP-413 challenge
POST /api/auth/verify             verify signature, set session cookies
GET  /api/auth/me                 session or null
GET  /api/auth/orgs               workspaces this account belongs to
POST /api/auth/switch-org         switch active workspace, reissue cookies

GET/POST /api/vendors
PATCH/DELETE /api/vendors/:id      ADMIN/OWNER (delete archives)
GET/POST /api/invoices
PATCH /api/invoices/:id            DRAFT only, totals recomputed
POST /api/invoices/:id/submit
POST /api/invoices/:id/decision
POST /api/invoices/:id/void

GET  /api/payments                ?invoiceId= filter
GET  /api/payments/tokens
POST /api/payments                commit a quote
POST /api/payments/:id/deposit
POST /api/payments/:id/refresh
POST /api/payments/:id/cancel     ADMIN/OWNER, awaiting-deposit only
POST /api/payments/:id/simulate   ADMIN/OWNER, mock + non-production only
GET  /api/payments/:id/events

GET/POST /api/customers
PATCH/DELETE /api/customers/:id     ADMIN/OWNER (delete archives)
GET  /api/receivables                 ?status= &customerId= &currency=
GET  /api/receivables/summary
GET  /api/receivables/:id
POST /api/receivables
POST /api/receivables/:id/issue
POST /api/receivables/:id/receipts    APPROVER/ADMIN/OWNER
POST /api/receivables/:id/void        ADMIN/OWNER

GET  /api/accounting/accounts
GET  /api/accounting/summary          ?currency= &from= &to=
GET  /api/accounting/trial-balance    ?currency= &asOf=
GET  /api/accounting/journal-entries  ?currency= &accountCode= &sourceType= &sourceId=
POST /api/accounting/journal-entries  ADMIN/OWNER, balanced manual entry
GET  /api/accounting/aging            ?side=AP|AR &currency=
POST /api/accounting/rebuild          ADMIN/OWNER, idempotent backfill

GET  /api/agent/wallet
POST /api/agent/wallet
POST /api/agent/wallet/custody      OWNER, upgrade a local wallet to OutLayer
PATCH /api/agent/wallet/policy      OWNER
GET  /api/agent/stats
GET/POST /api/agent/actions
POST /api/agent/actions/:id/decision
POST /api/agent/actions/:id/execute

POST /api/chat/messages          SSE: meta | thread | text | tool | done | error
GET  /api/chat/threads
GET  /api/chat/threads/:id
DELETE /api/chat/threads/:id

GET  /api/indexer/events
POST /api/indexer/backfill/:paymentId   ADMIN/OWNER
GET  /api/members                  workspace team
POST /api/members                  ADMIN/OWNER
PATCH/DELETE /api/members/:userId  ADMIN/OWNER (last owner protected)
GET  /api/audit                   ADMIN/OWNER
POST /api/demo/seed               OWNER, non-production only
GET  /api/health
```

## Security model

- **RBAC** — `RolesGuard` enforces OWNER/ADMIN/APPROVER/MEMBER. The role is reloaded from the membership on every request, so a removed user or changed role takes effect immediately. Invoice decisions require APPROVER+, policy changes require OWNER, agent execution requires ADMIN+.
- **Separation of duties** — the invoice creator cannot approve their own bill once another eligible approver exists in the workspace.
- **Deposit verification** — in `PAYMENTS_MODE=intents`, a submitted hash is checked against NEAR RPC: successful execution, `ft_transfer` on the quoted token contract, correct deposit address, and amount at or above the quote. Mock mode skips the chain check.
- **One live quote per invoice** — enforced by a partial unique index, not just a service check. A second quote returns 409.
- **Payout binding** — the destination stablecoin is derived from the vendor's chain, the address is validated for that chain, and non-USD-stable destinations are rejected.
- **Agent controls** — atomic daily-spend reservation, per-transaction cap, asset allowlist, approval threshold, atomic execution claim, idempotent payment creation.
- **Sessions** — access JWT 15m, refresh rotation with reuse detection (reuse revokes the whole token family), httpOnly SameSite=Lax cookies.
- **Hardening** — global + auth-specific rate limits, helmet, Next security headers, Zod-validated query params, positive-decimal line items, admin-only audit log, non-production guards on demo/simulate.

## Agent custody (OutLayer)

Set:
```
OUTLAYER_ENABLED=true
OUTLAYER_NETWORK=testnet          # or mainnet
OUTLAYER_BASE_URL=https://testnet-api.outlayer.ai
```

The SDK's built-in hosts are stale, so `OUTLAYER_BASE_URL` is always passed explicitly.

- New agent wallets are registered through OutLayer and show a custody account, native NEAR / Intents USDC balances, a policy handoff, and a read-only policy state.
- Existing local wallets show **Enable OutLayer custody**, which registers a custody wallet and keeps the action history.
- Policy is managed in the OutLayer handoff (`https://app.outlayer.ai/wallet?key=...`), not in KEIZ. The handoff URL contains the full-authority API key — it is returned to OWNER only, and must be opened on a trusted device.
- Execution: resolve the vendor's stablecoin from OutLayer’s token catalog → `withdrawDryRun` → `withdraw` with an idempotency key. The poller reads `GET /wallet/v1/requests/{id}` and maps `success / failed / refunded / needs_review`.
- `needs_review` is terminal and is never auto-retried.
- Multisig approvals are enforced by OutLayer. Pending actions link to the OutLayer approvals page.
- **Testnet has no Intents solvers**: registration, address, balance, NEAR transfer/call, policy and signing work; cross-chain withdraw/swap return 503. Use mainnet for the full invoice payout flow.
- Free tier: 1000 custody operations per wallet per 24h; handle `429 operation_limit_reached`.

## Passkey login (NEAR Auth)

`/login` mirrors near.com's centered sign-in layout: a recommended **Sign in with passkey** card, plus a **NEAR Wallets** button when `NEXT_PUBLIC_WALLET_LOGIN=true` (the default). The button opens the near-connect selector, which supports HOT, Meteor, Intear, MyNearWallet, Nightly, NEAR Mobile, OKX, Hana, Ledger and the rest of the manifest. Set the flag to `false` for passkey-only; the near-connect manifest is then never loaded. The connector is lazy: it loads on the first wallet action, never on dashboard pages. WalletConnect/Unity remain hidden unless a WalletConnect SignClient is configured.

Passkeys use [NEAR Auth](https://docs.auth.near.org): Auth0 issues a JWT, the `fast-auth` contract verifies it, and an MPC network signs the NEP-413 message.

Testnet is preconfigured in `.env.example` with the shared Auth0 client and contracts. Two things are required beyond that:

1. **A funded relayer.** Signing a NEP-413 message requires an on-chain `sign` call to `fast-auth.testnet`. Create a testnet account, fund it from the [faucet](https://docs.near.org/getting-started/faucet), export its key, and set:
   ```
   NEAR_AUTH_RELAYER_ACCOUNT_ID=your-relayer.testnet
   NEAR_AUTH_RELAYER_PRIVATE_KEY=ed25519:...
   ```
   The relayer only accepts `sign` calls to `fast-auth.<network>`, with gas ≤ 300 TGas and zero deposit. Keep it minimally funded.
2. **An Auth0 tenant that offers passkeys.** The shared testnet client is for development; for production passkeys apply for [mainnet access](https://docs.auth.near.org/home/apply).

New NEAR Auth users are **implicit accounts** (hex of their public key) that do not exist on-chain yet. The backend accepts that case only when `view_account` returns `UNKNOWN_ACCOUNT` and the id exactly matches the key; otherwise it requires a full-access key.

Passkey login currently authenticates the user only. With wallet login disabled there is no wallet to sign invoice deposits: mock mode uses the admin simulation, mainnet mode keeps the verified transaction-hash fallback, and passkey-signed payments need a second relayer flow.

`NEXT_PUBLIC_CHAIN_NETWORK` switches the frontend between `mainnet` and `testnet` and drives the wallet connector, passkey defaults and the dashboard badge. Passkey mainnet also requires a mainnet Auth0 client and the API's `NEAR_AUTH_NETWORK`, contract and relayer to be on mainnet; wallet login only depends on the frontend value.

## Environment

See `.env.example`. The important ones:

| Variable | Why |
|---|---|
| `MONGODB_URI` | Mongo connection |
| `JWT_SECRET` | Access + refresh token signing |
| `APP_DOMAIN` | NEP-413 `recipient`; must match between sign and verify |
| `PAYMENTS_MODE` | `mock` (default) or `intents` (mainnet) |
| `NEAR_INTENTS_JWT` | Partner key; without it 1Click charges 25 bps instead of 20 bps |
| `NEARAI_API_KEY` | Enables the Mastra + NEAR AI path; unset = local fallback |
| `CHAT_PROVIDER` | `mastra` or `local`; `mastra` without a key still falls back |
| `MONGODB_DB_NAME` | Database for both Mongoose and Mastra storage |
| `NEXT_PUBLIC_CHAIN_NETWORK` | Frontend switch: `mainnet` or `testnet`; drives wallet login, passkey defaults and the dashboard badge |
| `NEXT_PUBLIC_PASSKEY_ENABLED` | Show the passkey button |
| `NEXT_PUBLIC_WALLET_LOGIN` | `true` by default; `false` hides the wallet connector and loads no near-connect code |
| `NEAR_AUTH_NETWORK` / `NEAR_AUTH_CONTRACT_ID` | API-side passkey network, `testnet` + `fast-auth.testnet` (defaults) |
| `NEAR_AUTH_RELAYER_ACCOUNT_ID` / `_PRIVATE_KEY` | Funded account that submits the `sign` call |
| `AGENT_WALLET_MASTER_KEY` | 32-byte hex/base64 key for AES-256-GCM |
| `OUTLAYER_ENABLED` | Enable OutLayer agent custody (new wallets become custody wallets) |
| `OUTLAYER_NETWORK` | `testnet` or `mainnet`; cross-chain Intents are mainnet-only |
| `OUTLAYER_BASE_URL` | Explicit API host; the SDK defaults are stale |

Generate a master key with `openssl rand -hex 32`.

## Verification

```bash
pnpm typecheck
pnpm test                              # 67 unit tests
pnpm --filter @keiz/api smoke          # 44 end-to-end checks, in-memory Mongo
pnpm --filter @keiz/api smoke:outlayer # custody flow against a mock OutLayer API
pnpm --filter @keiz/api smoke:mastra   # Mastra stream/tools/memory against a mock model
```

The main suite covers auth scoping and refresh reuse, integer totals, approval transitions, tenant isolation, quote → deposit → settlement, the append-only event log, agent policy (auto-approve, execute, hard block, atomic daily cap), RBAC, duplicate-quote rejection, address/amount validation, audit logging, local chat streaming and demo seeding. It also drives AP recognition and settlement, AR issue/partial/full receipt, void reversals, trial-balance balance, AP/AR aging, manual opening entries, idempotent rebuild and ledger tenant isolation. The custody suite drives registration, delegated policy, withdraw, polling and settlement against a mock OutLayer API. The Mastra suite drives the real agent through a mock OpenAI-compatible server and asserts live tool events, request-scoped org isolation and memory persistence.

## NEAR agent skills

The repo installs the upstream NEAR skills into `.agents/skills/` (`near-intents`, `near-ai-cloud`, `near-dapp`, `near-kit`). Coding agents should read the relevant skill before changing that integration.

```bash
npx skills add near/agent-skills --skill near-intents --skill near-ai-cloud --skill near-dapp --skill near-kit -a opencode -y
```

## Known limits

- Agent custody is real when OutLayer is enabled. With it disabled, the local agent wallet still cannot sign on-chain; execution delegates to the mock/1Click payment provider.
- In-app OutLayer multisig approval signing is not wired; pending custody approvals link to the OutLayer dashboard.
- Cross-chain custody payouts are mainnet-only (OutLayer has no testnet Intents solvers).
- The payment poller is in-process and assumes a single API instance. Move to a queue/worker before scaling horizontally.
- Mastra semantic recall is disabled (`semanticRecall: false`, `vector: false`) because standalone MongoDB has no Atlas Search. Message history works; vector search would need Atlas or another vector store.
- Mastra opens a second Mongo client alongside Mongoose. It is closed on shutdown, but both must point at the same database name.
- Only USD invoices are payable on-chain; there is no FX oracle for EUR/SGD/IDR yet. The ledger therefore reports per currency and does not translate between them.
- Customer receipts are recorded, not chain-verified. A `txHash` on a receipt is a reference for the books; only AP deposits are checked against NEAR RPC.
- Mongo is a single node, so a state change and its journal posting are not atomic. Posting is idempotent and best-effort; `POST /api/accounting/rebuild` repairs gaps.
- Native NEAR payments require wrapping to wNEAR in the same transaction. The UI builds `near_deposit` + `ft_transfer` for wNEAR origin quotes; other origins must already be NEP-141 tokens.
- On-chain AR collection is not implemented. Receipts are book entries with an optional reference hash; see [integrations.md](docs/integrations.md) for the receiver-contract design that would make them verifiable.
