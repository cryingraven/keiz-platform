# KEIZ

B2B spend workspace. Next.js web + NestJS API, invoice approvals, NEAR Intents settlement, NEAR AI assistant, policy-bound agent wallet. Auth is NEP-413.

## Commands

```bash
pnpm install
pnpm dev                              # web :3000 + api :3001 (turbo)
pnpm build                            # shared -> api -> web
pnpm typecheck
pnpm test                             # unit: money, NEP-413, policy, SSE, custody

pnpm --filter @keiz/api test -- src/agent/policy.spec.ts   # one spec
pnpm --filter @keiz/api smoke          # full e2e, in-memory Mongo, no network
pnpm --filter @keiz/api smoke:outlayer # OutLayer custody against a mock API
pnpm --filter @keiz/api smoke:mastra   # Mastra stream + tools + memory, mock model

docker compose up -d                  # mongo :27017
pnpm --filter @keiz/api db:memory     # fallback when Docker is down (ephemeral)
pnpm --filter @keiz/api seed demo.near
```

## Layout

- `apps/web` — Next 16 App Router, Tailwind 4. Dashboard is client-rendered; data comes from `/api/*`.
- `apps/api` — Nest 12 + Mongoose 9. Feature folders: `auth`, `invoices` (AP), `receivables` (AR + customers), `accounting`, `payments`, `agent`, `outlayer`, `chat`, `indexer`, `audit`.
- `apps/api/src/chat` — Mastra agent, tools, memory and the SSE controller. Mastra owns conversations; there is no local thread schema.
- `packages/shared` — the only place DTOs, Zod schemas, status enums and money helpers live.
- `docs/architecture.md` — system context, request lifecycle, auth/payment/custody/chat sequences, state machines, data model, trust boundaries. Update the diagrams in the same change as the flow.
- `.agents/skills/` — NEAR skills (near-intents, near-ai-cloud, near-dapp, near-kit). Read the relevant one before changing that integration.
- Every query is scoped by `orgId` from the JWT. Never read `orgId` from a body, query param, or model/tool output.

## Things that will bite you

