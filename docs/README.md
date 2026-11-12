# KEIZ documentation

Start here:

| Document | What it explains |
|---|---|
| [Architecture & diagrams](./architecture.md) | System context, module map, request lifecycle, auth/payment/agent/chat sequences, state machines, data model, trust boundaries |
| [API reference](./api.md) | Every route with its role, request schema, and key status/error behavior |
| [Chat cards & approvals](./chat-cards.md) | Tool output cards, plan-first flow, confirmation gates and detail links |
| [Data model](./data-model.md) | Collections, fields, indexes and invariants (including Mastra storage) |
| [Integration & contracts](./integrations.md) | On-chain AR collection (contract or treasury), 1Click quotes, share payments, vault/policy contract, OutLayer custody policy, payout verification, queues |
| [Contract README](../contracts/README.md) | Contract ABIs, message formats, event schemas, deployment |
| [Security model](../README.md#security-model) | RBAC, deposit verification, quote idempotency, agent controls, sessions, hardening |
| [Agent custody](../README.md#agent-custody-outlayer) | OutLayer wallets, policy handoff, funding, testnet/mainnet limits |
| [Login (passkey + wallet)](../README.md#login-passkey--wallet) | WebAuthn PRF passkey, self-custodial key wrap, NEP-413 wallet sign-in |
| [Submission guide](../submission-guide.md) | NEAR HACKATHON checklist, tracks, demo script and submission API |
| [AGENTS.md](../AGENTS.md) | Repo rules and gotchas for coding agents |

## Diagram conventions

- Diagrams are Mermaid and must render on GitHub (`flowchart`, `sequenceDiagram`,
  `stateDiagram-v2`, `erDiagram`).
- Keep the flow names aligned with the code: `AWAITING_DEPOSIT`, `PROCESSING`,
  `NEEDS_REVIEW`, `PENDING_APPROVAL`, `EXECUTING`, `SETTLED`.
- When a flow changes, update `architecture.md` in the same PR. The sequence
  diagrams are the fastest way to review a payment or auth change.
- Routes and model changes should also update `api.md` and `data-model.md`.
- Do not put secrets, real API keys, or account private keys in diagrams.

## Repo quick links

- Web: [`apps/web`](../apps/web)
- API: [`apps/api`](../apps/api)
- Shared contracts: [`packages/shared`](../packages/shared)
- Rust contracts: [`contracts`](../contracts)
