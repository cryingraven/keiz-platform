# KEIZ

A B2B spend workspace: vendor bills (AP), customer invoices (AR), a **double-entry ledger**, multi-step approval, cross-chain settlement through **NEAR Intents**, an AI finance assistant on **NEAR AI**, and a policy-bound **agent wallet**. Login uses **NEP-413** signed messages.

![KEIZ](https://img.shields.io/badge/NEAR-Intents-4f46e5) ![NEP-413](https://img.shields.io/badge/auth-NEP--413-0f9d76)

**Docs:** [Architecture & diagrams](docs/architecture.md) · [API reference](docs/api.md) · [Data model](docs/data-model.md) · [Chat cards & approvals](docs/chat-cards.md) · [Integrations & contracts](docs/integrations.md) · [Contract README](contracts/README.md) · [Docs index](docs/README.md) · [Submission guide](submission-guide.md) · [Agent instructions](AGENTS.md)

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

## Hackathon disclosure

The repository history starts on 2026-11-03, inside the NEAR HACKATHON window
(2026-11-01 to 2026-11-14). There is no pre-hackathon product baseline to diff against.

The full dependency set is in the package manifests. Major libraries and SDKs:

- Web: Next.js 16, React 19, Tailwind CSS 4, `@hot-labs/near-connect`, `near-api-js`, `@noble/curves`, `@noble/hashes`.
- API: NestJS 12, Mongoose 9, Zod 4, Mastra, BullMQ, `@outlayer/sdk`, ExcelJS, PDFKit.
- Contracts: Rust with `near-sdk`.

AI coding agents were used during implementation and documentation. The repository history is the
record of the changes. No secrets or private keys are committed.

## Quick start

```bash
pnpm install
cp .env.example .env          # then set JWT_SECRET and AGENT_WALLET_MASTER_KEY
docker compose up -d          # MongoDB :27017 + Redis :6379
pnpm dev                      # web :3000, api :3001
pnpm worker                   # BullMQ worker (Redis)
```

No Docker? Use the throwaway in-memory Mongo:

```bash
pnpm --filter @keiz/api db:memory
```

Then create demo data (after signing in, or from the CLI):

```bash
pnpm --filter @keiz/api seed demo.near
```

Open <http://localhost:3000>, create a passkey account or sign in with a NEAR wallet, and press **Load demo data** if the workspace is empty.

## Judge quick path

```bash
pnpm install
cp .env.example .env          # set JWT_SECRET and AGENT_WALLET_MASTER_KEY
docker compose up -d          # MongoDB :27017 + Redis :6379
pnpm dev                      # web :3000, api :3001
pnpm worker                   # BullMQ worker (Redis)
```

Open <http://localhost:3000>, sign in, and press **Load demo data** if needed. Then:

1. **Bills (AP):** open `INV-1001`, approve it, request a quote and simulate settlement. Check that the invoice becomes `PAID` and the ledger has the expense, AP and cash postings.
2. **Receivables (AR):** open `AR-2001`, record a partial receipt, and check the outstanding balance and cash posting.
3. **Reporting:** choose monthly, quarterly or annual. Review inflow/outflow, profit & loss and the balance sheet, then export the report as PDF and Excel.
4. **Assistant:** ask “What do we owe this week?” and approve the plan. Read-only tools run; a payment proposal needs a separate confirmation and still cannot move funds.

Mock payments are the default (`PAYMENTS_MODE=mock`), so this path needs no mainnet funds.

## What is implemented

- **Passkey login** — self-hosted WebAuthn in the API. The passkey unlocks a random ed25519 seed in the browser via the PRF extension; the seed is the NEAR account key and is never sent to the server. The API stores only an AES-GCM wrap it cannot decrypt. A recovery-key endpoint (NEP-413) remains available; the current login UI exposes passkey and wallet sign-in only.
- **Wallet login (NEP-413)** — the user signs a one-time message in their NEAR wallet. The backend verifies the signature and the account's full-access key before issuing an httpOnly session cookie. No keys or seed phrases reach the server.
- **Invoice lifecycle (AP)** — DRAFT → SUBMITTED → APPROVED / REJECTED → PAYMENT_PENDING → PAID, with an append-only approval trail. Totals are computed with integer minor units and 5-decimal-safe tax math.
- **Customer invoices (AR)** — customers, customer invoices (DRAFT → ISSUED → PARTIALLY_PAID → PAID, plus VOID) and manual receipts with an optional transaction hash. Overdue is computed from the due date, never stored.
- **Double-entry accounting** — a per-org chart of accounts and an immutable, balanced journal. Approving a bill posts expense + input tax against AP; paying it clears AP against cash. Issuing a customer invoice posts AR against revenue + tax payable; a receipt posts cash against AR. Voiding reverses the original entry instead of editing it. Trial balance, P&L, AP/AR aging and the journal live under `/dashboard/accounting`.
- **NEAR Intents settlement** — `GET /v0/tokens` → dry quote → committed quote (`dry:false`) → deposit → `POST /v0/deposit/submit` → status polling. Statuses are mapped to a local enum; raw provider strings never reach the UI.
- **Vendor payouts** — vendors store a payout chain and address. The invoice total is paid as `EXACT_OUTPUT` in USDC on the vendor's chain.
- **Agent wallet** — two providers:
  - **OutLayer custody** (when `OUTLAYER_ENABLED=true`): the agent gets an OutLayer wallet, API key, NEAR implicit account and Intents balance. Keys live in an Intel TDX enclave; spending policy is encrypted on-chain and enforced before signing. KEIZ stores only the encrypted API key.
  - **Local** (fallback): generated ed25519 keypair, AES-256-GCM at rest, local USD caps. Useful for the offline/mock demo.
- **Agent economy** — a small sub-agent job board. The assistant can list specialist providers (Tax Reviewer, Collections Writer, Reconciliation Agent), hire one for a bounded task, and return a structured result. Hires use the same per-transaction, daily-cap and approval-threshold policy as agent payments, are claimed atomically, and are visible in `/dashboard/agent`. Settlement is currently **mock**; no on-chain agent-to-agent transfer is claimed.
- **AI assistant** — a Mastra agent over bills, receivables, customers, vendors, payments, agent actions, the journal, spend and the books. It must first emit an **action plan**; read-only tools then run automatically, while write/drafting tools request a **confirmation** in the UI. It can create vendors, customers, AP bills and AR customer invoices; creation previews use entity-specific cards (line items, computed totals, payout details) instead of raw JSON. Bills start DRAFT and can be submitted; customer invoices start DRAFT and can be issued (which posts AR). It can list and hire specialist sub-agents for bounded jobs, and create payment *proposals*, but it has no path to approve bills or execute payments. Streams tokens, plans, cards and tool calls over SSE; memory is stored by Mastra in Mongo. Uses NEAR AI Cloud when `NEARAI_API_KEY` is set, otherwise a deterministic local fallback with the same plan/approval protocol (creation requires the NEAR AI agent).
- **On-chain AR/AP contracts** — `contracts/keiz-collect` records NEP-141 customer payments by receivable reference, and `contracts/keiz-vault` executes vendor payouts after M-of-N approval and on-chain policy checks. 1Click can deliver cross-chain AR with `customRecipientMsg`, and the vault can fund a committed 1Click deposit address for cross-chain AP. The vault is operated separately from the app today. See `contracts/README.md`.
- **Workspace operations** — team members and roles, org switching, vendor/customer edit + archive, draft-bill edit, and per-workspace AR collection settings that are validated against the deployed contract before activation.
- **History indexing** — every payment transition is appended to `payment_events`; on-chain deposits are normalised into `chain_events` with a unique `(txHash, eventIndex)` index so re-polling cannot duplicate rows.
- **PaymentIntent + PaymentAttempt** — one live payment obligation per invoice, reserved before execution to prevent cross-rail double payment. `oneclick` and `outlayer` execute today; `vault` is a reserved rail until the AP vault is wired to invoice approval.
- **Audit log** — every mutating request is recorded append-only and readable by ADMIN/OWNER at `/dashboard/audit` with actor, path, status and IP.

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
POST /api/auth/challenge          public, create a NEP-413 challenge
POST /api/auth/passkey/signup/options    public, WebAuthn registration options
POST /api/auth/passkey/signup/verify     public, verify WebAuthn + NEP-413 + create session
POST /api/auth/passkey/login/options     public, WebAuthn authentication options
POST /api/auth/passkey/login/verify      public, verify assertion + set session cookies
POST /api/auth/passkey/unlock            auth, return the encrypted seed wrap
GET  /api/auth/passkey/credentials       auth, list passkeys
POST /api/auth/verify             public, verify signature + set session cookies
POST /api/auth/refresh            public, rotate the refresh token
POST /api/auth/logout             public, clear cookies
GET  /api/auth/me                 public, session or null
GET  /api/auth/orgs               workspaces this account belongs to
POST /api/auth/switch-org         switch active workspace, reissue cookies

GET/POST /api/vendors
GET/PATCH/DELETE /api/vendors/:id   PATCH/DELETE ADMIN/OWNER (delete archives)

GET  /api/invoices                ?status= &vendorId= &from= &to= &dateField=
POST /api/invoices                create a DRAFT bill
GET  /api/invoices/summary
PATCH /api/invoices/:id             DRAFT only, totals recomputed
POST /api/invoices/:id/submit
POST /api/invoices/:id/decision     APPROVER/ADMIN/OWNER
POST /api/invoices/:id/void         ADMIN/OWNER

GET  /api/payments                ?invoiceId= &from= &to=
GET  /api/payments/open
GET  /api/payments/tokens
POST /api/payments                commit a quote
POST /api/payments/:id/deposit
POST /api/payments/:id/refresh
POST /api/payments/:id/cancel     ADMIN/OWNER, awaiting-deposit only
POST /api/payments/:id/simulate   ADMIN/OWNER, mock + non-production only
GET  /api/payments/:id/events

GET/POST /api/customers            GET supports ?includeArchived=true&q=...
PATCH/DELETE /api/customers/:id     ADMIN/OWNER (delete archives)
POST /api/customers/:id/restore     ADMIN/OWNER

GET  /api/receivables                 ?status= &customerId= &currency= &from= &to= &dateField=
GET  /api/receivables/summary
GET  /api/receivables/:id
POST /api/receivables
POST /api/receivables/:id/collection-quote  1Click quote to the workspace collect contract
POST /api/receivables/:id/issue
POST /api/receivables/:id/receipts    APPROVER/ADMIN/OWNER
POST /api/receivables/:id/void        ADMIN/OWNER

GET  /api/orgs/current/collection     AR collection config
PATCH /api/orgs/current/collection    ADMIN/OWNER, validates org/treasury/token/code hash

GET  /api/accounting/accounts
GET  /api/accounting/summary          ?currency= &from= &to=
GET  /api/accounting/trial-balance    ?currency= &asOf=
GET  /api/accounting/journal-entries  ?currency= &accountCode= &sourceType= &sourceId=
POST /api/accounting/journal-entries  ADMIN/OWNER, balanced manual entry
GET  /api/accounting/aging            ?side=AP|AR &currency=
GET  /api/accounting/reports          ?currency= &from= &to=
GET  /api/accounting/reports/export   ?currency= &from= &to= &format=pdf|xlsx
POST /api/accounting/rebuild          ADMIN/OWNER, idempotent backfill

GET  /api/agent/wallet
POST /api/agent/wallet
POST /api/agent/wallet/custody      OWNER, upgrade a local wallet to OutLayer
PATCH /api/agent/wallet/policy      OWNER, local wallets only (custody is read-only)
GET  /api/agent/stats
GET/POST /api/agent/actions
POST /api/agent/actions/:id/decision
POST /api/agent/actions/:id/execute

GET  /api/agent/providers          specialist agents available to hire
GET  /api/agent/jobs               recent hires and results
POST /api/agent/jobs               ADMIN/OWNER, create a hire
POST /api/agent/jobs/:id/approve   ADMIN/OWNER
POST /api/agent/jobs/:id/execute   ADMIN/OWNER
POST /api/agent/jobs/:id/cancel    ADMIN/OWNER

POST /api/chat/messages          SSE: meta | thread | plan | card | approval | text | tool | done | error
GET  /api/chat/approvals?threadId=  pending approvals for a thread
POST /api/chat/approvals         approve/decline a tool call and stream the continuation
GET  /api/chat/threads
GET  /api/chat/threads/:id
DELETE /api/chat/threads/:id

GET  /api/indexer/events
POST /api/indexer/backfill/:paymentId   ADMIN/OWNER
POST /api/indexer/collect               ADMIN/OWNER, sync active collect contracts
GET  /api/members                  workspace team
POST /api/members                  ADMIN/OWNER
PATCH/DELETE /api/members/:userId  ADMIN/OWNER (last owner protected)
GET  /api/audit                   ADMIN/OWNER
POST /api/demo/seed               OWNER, non-production only
GET  /api/health                  public
```

The full route table with request schemas and status codes is in
[`docs/api.md`](docs/api.md).

`dateField` on bill and receivable lists is `issueDate` (default), `dueDate` or
`createdAt`. `from` and `to` are ISO datetimes and filter inclusively by UTC day.

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

## Login (passkey + wallet)

`/login` offers **Create account**, **Sign in** on the passkey card, and one **Continue with a NEAR wallet** button that opens the NEAR Connect selector. The selector is not hardcoded: it uses `connector.availableWallets`, filtered to wallets that support NEP-413 `signMessage` on the active network. A passkey creates a random ed25519 seed in the browser, unlocks it with the WebAuthn PRF extension, and wraps it in AES-256-GCM under a PRF-derived key before uploading the ciphertext. The API is the WebAuthn relying party and stores only that ciphertext plus the credential metadata; it never sees the seed or the PRF output.

Signup requires both WebAuthn registration and a NEP-413 signature from the derived key, so an attacker cannot claim an arbitrary implicit account id. Login is a WebAuthn assertion; on-chain actions unlock the seed locally and sign with `PasskeySigner`. Multiple passkeys wrap the same seed. The API still accepts an exported `ed25519:` recovery key through `/auth/passkey/recovery/verify`, but the current login UI does not expose that option.

`NEXT_PUBLIC_CHAIN_NETWORK` switches the frontend between `mainnet` and `testnet` and drives both login paths and the dashboard badge. The API's `CHAIN_NETWORK` must match it. Passkeys are bound to `WEBAUTHN_RP_ID`; changing it invalidates existing credentials.

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
| `NEXT_PUBLIC_CHAIN_NETWORK` | Frontend switch: `mainnet` or `testnet`; drives wallet login and the dashboard badge |
| `CHAIN_NETWORK` | Server source of truth; must match `NEXT_PUBLIC_CHAIN_NETWORK`. The API rejects challenges for a different network |
| `NEAR_RPC_URL` | Wallet auth, deposit verification and indexer RPC |
| `WEBAUTHN_RP_ID` | Passkey relying-party domain; changing it invalidates existing credentials |
| `WEBAUTHN_ORIGINS` | Comma-separated exact HTTPS origins allowed to complete WebAuthn ceremonies |
| `WEBAUTHN_RP_NAME` | Name shown in the passkey picker |
| `NEAR_TESTNET_RPC_URL` | Testnet RPC used by NEP-413 verification and recovery |
| `KEIZ_COLLECT_CODE_HASH` | Canonical `keiz-collect` wasm hash; required in production to activate a workspace contract |
| `REDIS_URL` / `QUEUES_ENABLED` | BullMQ connection and whether the API produces background jobs |
| `QUEUE_PREFIX` | Redis key prefix shared by API and worker |
| `AGENT_WALLET_MASTER_KEY` | 32-byte hex/base64 key for AES-256-GCM |
| `OUTLAYER_ENABLED` | Enable OutLayer agent custody (new wallets become custody wallets) |
| `OUTLAYER_NETWORK` | `testnet` or `mainnet`; cross-chain Intents are mainnet-only |
| `OUTLAYER_BASE_URL` | Explicit API host; the SDK defaults are stale |

Generate a master key with `openssl rand -hex 32`.

## Verification

```bash
pnpm typecheck
pnpm test                              # unit tests across API and shared
pnpm --filter @keiz/api smoke          # end-to-end checks, in-memory Mongo
pnpm --filter @keiz/api smoke:outlayer # custody flow against a mock OutLayer API
pnpm --filter @keiz/api smoke:mastra   # Mastra stream/tools/memory against a mock model
pnpm contracts:test                    # Rust contract unit tests
PATH="$HOME/.cargo/bin:$PATH" pnpm contracts:build  # wasm build
```

Contract deployment (testnet/mainnet, dry-run first):

```bash
./contracts/deploy/testnet.sh
CONFIRM_MAINNET=YES ./contracts/deploy/mainnet.sh
```

See `contracts/README.md` for required accounts, token ids, and policy limits.

The main suite covers auth scoping and refresh reuse, integer totals, approval transitions, tenant isolation, quote → deposit → settlement, the append-only event log, agent policy (auto-approve, execute, hard block, atomic daily cap), RBAC, duplicate-quote rejection, address/amount validation, audit logging, local chat streaming and demo seeding. It also drives AP recognition and settlement, AR issue/partial/full receipt, void reversals, trial-balance balance, AP/AR aging, manual opening entries, idempotent rebuild and ledger tenant isolation, plus member add/role/remove with last-owner protection and switching into a shared workspace. The custody suite drives registration, delegated policy, withdraw, polling and settlement against a mock OutLayer API. The Mastra suite drives the real agent through a mock OpenAI-compatible server and asserts live tool events, request-scoped org isolation and memory persistence.

## NEAR agent skills

The repo installs the upstream NEAR skills into `.agents/skills/` (`near-intents`, `near-ai-cloud`, `near-dapp`, `near-kit`). Coding agents should read the relevant skill before changing that integration.

```bash
npx skills add near/agent-skills --skill near-intents --skill near-ai-cloud --skill near-dapp --skill near-kit -a opencode -y
```

## Known limits

- Agent custody is real when OutLayer is enabled. With it disabled, the local agent wallet still cannot sign on-chain; execution delegates to the mock/1Click payment provider.
- Passkeys authenticate and hold a self-custodial NEAR key. A passkey account signs its own deposits; a wallet account can add a passkey from Settings (the wallet approves an on-chain `AddKey` first).
- OutLayer custody execution requires a configured policy (`dryRun.policy_check.decision` must be `allowed` or `requires_approval`). No-policy wallets are blocked. Actions remain `EXECUTING` until OutLayer reports `success`, and only USD invoices can be paid through custody.
- In-app OutLayer multisig approval signing is not wired; pending custody approvals link to the OutLayer dashboard.
- Agent hires run through the local agent wallet and record **mock** settlement only. A real agent-to-agent payout rail (1Click or custody) is not wired; OutLayer custody wallets cannot execute agent jobs yet.
- Cross-chain custody payouts are mainnet-only (OutLayer has no testnet Intents solvers).
- The payment/outlayer/indexer pollers are durable BullMQ jobs. The API process only produces; run the worker (`pnpm worker`) next to it. Redis is required in dev/prod; tests use `QUEUES_ENABLED=false`.
- Mastra semantic recall is disabled (`semanticRecall: false`, `vector: false`) because standalone MongoDB has no Atlas Search. Message history works; vector search would need Atlas or another vector store.
- Mastra opens a second Mongo client alongside Mongoose. It is closed on shutdown, but both must point at the same database name.
- Only USD invoices are payable on-chain; there is no FX oracle for EUR/SGD/IDR yet. The ledger therefore reports per currency and does not translate between them.
- Cross-chain AP payouts are marked `NEEDS_REVIEW` when 1Click reports success without a destination transaction hash. Full destination amount/token/recipient verification is still missing.
- Mongo is a single node, so a state change and its journal posting are not atomic. Posting is idempotent and best-effort; `POST /api/accounting/rebuild` repairs gaps.
- Native NEAR payments require wrapping to wNEAR in the same transaction. The UI builds `near_deposit` + `ft_transfer` for wNEAR origin quotes; other origins must already be NEP-141 tokens.
- On-chain AR collection is implemented in `contracts/keiz-collect` and indexed into receivables. It still needs a per-workspace deployment and token registration before production.
- The AP vault is implemented in `contracts/keiz-vault`; invoice approval is not yet wired to on-chain proposals, so it is currently deployed and operated separately.
- 1Click is mainnet-only, so cross-chain AR/AP cannot be end-to-end tested on testnet.
