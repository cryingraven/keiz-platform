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
- `apps/api` — Nest 12 + Mongoose 9. Feature folders: `auth`, `users` (members/orgs), `vendors`, `invoices` (AP), `receivables` (AR + customers), `accounting`, `payments`, `agent`, `outlayer`, `chat`, `indexer`, `queues`, `audit`, `demo`.
- `apps/api/src/chat` — Mastra agent, tools, memory and the SSE controller. Mastra owns conversations; there is no local thread schema.
- `apps/api/src/worker.ts` — BullMQ worker entry point (`worker.module.ts`); runs the payment, OutLayer and indexer processors.
- `packages/shared` — the only place DTOs, Zod schemas, status enums and money helpers live.
- `contracts/` — `keiz-collect` (AR receiver), `keiz-vault` (AP treasury) and `deploy/` scripts. See `contracts/README.md`.
- `docs/architecture.md` — system context, request lifecycle, auth/payment/custody/chat sequences, state machines, data model, trust boundaries. Update the diagrams in the same change as the flow.
- `docs/api.md` — full route/role reference; `docs/data-model.md` — collections, fields and indexes.
- `.agents/skills/` — NEAR skills (near-intents, near-ai-cloud, near-dapp, near-kit) plus `keiz-accounting`. Read the relevant one before changing that integration.
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
- **Passkey login is self-hosted WebAuthn, not NEAR Auth.** `apps/api/src/auth/webauthn` is the relying party. A passkey creates/authenticates a user; the derived ed25519 key lives only in the browser and is unlocked by the WebAuthn PRF extension. The API stores an AES-256-GCM wrap of the seed, never the seed itself. There is no Auth0, fast-auth, MPC or relayer.
- **The PRF output must never reach the API.** It unwraps the NEAR seed. `apps/web/src/lib/passkey/client.ts` strips `clientExtensionResults.prf`; the API rejects any body containing a `prf` key. Keep both guards.
- **Passkey signup proves both factors.** A new implicit account must pass WebAuthn registration **and** a NEP-413 signature from the derived key. Without the latter an attacker could claim an arbitrary implicit account id. `PasskeyService.signupVerify` does both.
- **New passkey accounts are implicit accounts** (hex of the ed25519 public key) that may not exist on-chain. `NearVerifyService` accepts that only when `view_account` says `UNKNOWN_ACCOUNT` and `accountId === hex(publicKey)`. Do not relax this to "any RPC error".
- **Passkeys are bound to `WEBAUTHN_RP_ID` forever.** Changing the RP ID invalidates every credential. Production requires an HTTPS origin that is the RP ID or a subdomain; `auditWebAuthnConfig` fails startup otherwise. No auth0/fast-auth envs remain.
- **On-chain AR/AP contracts live in `contracts/`.** `keiz-collect` is the NEP-141 receiver; `keiz-vault` is the approval/policy treasury. Build with `PATH="$HOME/.cargo/bin:$PATH" pnpm contracts:build` (the Homebrew rustc has no wasm std). 1Click cross-chain AR uses `customRecipientMsg`; cross-chain AP transfers to a committed 1Click deposit address. 1Click is mainnet-only.
- **AR receipts are indexed from the collect contract.** Each workspace stores its own `collection` config on `Organization` (Settings → AR collection). `IndexerService.syncCollectReceipts` iterates active orgs, reads each contract, converts the token amount to the receivable's decimals, rejects overpayments, and records `ONCHAIN` receipts keyed by `collect:<orgId>:<contractId>:<receiptId>`. Never reintroduce a global collect contract/org env. `OrgCollectionService.validate` checks `get_org_id`, `get_treasury`, `is_token_allowed` and (when `KEIZ_COLLECT_CODE_HASH` is set) the deployed code hash before a workspace contract can be activated; in production the hash is mandatory.
- **One live PaymentIntent per invoice.** `payment_intents` has a partial unique index on `(orgId, invoiceId)` for `OPEN`/`EXECUTING`. Every rail must reserve before moving funds; never bypass it when adding vault execution.
- **Treasury calls are wallet-signed.** There is no NEAR Auth relayer. AP proposals/approvals are signed by the user's wallet or the passkey-derived signer; do not add a generic transaction relayer without its own contract/method allowlist.
- **One network source of truth.** `CHAIN_NETWORK` (falling back to `NEXT_PUBLIC_CHAIN_NETWORK`) is canonical. The API rejects a challenge for any other network and binds users/orgs to it. `auditNetworkConfig` fails startup on intents-on-testnet and OutLayer host mismatches; `auditWebAuthnConfig` fails on RP ID/origin mismatches. Do not add another network switch.
- **NEP-413:** Borsh `[tag 2^31+413][message][nonce:32][recipient][Option<callback>]` → sha256 → ed25519. `recipient` must match exactly; nonce is single-use and TTL-indexed. Full-access keys only — function-call keys are rejected deliberately.
- **Next proxies `/api/*` to Nest** so the httpOnly session cookie stays same-origin. Do not add `NEXT_PUBLIC_API_URL` and call `:3001` from the browser.
- **Next does not read the repo-root `.env`, and `@next/env` no-ops inside `next.config`.** `apps/web/next.config.ts` parses the root `.env` manually and declares values under `env:` for the client. If a `NEXT_PUBLIC_*` var "doesn't work", check that path before debugging React.
- **Tailwind 4 has no `tailwind.config.js`.** Theme tokens are in `apps/web/src/app/globals.css` under `@theme`.
- **`.lean()` documents have `_id`, not `id`.** Use `String(doc._id)`. `doc.id` is `undefined` and produces broken references that only fail at the next Mongoose validation.
- **Do not run `pnpm build` while `pnpm dev` is running.** Both write `apps/api/dist`; the watcher process loses its modules and exits with `MODULE_NOT_FOUND`. Stop dev, build, restart.
- **Do not run the API with `tsx`/esbuild.** It does not emit `design:type`, so Mongoose throws `CannotDetermineTypeError`. Use `ts-node` (seed, smoke, dev-mongo) or `nest build`.
- **Queues are BullMQ.** `REDIS_URL` is required in dev/prod; run `pnpm worker`. `QUEUES_ENABLED=false` is for tests only — it makes producers no-ops. BullMQ job ids cannot contain `:`; use hyphens.
- **Mastra owns chat history** in `mastra_threads` / `mastra_messages`, through a second Mongo client (`@mastra/mongodb`). Do not reintroduce `ChatThread`; duplicate stores drift. `MastraLifecycle` closes the store on shutdown — without it the process hangs.
- **Chat tools must read `orgId` from `requestContext`**, never from model input. `createTool` tools are shared across all tenants; a tool that trusts `inputData` is a cross-tenant leak.
- **Chat is plan-first and human-in-the-loop.** `plan-actions` must be the first tool; `beforeToolCall` blocks everything else until `planApproved` is set. Reads run automatically; `write`/`spend` tools (`propose-payment`, `create-vendor`, `create-customer`, `create-bill`, `create-receivable`) use `requireApproval: true`. Creation tools are DRAFT-first; only `create-bill` with `submit` and `create-receivable` with `issue` advance state, and AR issue posts to the ledger. `create-vendor` is ADMIN/OWNER only, enforced in both the plan gate and the tool. Approvals resume through `POST /chat/approvals` after `listSuspendedRuns` ownership checks. Tool results are Zod-validated `ChatCard` envelopes rendered by `apps/web/src/components/chat/cards.tsx`; creation confirmations use the structured `apps/web/src/components/chat/create-preview.tsx` instead of raw JSON. The UI hides cards until the final answer and hides the plan once final. Keep `accounting-guide.ts` and `.agents/skills/keiz-accounting/SKILL.md` in sync.
- **`/login` is the only sign-in entry.** It follows near.com's centered layout. Dashboard routes redirect there when unauthenticated; `ConnectButton` links there. Do not add a second login card. The NEAR wallet list comes from `connector.availableWallets` in `apps/web/src/lib/auth.tsx` (filtered by NEP-413 `signMessage` and network); never hardcode wallet names. Connecting a row uses `connector.connect({ walletId })`, with the built-in selector kept as a fallback.
- **Both sign-in paths live on `/login`.** The passkey card is primary and the NEAR wallet list sits below it. The wallet connector is preloaded so row clicks connect inside the gesture; passkey ceremonies need no preload. Dashboard routes redirect to `/login` when unauthenticated; `ConnectButton` links there. Do not add another login page.
- **Deposits use the active signer.** `useAuth().sendTransactions` picks `PasskeySigner` for passkey/recovery sessions and the wallet for wallet sessions. Never let a wallet account different from `session.user.accountId` sign a deposit. Mock mode uses the ADMIN-only simulation.
- **`CHAT_PROVIDER=mastra` without `NEARAI_API_KEY` falls back to local on purpose.** The local path calls the same Mastra tools and persists messages manually. Tests run this way, so chat stays offline.
- **Do not use `@mastra/nestjs`.** Its adapter registers a catch-all controller that would expose `/agents/*` outside our JWT guard. We inject the `Mastra` instance directly.
- **Chat transport is SSE we own**, not the AI SDK protocol. Events: `meta`, `thread`, `text`, `tool` (`phase: call|result`), `done`, `error`. The parser lives in `packages/shared/src/sse.ts`; keep both ends in sync.
- **Model ids are `nearai/<model>`** (e.g. `nearai/deepseek-ai/DeepSeek-V4.1-Flash-1017`). The `nearai/` prefix is applied automatically; do not pass a bare `deepseek-ai/...` id. Use the `deepseek-ai/...` variant: it is served by NEAR AI's attested TEE. The `deepseek/...` variant is an external OpenRouter ZDR route and `/v1/attestation/report` returns 503 for it, so it breaks the TEE/privacy claim.
- **OutLayer SDK hosts are stale.** `@outlayer/sdk` defaults to `api.*.outlayer.fastnear.com` (unreachable). Always pass `baseUrl` from `OUTLAYER_BASE_URL` (`https://api.outlayer.ai` / `https://testnet-api.outlayer.ai`). The alpha SDK is pinned; keep the wrapper in `outlayer.service.ts`.
- **Custody API keys are full wallet authority.** Stored AES-256-GCM with `select:false`, never returned except as the OWNER-only handoff URL, never logged.
- **For `provider=outlayer`, local USD caps are skipped.** Policy is delegated to OutLayer’s on-chain TEE policy; `propose` auto-approves and `execute` runs `withdrawDryRun` first. Do not re-add local caps — the default $500 would block every real invoice. Execution requires `policy_check.decision` to be `allowed`/`requires_approval`; `no_policy_allow` is blocked. Custody payouts are USD-only, and the action stays `EXECUTING` until the request reaches `success`.
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

- `apps/api/test/smoke.ts` boots the real app against `mongodb-memory-server` and runs 50 checks: auth scoping + refresh reuse, totals, approval, tenant isolation, quote→deposit→settle, event log, agent policy + atomic daily cap, RBAC, duplicate quotes, address/amount validation, audit log, local chat plan/approval/cards, demo seed, passkey endpoint fencing, AP/AR recognition and settlement, receipts, trial balance, aging, rebuild, member management and org switching. Run it before touching payment code.
- `apps/api/test/outlayer-smoke.ts` runs the custody flow against a mock OutLayer API: register, describe, token resolution, dry-run, withdraw, polling, invoice settlement.
- `apps/api/test/mastra-smoke.ts` runs the real Mastra agent against a mock OpenAI-compatible server (`test/mock-openai.ts`), proving stream mapping, request-scoped tools, memory persistence and thread isolation without a NEAR AI key.
- Unit tests are colocated `*.spec.ts` (69 API + 15 shared at the time of writing).
- Mock payment: `POST /api/payments/:id/simulate?status=SUCCEEDED`, then `POST /api/payments/:id/refresh` (or wait for the 4s poller).
