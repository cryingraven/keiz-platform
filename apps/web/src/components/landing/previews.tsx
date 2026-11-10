import type { ReactNode } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  FileText,
  HandCoins,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

const TONE_TEXT: Record<string, string> = {
  amber: 'text-amber',
  mint: 'text-mint',
  rose: 'text-rose',
  muted: 'text-muted',
};

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'amber' | 'mint' | 'rose' | 'muted';
}) {
  const tones = {
    amber: 'border-amber/20 bg-amber-soft text-amber',
    mint: 'border-mint/20 bg-mint-soft text-mint',
    rose: 'border-rose/20 bg-rose-soft text-rose',
    muted: 'border-line bg-paper text-muted',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function DashboardPreview() {
  return (
    <div className="relative">
      <div
        className="absolute -inset-3 rounded-[30px] bg-gradient-to-br from-brand/10 via-transparent to-mint/10 blur-2xl"
        aria-hidden
      />
      <div className="card relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Today</p>
            <p className="mt-0.5 text-[14px] font-semibold">Your books, up to date</p>
          </div>
          <StatusPill tone="mint">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" /> Balanced
          </StatusPill>
        </div>

        <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
          {[
            ['Cash', '$48,200.00'],
            ['Receivables', '$19,400.00'],
            ['Payables', '$7,800.00'],
          ].map(([label, value]) => (
            <div key={label} className="px-3 py-3 sm:px-4 sm:py-3.5">
              <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
              <p className="font-num mt-1 text-[12px] font-semibold tracking-tight sm:text-[14px] lg:text-[15px]">
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              Bills in motion
            </p>
            <span className="text-[11px] text-muted">2 open</span>
          </div>
          <div className="mt-2.5 space-y-2.5">
            {[
              ['Nusantara Cloud', 'INV-1041', '$4,200.00', 'Approved', 'mint'],
              ['Straits Logistics', 'INV-1042', '$12,750.00', 'Pending', 'amber'],
            ].map(([vendor, number, amount, status, tone]) => (
              <div key={number} className="flex items-center gap-2.5 sm:gap-3">
                <span className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper text-muted sm:grid">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{vendor}</p>
                  <p className="font-num text-[11px] text-muted">
                    {number}
                    <span
                      className={`ml-1.5 font-sans text-[11px] font-medium sm:hidden ${TONE_TEXT[tone]}`}
                    >
                      · {status}
                    </span>
                  </p>
                </div>
                <p className="font-num text-[12px] sm:text-[13px]">{amount}</p>
                <span className="hidden sm:inline-flex">
                  <StatusPill tone={tone as 'amber' | 'muted'}>{status}</StatusPill>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-line bg-paper/60 px-4 py-3.5 sm:px-5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              Posted automatically
            </p>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-mint">
              <CheckCircle2 className="h-3 w-3" /> Balanced
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {[
              ['5100 Operating expenses', 'Dr', '$4,000.00'],
              ['1300 Input tax', 'Dr', '$200.00'],
              ['2000 Accounts payable', 'Cr', '$4,200.00'],
            ].map(([account, side, amount]) => (
              <div key={account} className="flex items-center justify-between text-[11px]">
                <span className="text-muted">{account}</span>
                <span className="font-num">
                  <span className="mr-2 text-muted">{side}</span>
                  {amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LedgerPreview() {
  const rows = [
    ['1010', 'Cash & stablecoins', '$48,200.00', '—', '$48,200.00'],
    ['1100', 'Accounts receivable', '$19,400.00', '—', '$19,400.00'],
    ['2000', 'Accounts payable', '—', '$7,800.00', '$7,800.00'],
    ['4000', 'Revenue', '—', '$41,000.00', '$41,000.00'],
    ['5100', 'Operating expenses', '$18,300.00', '—', '$18,300.00'],
    ['3000', 'Retained earnings', '—', '$37,100.00', '$37,100.00'],
  ];

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-muted" />
            <p className="text-[12px] font-medium uppercase tracking-wider text-muted">
              Trial balance
            </p>
          </div>
          <StatusPill tone="mint">
            <Check className="h-3 w-3" /> Balanced
          </StatusPill>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2 font-medium sm:px-5">Account</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Debit</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Credit</th>
              <th className="px-4 py-2 text-right font-medium sm:px-5">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([code, name, debit, credit, balance]) => (
              <tr key={code} className="text-[12px]">
                <td className="px-4 py-2.5 sm:px-5">
                  <span className="font-num mr-2 text-[11px] text-muted">{code}</span>
                  {name}
                  <span className="mt-0.5 block font-sans text-[11px] text-muted sm:hidden">
                    {debit !== '—' ? `Dr ${debit}` : `Cr ${credit}`}
                  </span>
                </td>
                <td className="font-num hidden px-3 py-2.5 text-right text-muted sm:table-cell">
                  {debit}
                </td>
                <td className="font-num hidden px-3 py-2.5 text-right text-muted sm:table-cell">
                  {credit}
                </td>
                <td className="font-num px-4 py-2.5 text-right font-medium sm:px-5">
                  {balance}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-paper/60 text-[12px] font-semibold">
              <td className="px-4 py-2.5 sm:px-5">
                Totals
                <span className="mt-0.5 block font-sans text-[11px] font-normal text-muted sm:hidden">
                  Debits = credits
                </span>
              </td>
              <td className="font-num hidden px-3 py-2.5 text-right sm:table-cell">$85,900.00</td>
              <td className="font-num hidden px-3 py-2.5 text-right sm:table-cell">$85,900.00</td>
              <td className="font-num px-4 py-2.5 text-right sm:px-5">$85,900.00</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium">Vendor bill approved</p>
          <span className="text-[11px] text-muted">INV-1041</span>
        </div>
        <div className="mt-2 space-y-1">
          {[
            ['5100 Operating expenses', 'Dr', '$4,000.00'],
            ['1300 Input tax', 'Dr', '$200.00'],
            ['2000 Accounts payable', 'Cr', '$4,200.00'],
          ].map(([account, side, amount]) => (
            <div key={account} className="flex items-center justify-between text-[12px]">
              <span className="text-muted">{account}</span>
              <span className="font-num">
                <span className="mr-2 text-muted">{side}</span>
                {amount}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
          <ShieldCheck className="h-3 w-3" /> Posted entries stay put. Corrections are reversals.
        </p>
      </div>
    </div>
  );
}

export function PaymentPreview() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
          Payment · INV-1041
        </span>
        <StatusPill tone="mint">
          <CheckCircle2 className="h-3 w-3" /> Paid
        </StatusPill>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="text-[11px] text-muted">Nusantara Cloud receives</p>
            <p className="font-num mt-1 text-3xl font-semibold tracking-tight">$4,200.00</p>
          </div>
          <p className="text-left text-[12px] text-muted sm:text-right">
            USDC on Base
            <br />
            <span className="text-ink">exact amount</span>
          </p>
        </div>

        <div className="mt-5 space-y-2.5">
          {[
            ['Quote locked', 'The amount that will land is fixed'],
            ['Payment sent', 'Routed through NEAR Intents'],
            ['Vendor paid', 'The bill and the ledger are settled'],
          ].map(([title, meta]) => (
            <div key={title} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-mint text-white">
                <Check className="h-2.5 w-2.5" />
              </span>
              <div className="min-w-0 flex-1 border-b border-dashed border-line pb-2 last:border-0 last:pb-0">
                <p className="text-[13px] font-medium">{title}</p>
                <p className="text-[11px] text-muted">{meta}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-paper/60 px-4 py-3 sm:px-5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <CheckCircle2 className="h-3 w-3" /> Exact amount locked
        </span>
        <span className="text-[11px] font-medium text-mint">Vendor paid</span>
      </div>
    </div>
  );
}

export function AssistantPreview() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-ink text-white">
            <Sparkles className="h-3 w-3" />
          </span>
          <p className="text-[12px] font-medium">Assistant</p>
        </div>
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted">
          Read-only
        </span>
      </div>
      <div className="space-y-3 px-4 py-5 sm:px-5">
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[12px] leading-relaxed text-white">
          Who has not paid us?
        </div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
          Two invoices are past due: Helios Labs for $9,200 (12 days) and Meridian Retail for $4,000
          (3 days). Both are still in accounts receivable.
        </div>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[12px] leading-relaxed text-white">
          Can we pay Nusantara?
        </div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-paper px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
          INV-1041 is approved for $4,200. I can prepare a payment proposal. You approve and sign
          it.
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-line bg-paper/60 px-4 py-3 text-[11px] text-muted sm:px-5">
        <ShieldCheck className="h-3 w-3" /> Read-only. No fund movement.
      </div>
    </div>
  );
}

export function MiniBillList() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Bills
          </span>
        </div>
        <span className="font-num text-[11px] text-muted">2 open</span>
      </div>
      <div className="divide-y divide-line">
        {[
          ['Nusantara Cloud', 'INV-1041', '$4,200.00', 'Approved', 'mint'],
          ['Straits Logistics', 'INV-1042', '$12,750.00', 'Submitted', 'muted'],
        ].map(([vendor, number, amount, status, tone]) => (
          <div key={number} className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">{vendor}</p>
              <p className="font-num text-[11px] text-muted">
                {number}
                <span
                  className={`ml-1.5 font-sans text-[11px] font-medium sm:hidden ${TONE_TEXT[tone]}`}
                >
                  · {status}
                </span>
              </p>
            </div>
            <p className="font-num text-[12px]">{amount}</p>
            <span className="hidden sm:inline-flex">
              <StatusPill tone={tone as 'amber' | 'muted'}>{status}</StatusPill>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniInvoiceList() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <HandCoins className="h-3.5 w-3.5 text-muted" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
            Customer invoices
          </span>
        </div>
        <span className="font-num text-[11px] text-muted">2 open</span>
      </div>
      <div className="divide-y divide-line">
        {[
          ['Helios Labs', 'AR-2001', '$9,200.00', 'Issued', 'amber'],
          ['Meridian Retail', 'AR-2002', '$12,000.00', 'Partially paid', 'mint'],
        ].map(([customer, number, amount, status, tone]) => (
          <div key={number} className="flex items-center gap-2.5 px-3.5 py-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">{customer}</p>
              <p className="font-num text-[11px] text-muted">
                {number}
                <span
                  className={`ml-1.5 font-sans text-[11px] font-medium sm:hidden ${TONE_TEXT[tone]}`}
                >
                  · {status}
                </span>
              </p>
            </div>
            <p className="font-num text-[12px]">{amount}</p>
            <span className="hidden sm:inline-flex">
              <StatusPill tone={tone as 'amber' | 'mint'}>{status}</StatusPill>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