- **The ledger is append-only and must balance.** Journal entries are never updated or deleted; corrections are reversal entries. `AccountingService.post()` rejects unbalanced or zero-value entries, and `dedupeKey` has a unique partial index.
- **Every system posting is idempotent.** The key is `invoice:<id>:APPROVED|PAID|VOID`, `receivable:<id>:ISSUED|VOID`, `receipt:<receiptId>:RECEIVED`, or `opening:<orgId>:<currency>`. Do not post without one.
- **Posting is best-effort, not transactional.** Mongo is a single node. State changes commit first, the journal entry is attempted next, and `POST /accounting/rebuild` backfills missing entries. Never "fix" a missing posting by editing a journal entry.
- **AP/AR recognition points:** bill approval (`InvoicesService.decide`), settlement (`markPaid`), invoice void (`void`), receivable issue, receipt, and receivable void. `DemoService` writes statuses directly, so it calls `rebuild` at the end.
- **Do not aggregate ledger money with `$toDouble`.** Use `$toDecimal` (or `$toLong`) and keep the result as an integer string. The existing invoice summary's `$toDouble` predates the ledger; do not copy it.
- **Receivable receipts use an optimistic lock on `paidAmount`.** The update filter includes the previous `paidAmount` so two concurrent receipts cannot overpay an invoice. Keep that filter.
- **`AccountingModule` registers the `Invoice` and `Receivable` schemas directly** so `rebuild` can scan the subledgers without a module cycle. Do not import `InvoicesModule`/`ReceivablesModule` into it.
- **1Click is mainnet-only.** No testnet exists. Keep `PAYMENTS_MODE=mock` for dev, tests and CI. `smoke.ts` must never hit the network.
- **Never construct an `assetId`.** Resolve from `GET /v0/tokens` (cached 1h). The mock provider has its own token list.
- **Money is an integer minor unit, stored as a string.** Use `parseUnits` / `formatUnits` from `@keiz/shared`. `formatMoney` expects minor units; `formatDollars` expects major units. Mixing them silently divides by 100 — this bug already shipped once.
- **1Click quote semantics:** `dry:true` = preview, `dry:false` = commit and returns a deposit address valid ~10 min. `amountOutUsd` is display-only. Quote with `EXACT_OUTPUT` so the vendor receives the exact invoice amount.
- **Wallet login is NEP-413.** The user signs a one-time message with a NEAR wallet. `NearVerifyService` checks the ed25519 signature and requires a full-access key on-chain — function-call keys are rejected deliberately. The challenge is single-use, TTL-indexed and bound to `CHAIN_NETWORK`.
- **NEAR Auth login is also NEP-413.** Auth0 (passkey, Google, Apple, email) derives an MPC key; the client requests a message signature through `fast-auth`, then posts it to the same `/auth/verify`. The relayer at `POST /auth/near-auth/relay` only forwards `sign` to the configured `fast-auth` contract, only for the expected `jwt#https://<auth0-domain>/` guard, within the gas cap and with a 1 yoctoNEAR deposit.
- **The published NEAR Auth SDK predates `requestMessageSignature`.** `@fast-auth-near/browser-sdk@1.4.2` / `javascript-provider@1.4.1` do not expose it despite the docs. `apps/web/src/lib/near-auth.ts` feature-detects it and falls back to the `nep413` Auth0 authorization parameter. Remove the fallback and `@auth0/auth0-spa-js` when the npm release catches up.
- **New NEAR Auth users are implicit accounts** (hex of the ed25519 public key) that may not exist on-chain. `NearVerifyService` accepts that only when `view_account` says `UNKNOWN_ACCOUNT` and `accountId === hex(publicKey)`. Do not relax this to "any RPC error".
- **On-chain AR/AP contracts live in `contracts/`.** `keiz-collect` is the NEP-141 receiver; `keiz-vault` is the approval/policy treasury. Build with `PATH="$HOME/.cargo/bin:$PATH" pnpm contracts:build` (the Homebrew rustc has no wasm std). 1Click cross-chain AR uses `customRecipientMsg`; cross-chain AP transfers to a committed 1Click deposit address. 1Click is mainnet-only.
- **AR receipts are indexed from the collect contract.** `IndexerService.syncCollectReceipts` reads `get_receipts`, converts the token amount to the receivable's decimals, rejects overpayments, and records `ONCHAIN` receipts keyed by `collect:<contract>:<receiptId>`. The contract has no tx hash; the synthetic id is the chain event key.
- **Do not route treasury calls through the NEAR Auth relayer.** `/auth/near-auth/relay` is `fast-auth.sign` only and must stay that way; AP proposals/approvals are wallet-signed or use a separate transaction relayer with its own contract/method allowlist.
- **One network source of truth.** `CHAIN_NETWORK` (falling back to `NEXT_PUBLIC_CHAIN_NETWORK`) is canonical. The API rejects a challenge for any other network and binds users/orgs to it. `auditNetworkConfig` fails startup on intents-on-testnet, NEAR Auth contract/RPC mismatches and OutLayer host mismatches. Do not add another network switch.
- **NEP-413:** Borsh `[tag 2^31+413][message][nonce:32][recipient][Option<callback>]` → sha256 → ed25519. `recipient` must match exactly; nonce is single-use and TTL-indexed. Full-access keys only — function-call keys are rejected deliberately.
- **Next proxies `/api/*` to Nest** so the httpOnly session cookie stays same-origin. Do not add `NEXT_PUBLIC_API_URL` and call `:3001` from the browser.
- **Next does not read the repo-root `.env`, and `@next/env` no-ops inside `next.config`.** `apps/web/next.config.ts` parses the root `.env` manually and declares values under `env:` for the client. If a `NEXT_PUBLIC_*` var "doesn't work", check that path before debugging React.
- **Tailwind 4 has no `tailwind.config.js`.** Theme tokens are in `apps/web/src/app/globals.css` under `@theme`.
- **`.lean()` documents have `_id`, not `id`.** Use `String(doc._id)`. `doc.id` is `undefined` and produces broken references that only fail at the next Mongoose validation.
- **Do not run `pnpm build` while `pnpm dev` is running.** Both write `apps/api/dist`; the watcher process loses its modules and exits with `MODULE_NOT_FOUND`. Stop dev, build, restart.
- **Do not run the API with `tsx`/esbuild.** It does not emit `design:type`, so Mongoose throws `CannotDetermineTypeError`. Use `ts-node` (seed, smoke, dev-mongo) or `nest build`.
- **Queues are BullMQ.** `REDIS_URL` is required in dev/prod; run `pnpm worker`. `QUEUES_ENABLED=false` is for tests only — it makes producers no-ops and the NEAR Auth relay falls back inline. BullMQ job ids cannot contain `:`; use hyphens.
- **Mastra owns chat history** in `mastra_threads` / `mastra_messages`, through a second Mongo client (`@mastra/mongodb`). Do not reintroduce `ChatThread`; duplicate stores drift. `MastraLifecycle` closes the store on shutdown — without it the process hangs.
- **Chat tools must read `orgId` from `requestContext`**, never from model input. `createTool` tools are shared across all tenants; a tool that trusts `inputData` is a cross-tenant leak.
- **`/login` is the only sign-in entry.** It follows near.com's centered layout. Dashboard routes redirect there when unauthenticated; `ConnectButton` links there. Do not add a second login card.
- **Both sign-in paths live on `/login`.** The NEAR Auth card is primary and the NEAR Wallets button sits below it. Both clients are preloaded there so their popups open inside the click gesture. Dashboard routes redirect to `/login` when unauthenticated; `ConnectButton` links there. Do not add another login page.
- **Frontend deposits are signed in the wallet** (`useAuth().sendTransactions`). Mock mode uses the ADMIN-only simulation.
- **`CHAT_PROVIDER=mastra` without `NEARAI_API_KEY` falls back to local on purpose.** The local path calls the same Mastra tools and persists messages manually. Tests run this way, so chat stays offline.
- **Do not use `@mastra/nestjs`.** Its adapter registers a catch-all controller that would expose `/agents/*` outside our JWT guard. We inject the `Mastra` instance directly.
- **Chat transport is SSE we own**, not the AI SDK protocol. Events: `meta`, `thread`, `text`, `tool` (`phase: call|result`), `done`, `error`. The parser lives in `packages/shared/src/sse.ts`; keep both ends in sync.
- **Model ids are `nearai/<model>`** (e.g. `nearai/deepseek/deepseek-v4.1-flash-1017`). The `nearai/` prefix is applied automatically; do not pass a bare `deepseek-ai/...` id.
- **OutLayer SDK hosts are stale.** `@outlayer/sdk` defaults to `api.*.outlayer.fastnear.com` (unreachable). Always pass `baseUrl` from `OUTLAYER_BASE_URL` (`https://api.outlayer.ai` / `https://testnet-api.outlayer.ai`). The alpha SDK is pinned; keep the wrapper in `outlayer.service.ts`.
- **Custody API keys are full wallet authority.** Stored AES-256-GCM with `select:false`, never returned except as the OWNER-only handoff URL, never logged.
- **For `provider=outlayer`, local USD caps are skipped.** Policy is delegated to OutLayer’s on-chain TEE policy; `propose` auto-approves and `execute` runs `withdrawDryRun` first. Do not re-add local caps — the default $500 would block every real invoice.
- **OutLayer Intents (cross-chain withdraw/swap) are mainnet-only.** Testnet returns 503 for `/wallet/v1/intents/*`; registration/address/balance/NEAR calls work.
- **`needs_review` is terminal and must never auto-retry.** The poller leaves the invoice `PAYMENT_PENDING`; a human resolves it in OutLayer.
- **Agent keys:** AES-256-GCM, `select:false`, never returned or logged. `AGENT_WALLET_MASTER_KEY` is mandatory in production. Policy is evaluated at proposal *and* re-evaluated at execution.
- **RBAC is real now.** `JwtAuthGuard` reloads the membership and `tokenVersion` on every request; `RolesGuard` reads `@Roles`. Do not add a mutating route without deciding its role. `MEMBER` cannot approve, change policy, execute agents, simulate, seed, or read the audit log.
- **Separation of duties:** an invoice creator cannot approve their own bill once another APPROVER/ADMIN/OWNER exists in the org. Solo workspaces still work.
- **Deposit hashes are verified via NEAR RPC** in `intents` mode: success, `ft_transfer` on the quoted token contract, the quote's deposit address, and `amount >= amountIn`. Never accept a client hash without this check.
- **Daily agent spend uses an atomic conditional `$inc`** on `agent_daily_spend`; do not replace it with an aggregate check. Execution is claimed atomically (`APPROVED → EXECUTING`) and payment creation uses an idempotency key.
- **One live quote per invoice** is a partial unique index. If you change payment statuses, update that index or duplicates become possible again.
- **Refresh tokens rotate with reuse detection.** Reuse bumps `tokenVersion`, invalidating every access token. Do not remove the check to "fix" a 401.
- **AuditInterceptor logs every mutating request** (method, path, user, status, IP) without bodies. It is fire-and-forget; do not await it in request paths.
- **pnpm 11:** build scripts must be allowlisted in `pnpm-workspace.yaml` (`allowBuilds`). That file also sets `minimumReleaseAge: 0` because the repo pins same-day framework releases.

