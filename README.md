# KEIZ

A B2B spend workspace: vendor invoices, multi-step approval, cross-chain settlement through **NEAR Intents**, an AI finance assistant on **NEAR AI**, and a policy-bound **agent wallet**. Login uses **NEP-413** signed messages.

The product surface is modelled on [Kyrim](https://kyrim.co.id) (invoice automation, vendor portal, spend dashboard) rebuilt as a NEAR-native reference app.

![KEIZ](https://img.shields.io/badge/NEAR-Intents-4f46e5) ![NEP-413](https://img.shields.io/badge/auth-NEP--413-0f9d76)

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

Open <http://localhost:3000>, sign in with a NEAR wallet, and press **Load demo data** if the workspace is empty.

## What is implemented

- **Passkey login (NEAR Auth)** — Auth0 passkey sign-in backed by MPC. The backend verifies the NEP-413 signature it receives, with a tight relayer that only forwards `sign` calls to the configured `fast-auth` contract. Wallet login remains available.
- **Invoice lifecycle** — DRAFT → SUBMITTED → APPROVED / REJECTED → PAYMENT_PENDING → PAID, with an append-only approval trail. Totals are computed with integer minor units and 5-decimal-safe tax math.
- **NEAR Intents settlement** — `GET /v0/tokens` → dry quote → committed quote (`dry:false`) → deposit → `POST /v0/deposit/submit` → status polling. Statuses are mapped to a local enum; raw provider strings never reach the UI.
- **Vendor payouts** — vendors store a payout chain and address. The invoice total is paid as `EXACT_OUTPUT` in USDC on the vendor's chain.
- **Agent wallet** — two providers:
  - **OutLayer custody** (when `OUTLAYER_ENABLED=true`): the agent gets an OutLayer wallet, API key, NEAR implicit account and Intents balance. Keys live in an Intel TDX enclave; spending policy is encrypted on-chain and enforced before signing. KEIZ stores only the encrypted API key.
  - **Local** (fallback): generated ed25519 keypair, AES-256-GCM at rest, local USD caps. Useful for the offline/mock demo.
- **AI assistant** — a Mastra agent with five tools over your own invoices, vendors and spend. It can create payment *proposals* but has no path to move funds. Streams tokens and tool calls over SSE; memory is stored by Mastra in Mongo. Uses NEAR AI Cloud when `NEARAI_API_KEY` is set, otherwise a deterministic local fallback that calls the same tools.
- **History indexing** — every payment transition is appended to `payment_events`; on-chain deposits are normalised into `chain_events` with a unique `(txHash, eventIndex)` index so re-polling cannot duplicate rows.

## Demo without mainnet funds

1Click has **no testnet**, so the default `PAYMENTS_MODE=mock` uses an in-process provider with the same quote/deposit/status contract. The invoice page exposes a **simulate settlement** shortcut. Set `PAYMENTS_MODE=intents` to use the real API — mainnet funds will move.

## API surface

```
POST /api/auth/challenge          create a NEP-413 challenge
POST /api/auth/verify             verify signature, set session cookies
GET  /api/auth/me                 session or null

GET/POST /api/vendors
GET/POST /api/invoices
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

GET  /api/agent/wallet
POST /api/agent/wallet
PATCH /api/agent/wallet/policy
GET/POST /api/agent/actions
POST /api/agent/actions/:id/decision
POST /api/agent/actions/:id/execute

POST /api/chat/messages          SSE: meta | thread | text | tool | done | error
GET  /api/chat/threads
GET  /api/chat/threads/:id
DELETE /api/chat/threads/:id

GET  /api/indexer/events
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

`/login` mirrors near.com's centered sign-in layout: a recommended **Sign in with passkey** card, plus a **NEAR Wallets** connector when `NEXT_PUBLIC_WALLET_LOGIN=true` (the default). Set it to `false` for passkey-only; the near-connect manifest is then never loaded.
 Set `NEXT_PUBLIC_WALLET_LOGIN=true` to restore the wallet option.

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
| `NEXT_PUBLIC_PASSKEY_ENABLED` | Show the passkey button |
| `NEXT_PUBLIC_WALLET_LOGIN` | `true` by default; `false` hides the wallet connector and loads no near-connect code |
| `NEAR_AUTH_NETWORK` / `NEAR_AUTH_CONTRACT_ID` | `testnet` + `fast-auth.testnet` (defaults) |
| `NEAR_AUTH_RELAYER_ACCOUNT_ID` / `_PRIVATE_KEY` | Funded account that submits the `sign` call |
| `AGENT_WALLET_MASTER_KEY` | 32-byte hex/base64 key for AES-256-GCM |

Generate a master key with `openssl rand -hex 32`.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm --filter @keiz/api smoke         # 29 end-to-end checks, in-memory Mongo
pnpm --filter @keiz/api smoke:mastra  # Mastra stream/tools/memory against a mock model
```

The first suite covers auth scoping and refresh reuse, integer totals, approval transitions, tenant isolation, quote → deposit → settlement, the append-only event log, agent policy (auto-approve, execute, hard block, atomic daily cap), RBAC, duplicate-quote rejection, address/amount validation, audit logging, local chat streaming and demo seeding. The Mastra suite drives the real agent through a mock OpenAI-compatible server and asserts live tool events, request-scoped org isolation and memory persistence.

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
- Only USD invoices are payable on-chain; there is no FX oracle for EUR/SGD/IDR yet.
- Native NEAR payments require wrapping to wNEAR in the same transaction (`near_deposit` + `ft_transfer`). The UI documents the `ft_transfer` path; the wrap helper is not built.
