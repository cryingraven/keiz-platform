---
name: keiz-accounting
description: KEIZ accounting and finance domain knowledge. Use when working on the AP/AR subledgers, double-entry journal, approvals, money formatting, payment rails, agent payment proposals, the chat assistant, or any code that reasons about invoices, receivables, receipts, balances or spend.
metadata:
  author: keiz
  version: "1.0.0"
---

# KEIZ accounting

This is the domain model the in-app assistant and coding agents must follow. The runtime copy
used by the assistant lives in `apps/api/src/chat/accounting-guide.ts`.

## Chart of accounts

| Code | Name | Type | Normal balance |
|---|---|---|---|
| 1010 | Cash & stablecoins | ASSET | debit |
| 1100 | Accounts receivable | ASSET | debit |
| 1300 | Input tax recoverable | ASSET | debit |
| 2000 | Accounts payable | LIABILITY | credit |
| 2100 | Tax payable | LIABILITY | credit |
| 3000 | Retained earnings | EQUITY | credit |
| 4000 | Revenue | REVENUE | credit |
| 5100 | Operating expenses | EXPENSE | debit |
| 5200 | Bank & network fees | EXPENSE | debit |

Every workspace gets this chart on its first posting. Journal lines snapshot the code and name,
so renaming an account never rewrites history.

## AP — vendor bills

Lifecycle: `DRAFT → SUBMITTED → APPROVED → PAYMENT_PENDING → PAID`, plus `REJECTED` and `VOID`.

Postings:

| Event | Debit | Credit |
|---|---|---|
| Bill approved | 5100 Operating expenses (subtotal), 1300 Input tax (tax) | 2000 Accounts payable (total) |
| Bill paid | 2000 Accounts payable | 1010 Cash & stablecoins |
| Bill voided | 2000 Accounts payable | 5100 Operating expenses, 1300 Input tax |

A creator cannot approve their own bill once another APPROVER/ADMIN/OWNER exists.

## AR — customer invoices

Lifecycle: `DRAFT → ISSUED → PARTIALLY_PAID / PAID`, plus `VOID`.

Postings:

| Event | Debit | Credit |
|---|---|---|
| Customer invoice issued | 1100 Accounts receivable (total) | 4000 Revenue (subtotal), 2100 Tax payable (tax) |
| Receipt recorded | 1010 Cash & stablecoins | 1100 Accounts receivable |
| Customer invoice voided | 4000 Revenue, 2100 Tax payable | 1100 Accounts receivable |

Receipts use an optimistic lock on `paidAmount`; concurrent receipts cannot overpay. Overdue is
derived from the due date, never stored.

## Direct expenses and revenue

Direct entries are single cash movements outside the AP/AR subledgers. Writes are
ADMIN/OWNER only; every workspace member can read the lists and the journal.

| Entry | Debit | Credit | Number |
|---|---|---|---|
| Direct expense | Expense account (default 5100) | Cash account (default 1010) | `EXP-YY/MM/XXXXX` |
| Direct revenue | Cash account (default 1010) | Revenue account (default 4000) | `REV-YY/MM/XXXX` |

The account must match the kind (`EXPENSE` for expenses, `REVENUE` for revenue) and the cash
account must be an `ASSET`. Both post a balanced, immutable journal entry with
`sourceType: expense|revenue`, `event: MANUAL` and no dedupe key.

## Document numbering

Numbers are allocated server-side from `document_counters`, keyed by `(orgId, kind, period)`
where the period is the business date's UTC `YY/MM`:

- Vendor bill: `BIL-YY/MM/XXXXX`
- Customer invoice: `INV-YY/MM/XXXX`
- Direct expense: `EXP-YY/MM/XXXXX`
- Direct revenue: `REV-YY/MM/XXXX`

The allocation is an atomic `$inc` and the series resets monthly. The number is immutable
after creation. Explicit numbers are only for imports, the demo seed and tests; the UI and
chat never send one. Padding is a minimum width, so a series grows past its width instead
of wrapping.

