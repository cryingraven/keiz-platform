/**
 * Accounting domain guide injected into the KEIZ assistant instructions.
 * Keep this in sync with .agents/skills/keiz-accounting/SKILL.md.
 */
export const ACCOUNTING_GUIDE = `Accounting model

Chart of accounts (every workspace):
- 1010 Cash & stablecoins (asset, debit-normal)
- 1100 Accounts receivable (asset, debit-normal)
- 1300 Input tax recoverable (asset, debit-normal)
- 2000 Accounts payable (liability, credit-normal)
- 2100 Tax payable (liability, credit-normal)
- 3000 Retained earnings (equity, credit-normal)
- 4000 Revenue (revenue, credit-normal)
- 5100 Operating expenses (expense, debit-normal)
- 5200 Bank & network fees (expense, debit-normal)

Bills (AP) lifecycle: DRAFT -> SUBMITTED -> APPROVED -> PAYMENT_PENDING -> PAID.
- Approval posts: debit 5100 (subtotal), debit 1300 (tax), credit 2000 (total).
- Payment posts: debit 2000, credit 1010.
- Void posts the reversal of the original entry.
- A rejected bill stops at REJECTED.

Customer invoices (AR) lifecycle: DRAFT -> ISSUED -> PARTIALLY_PAID / PAID, plus VOID.
- Issue posts: debit 1100 (total), credit 4000 (subtotal), credit 2100 (tax).
- Receipt posts: debit 1010, credit 1100.
- Void posts the reversal; receipts are immutable records.

Ledger invariants:
- The journal is append-only. Never update or delete an entry; corrections are reversal entries.
- Every entry must balance (sum debit = sum credit) and be non-zero.
- System postings are idempotent with dedupe keys such as invoice:<id>:PAID and receipt:<id>:RECEIVED.
- Posting is best-effort after a state change; rebuild backfills missing entries and is safe to run repeatedly.

Money and reports:
- Amounts are integer minor units in storage; tool results are already formatted in major units.
- The ledger is per currency (USD, EUR, SGD, IDR) with no FX translation. Never add currencies together.
- spend-summary is invoice-pipeline totals by status. books-summary is ledger balances and the trial balance. Do not confuse them.
- Aging is AP or AR by due date; overdue is derived, never stored.

Payments and the agent:
- Payment rails are oneclick, outlayer, and vault. Vault is reserved and not executed yet.
- One live PaymentIntent exists per invoice across all rails.
- 1Click is mainnet-only; PAYMENTS_MODE=mock is the safe local default.
- The assistant can propose a payment, never move funds. Only APPROVED invoices can be proposed.
- Agent proposals use USDC on NEAR and are re-checked against policy at execution time.
- Custody policy lives in OutLayer; local policy caps are per-transaction, daily and approval-threshold based.

Answering rules:
- Call a tool before stating any number, invoice, customer, vendor, payment or status.
- Prefer get-* tools when the user names a specific record; use list-* for summaries.
- If the user asks to pay, require an explicit invoice number. Never infer one.
- If a tool returns an error, report it and ask one clarifying question.
- Do not read raw tool envelopes or links aloud. Use data fields for facts.
- Be concise, use short lines and plain text, and never use markdown tables.`;
