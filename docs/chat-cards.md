# Chat cards and agent approvals

The AI assistant never renders raw tool output. Every tool returns a validated
`ChatCard` envelope, emitted over SSE as a `card` event, and the web client renders a
tailored card with a link to the relevant detail page.

## Events

| Event | Payload | Purpose |
|---|---|---|
| `plan` | `ChatPlan` | The action plan shown before any tool runs. |
| `card` | `ChatCard` | Detailed, typed tool result. |
| `approval` | `ChatApprovalRequest` | A suspended tool call waiting for Approve/Decline. |
| `approval_result` | `{ toolCallId, approved, reason? }` | Resolution of an approval. |
| `done` | `{ threadId, usage?, suspended? }` | End of a stream; `suspended` means an approval is pending. |

## Lifecycle

1. The model calls `plan-actions`. The run suspends.
2. The UI shows the Plan card and posts the decision to `POST /api/chat/approvals`.
3. After plan approval, `plan-actions` opens the tool gate.
4. Read-only tools run automatically and emit cards.
5. Write/drafting tools suspend and show a confirmation card.
6. `POST /api/chat/approvals` resumes the run and streams the continuation.
7. `GET /api/chat/approvals?threadId=` restores pending write approvals when a thread is reopened.

The UI hides result cards and tool traces until the final answer. While the plan is running it
shows only the plan, progress, and any pending write confirmation. Once the final result is
shown, the plan card is hidden and the accumulated cards are revealed.

Mastra snapshots live in the shared Mongo store. Ownership is checked with
`listSuspendedRuns({ threadId, resourceId })` where
`resourceId = org:<orgId>:user:<userId>`. The local fallback mirrors this with an in-memory
`LocalRunStore` and the same events.

## Envelope

```ts
interface ChatCard<K, D> {
  kind: K;
  title: string;
  subtitle?: string;
  link: ChatCardLink;          // "View details"
  relatedLinks?: ChatCardLink[];
  data: D;
}
```

Money is always `{ currency, decimals, minor, formatted }`. `minor` is an integer string;
`formatted` is already in major units and must not be re-scaled.

## Card kinds and links

| Kind | Detail link |
|---|---|
| `invoice-list` | `/dashboard/invoices`; each row → `/dashboard/invoices/{id}` |
| `invoice` | `/dashboard/invoices/{id}` |
| `spend-summary` | `/dashboard/invoices` |
| `books-summary` | `/dashboard/accounting` |
| `vendor-list` | `/dashboard/vendors`; each row → `/dashboard/vendors/{id}` |
| `vendor` | `/dashboard/vendors/{id}` |
| `customer-list` | `/dashboard/customers`; each row → `/dashboard/customers/{id}` |
| `customer` | `/dashboard/customers/{id}` |
| `receivable-list` | `/dashboard/receivables`; each row → `/dashboard/receivables/{id}` |
| `receivable` | `/dashboard/receivables/{id}` |
| `payment-list` | `/dashboard/payments`; each row → `/dashboard/payments/{id}` |
| `payment` | `/dashboard/payments/{id}` |
| `agent-action-list` | `/dashboard/agent`; each row → its invoice |
| `agent-action` | its invoice |
| `journal-list` | `/dashboard/accounting?entry={id}` |
| `plan` | `/dashboard/agent` |

Links are built server-side from record ids. The model never supplies a URL.

## Tools

| Tool | Card | Confirmation |
|---|---|---|
| `plan-actions` | `plan` | plan approval |
| `list-invoices` / `get-invoice` | `invoice-list` / `invoice` | none |
| `spend-summary` | `spend-summary` | none |
| `books-summary` | `books-summary` | none |
| `list-vendors` / `get-vendor` | `vendor-list` / `vendor` | none |
| `list-receivables` / `get-receivable` | `receivable-list` / `receivable` | none |
| `list-customers` / `get-customer` | `customer-list` / `customer` | none |
| `list-payments` / `get-payment` | `payment-list` / `payment` | none |
| `list-agent-actions` | `agent-action-list` | none |
| `journal-summary` | `journal-list` | none |
| `propose-payment` | `agent-action` | required |

`propose-payment` only creates an agent action. It never moves funds.

## Files

- Types and Zod schemas: `packages/shared/src/chat-cards.ts`
- Builders and human summaries: `apps/api/src/chat/cards.ts`
- Plan tool and gate: `apps/api/src/chat/plan.ts`
- SSE mapping: `apps/api/src/chat/stream-mapper.ts`
- Web renderers: `apps/web/src/components/chat/cards.tsx`
- Accounting guide: `apps/api/src/chat/accounting-guide.ts`