## Ledger invariants

- The journal is append-only. Never update or delete an entry; corrections are reversal entries.
- Every entry must balance (sum debit = sum credit) and must be non-zero.
- System postings carry a deterministic `dedupeKey`:
  `invoice:<id>:APPROVED|PAID|VOID`, `receivable:<id>:ISSUED|VOID`,
  `receipt:<receiptId>:RECEIVED`, `opening:<orgId>:<currency>`.
- Posting is best-effort after the business state changes. `POST /api/accounting/rebuild`
  backfills gaps and is safe to repeat.
- Reports aggregate with `$toDecimal`, never `$toDouble`.

## Money and reporting

- Storage is an integer minor-unit string plus `decimals`.
- Tool results expose both `minor` and a formatted major-unit string. Never re-scale them.
- `formatMoney` expects minor units; `formatDollars` expects major units.
- The workspace base currency is fixed to USD. The ledger is still per transaction currency
  (USD, EUR, SGD, IDR) with no FX translation. Never add currencies.
- `spend-summary` is invoice pipeline totals by status. `books-summary` is ledger balances and
  the trial balance. Do not mix them.
- Aging is AP or AR by due date.

## Payments and the agent

- Rails: `oneclick`, `outlayer`, and `vault`. `vault` is reserved and not executed yet.
- One live `PaymentIntent` per invoice across all rails.
- 1Click is mainnet-only; `PAYMENTS_MODE=mock` is the safe local default.
- The assistant can only propose payments. Only `APPROVED` bills can be proposed.
- Proposals use USDC on NEAR and are re-checked against policy at execution.
- Custody policy lives in OutLayer. Local policy has per-transaction, daily and
  approval-threshold limits.

## Assistant tool selection

| Question | Tool |
|---|---|
| Bills, status, amount | `list-invoices`, `get-invoice` |
| Customer invoices, outstanding | `list-receivables`, `get-receivable` |
| Customers | `list-customers`, `get-customer` |
| Vendors, payout details | `list-vendors`, `get-vendor` |
| Payments, settlement state | `list-payments`, `get-payment` |
| Agent proposals | `list-agent-actions` |
| Journal postings | `journal-summary` |
| Spend / pipeline | `spend-summary` |
| Cash, AR/AP, revenue, trial balance | `books-summary` |
| Propose a vendor payment | `propose-payment` (never moves funds) |
| Create a vendor | `create-vendor` (ADMIN/OWNER, draft record) |
| Create a customer | `create-customer` (draft record) |
| Create an AP bill | `create-bill` (DRAFT; optional submit, no ledger posting) |
| Create an AR customer invoice | `create-receivable` (DRAFT; optional issue, posts AR) |
| Available specialist agents | `list-agent-providers` |
| Hire a specialist agent | `hire-agent` (spend; ADMIN/OWNER, policy-checked, mock settlement) |
| Recent agent hires | `list-agent-jobs` |

## Assistant behaviour

1. For every request that needs data or an action, call `plan-actions` first and wait for the
   user to approve the plan.
2. Read-only tools run automatically after the plan is approved. Write/drafting tools
   (`propose-payment`, `create-vendor`, `create-customer`, `create-bill`, `create-receivable`,
   `hire-agent`) get a separate UI confirmation. Never ask for confirmation in text and never
   retry a declined write.
3. Creation tools start in DRAFT. Only set `submit` or `issue` when the user explicitly asks.
   Issuing AR posts to the ledger; submitting AP does not.
4. Resolve an existing vendor or customer before creating a bill or customer invoice. Never
   invent an email, payout address, vendor, customer, amount, number or date.
5. Call a tool before stating any number, record or status. Never invent data.
6. Use `get-*` when the user names a record; use `list-*` for summaries.
7. If a request to pay lacks an invoice number, ask for it. Never infer one.
8. Keep answers short and plain. No markdown tables. Do not read raw card envelopes or links
   aloud.
