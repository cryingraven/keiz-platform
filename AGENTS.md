# KEIZ

B2B spend workspace. Next.js web + NestJS API, invoice approvals, NEAR Intents settlement, NEAR AI assistant, policy-bound agent wallet. Auth is NEP-413.

## Commands

```bash
pnpm install
pnpm dev                              # web :3000 + api :3001 (turbo)
pnpm build                            # shared -> api -> web
pnpm typecheck
pnpm test                             # unit: money, NEP-413, agent policy

pnpm --filter @keiz/api test -- src/agent/policy.spec.ts   # one spec
pnpm --filter @keiz/api smoke         # full e2e, in-memory Mongo, no network
pnpm --filter @keiz/api smoke:mastra  # Mastra stream + tools + memory, mock model

docker compose up -d                  # mongo :27017
pnpm --filter @keiz/api db:memory     # fallback when Docker is down (ephemeral)
pnpm --filter @keiz/api seed demo.near
```

## Layout

- `apps/web` — Next 16 App Router, Tailwind 4. Dashboard is client-rendered; data comes from `/api/*`.
- `apps/api` — Nest 12 + Mongoose 9. Feature folders: `auth`, `invoices`, `payments`, `agent`, `chat`, `indexer`.
- `apps/api/src/chat` — Mastra agent, tools, memory and the SSE controller. Mastra owns conversations; there is no local thread schema.
- `packages/shared` — the only place DTOs, Zod schemas, status enums and money helpers live.
- `.agents/skills/` — NEAR skills (near-intents, near-ai-cloud, near-dapp, near-kit). Read the relevant one before changing that integration.
- Every query is scoped by `orgId` from the JWT. Never read `orgId` from a body, query param, or model/tool output.

## Things that will bite you

- **1Click is mainnet-only.** No testnet exists. Keep `PAYMENTS_MODE=mock` for dev, tests and CI. `smoke.ts` must never hit the network.
- **Never construct an `assetId`.** Resolve from `GET /v0/tokens` (cached 1h). The mock provider has its own token list.
- **Money is an integer minor unit, stored as a string.** Use `parseUnits` / `formatUnits` from `@keiz/shared`. `formatMoney` expects minor units; `formatDollars` expects major units. Mixing them silently divides by 100 — this bug already shipped once.
- **1Click quote semantics:** `dry:true` = preview, `dry:false` = commit and returns a deposit address valid ~10 min. `amountOutUsd` is display-only. Quote with `EXACT_OUTPUT` so the vendor receives the exact invoice amount.
- **Passkey login is NEAR Auth (FastAuth), not raw WebAuthn.** Auth0 issues a JWT, `fast-auth` verifies it, MPC signs a NEP-413 message. The client builds the `sign` action with the Browser SDK; the API relayer submits it. The relayer only allows `sign` on the configured `fast-auth` contract, gas ≤ `NEAR_AUTH_RELAYER_MAX_GAS`, deposit 0.
- **New passkey users are implicit accounts** (hex of the ed25519 public key) that may not exist on-chain. `NearVerifyService` accepts that only when `view_account` says `UNKNOWN_ACCOUNT` and `accountId === hex(publicKey)`. Do not relax this to "any RPC error".
- **Wallet auth is mainnet, passkey auth is testnet by default.** The challenge stores the network and `assertFullAccessKey` picks `NEAR_RPC_URL` or `NEAR_AUTH_RPC_URL` accordingly. Do not hardcode one RPC for both.
- **NEP-413:** Borsh `[tag 2^31+413][message][nonce:32][recipient][Option<callback>]` → sha256 → ed25519. `recipient` must match exactly; nonce is single-use and TTL-indexed. Full-access keys only — function-call keys are rejected deliberately.
- **Next proxies `/api/*` to Nest** so the httpOnly session cookie stays same-origin. Do not add `NEXT_PUBLIC_API_URL` and call `:3001` from the browser.
- **Next does not read the repo-root `.env`, and `@next/env` no-ops inside `next.config`.** `apps/web/next.config.ts` parses the root `.env` manually and declares values under `env:` for the client. If a `NEXT_PUBLIC_*` var "doesn't work", check that path before debugging React.
- **Tailwind 4 has no `tailwind.config.js`.** Theme tokens are in `apps/web/src/app/globals.css` under `@theme`.
- **`.lean()` documents have `_id`, not `id`.** Use `String(doc._id)`. `doc.id` is `undefined` and produces broken references that only fail at the next Mongoose validation.
- **Do not run `pnpm build` while `pnpm dev` is running.** Both write `apps/api/dist`; the watcher process loses its modules and exits with `MODULE_NOT_FOUND`. Stop dev, build, restart.
- **Do not run the API with `tsx`/esbuild.** It does not emit `design:type`, so Mongoose throws `CannotDetermineTypeError`. Use `ts-node` (seed, smoke, dev-mongo) or `nest build`.
- **No Redis.** The payment poller is `@nestjs/schedule` with an in-process lock. It assumes a single API instance; do not scale horizontally without replacing it.
- **Mastra owns chat history** in `mastra_threads` / `mastra_messages`, through a second Mongo client (`@mastra/mongodb`). Do not reintroduce `ChatThread`; duplicate stores drift. `MastraLifecycle` closes the store on shutdown — without it the process hangs.
- **Chat tools must read `orgId` from `requestContext`**, never from model input. `createTool` tools are shared across all tenants; a tool that trusts `inputData` is a cross-tenant leak.
- **`/login` is the only sign-in entry.** It follows near.com's centered layout. Dashboard routes redirect there when unauthenticated; `ConnectButton` links there. Do not add a second login card.
- **Wallet login is ON by default.** `NEXT_PUBLIC_WALLET_LOGIN=true` constructs `NearConnector` only after the user clicks the NEAR Wallets card on `/login`; it is never loaded at page load. Setting the flag to `false` hides the card and skips the connector entirely. Do not import near-connect elsewhere.
- **Frontend deposits are signed in the wallet** (`useAuth().sendTransactions`) only when wallet login is enabled. Passkey-only mainnet mode shows the verified transaction-hash fallback; mock mode uses the ADMIN-only simulation.
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

- `apps/api/test/smoke.ts` boots the real app against `mongodb-memory-server` and runs 29 checks: auth scoping + refresh reuse, totals, approval, tenant isolation, quote→deposit→settle, event log, agent policy + atomic daily cap, RBAC, duplicate quotes, address/amount validation, audit log, local chat streaming, demo seed. Run it before touching payment code.
- `apps/api/test/outlayer-smoke.ts` runs the custody flow against a mock OutLayer API: register, describe, token resolution, dry-run, withdraw, polling, invoice settlement.
- `apps/api/test/mastra-smoke.ts` runs the real Mastra agent against a mock OpenAI-compatible server (`test/mock-openai.ts`), proving stream mapping, request-scoped tools, memory persistence and thread isolation without a NEAR AI key.
- Unit tests are colocated `*.spec.ts`.
- Mock payment: `POST /api/payments/:id/simulate?status=SUCCEEDED`, then `POST /api/payments/:id/refresh` (or wait for the 4s poller).
