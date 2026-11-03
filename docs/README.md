# KEIZ documentation

Start here:

| Document | What it explains |
|---|---|
| [Architecture & diagrams](./architecture.md) | System context, module map, request lifecycle, auth/payment/agent/chat sequences, state machines, data model, trust boundaries |
| [Security model](../README.md#security-model) | RBAC, deposit verification, quote idempotency, agent controls, sessions, hardening |
| [Agent custody](../README.md#agent-custody-outlayer) | OutLayer wallets, policy handoff, funding, testnet/mainnet limits |
| [Passkey login](../README.md#passkey-login-near-auth) | NEAR Auth, Auth0, the relayer, implicit accounts |
| [AGENTS.md](../AGENTS.md) | Repo rules and gotchas for coding agents |

## Diagram conventions

- Diagrams are Mermaid and must render on GitHub (`flowchart`, `sequenceDiagram`,
  `stateDiagram-v2`, `erDiagram`).
- Keep the flow names aligned with the code: `AWAITING_DEPOSIT`, `PROCESSING`,
  `needs_review`, `PENDING_APPROVAL`, `EXECUTING`.
- When a flow changes, update `architecture.md` in the same PR. The sequence
  diagrams are the fastest way to review a payment or auth change.
- Do not put secrets, real API keys, or account private keys in diagrams.

## Repo quick links

- Web: [`apps/web`](../apps/web)
- API: [`apps/api`](../apps/api)
- Shared contracts: [`packages/shared`](../packages/shared)