## Auth without a wallet

Real login requires a wallet signature. To inspect the dashboard, seed an account and mint a cookie:

```bash
pnpm --filter @keiz/api seed demo.near
cd apps/api && npx ts-node --project tsconfig.json test/dev-token.ts demo.near
# set cookie keiz_access=<token> for localhost
```

There is no impersonation endpoint in the app. This script is dev-only.

## Testing

- `apps/api/test/smoke.ts` boots the real app against `mongodb-memory-server` and runs 48 checks: auth scoping + refresh reuse, totals, approval, tenant isolation, quote→deposit→settle, event log, agent policy + atomic daily cap, RBAC, duplicate quotes, address/amount validation, audit log, local chat streaming, demo seed, NEAR Auth relayer fencing. Run it before touching payment code.
- `apps/api/test/outlayer-smoke.ts` runs the custody flow against a mock OutLayer API: register, describe, token resolution, dry-run, withdraw, polling, invoice settlement.
- `apps/api/test/mastra-smoke.ts` runs the real Mastra agent against a mock OpenAI-compatible server (`test/mock-openai.ts`), proving stream mapping, request-scoped tools, memory persistence and thread isolation without a NEAR AI key.
- Unit tests are colocated `*.spec.ts` (57 API + 15 shared at the time of writing).
- Mock payment: `POST /api/payments/:id/simulate?status=SUCCEEDED`, then `POST /api/payments/:id/refresh` (or wait for the 4s poller).
