import Link from 'next/link';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { FaqSection } from '@/components/landing/faq';
import { MobileNav } from '@/components/landing/mobile-nav';
import { LogoStrip } from '@/components/landing/logos';
import { ProductShot } from '@/components/landing/previews';

const NAV = [
  ['How it works', '#how'],
  ['Ledger', '#ledger'],
  ['Trust', '#trust'],
  ['FAQ', '#faq'],
] as const;

const primaryCta =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control bg-ink px-4 text-[14px] font-medium text-white transition-colors hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';
const secondaryCta =
  'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink/30 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

const STEPS = [
  {
    title: 'Add the bill',
    body: 'Vendor, line items, tax and due date. The bill is a draft until someone sends it.',
  },
  {
    title: 'Route it for approval',
    body: 'Approvers see it with the vendor and the amount. When another approver exists, the creator cannot approve their own bill.',
  },
  {
    title: 'Pay it',
    body: 'The exact amount is locked before you sign. The vendor receives the currency and chain they ask for.',
  },
  {
    title: 'It posts',
    body: 'Approval posts the expense and the payable. Settlement clears the payable against cash. A void posts a reversal.',
  },
];

const LEDGER_ROWS = [
  { term: 'Approval', detail: 'Posts the expense and the accounts payable, once.' },
  { term: 'Settlement', detail: 'Clears the payable against cash when the payment succeeds.' },
  { term: 'Correction', detail: 'Voids and reversals. Posted entries are never edited.' },
];

const PAYMENT_FACTS = [
  'The amount that will land is locked before you sign.',
  'Vendors receive the currency and chain they ask for.',
  'If a route fails, the bill returns to approved so you can retry.',
];

const CONTROLS = [
  {
    title: 'Nobody approves their own bill',
    body: 'When another approver exists in the workspace, the creator cannot approve. A solo workspace still works.',
  },
  {
    title: 'The agent has a leash',
    body: 'Per-transaction and daily caps, an asset allowlist and a human approval threshold you set. The agent proposes; you approve.',
  },
  {
    title: 'Keys stay in the enclave',
    body: 'Custody keys live inside OutLayer’s Intel TDX environment, with policy checked before anything is signed. KEIZ stores an encrypted API key, not the key.',
  },
  {
    title: 'One workspace at a time',
    body: 'Every query is scoped to your organization. The assistant only sees the tools and records in your workspace.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3 md:gap-8">
            <Logo />
            <MobileNav />
            <nav className="hidden items-center gap-6 text-[14px] text-muted md:flex" aria-label="Landing">
              {NAV.map(([label, href]) => (
                <a key={href} href={href} className="transition-colors hover:text-ink">
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link
              href="/login"
              className="hidden h-10 items-center rounded-control px-3 text-[14px] font-medium text-muted transition-colors hover:text-ink sm:inline-flex"
            >
              Sign in
            </Link>
            <Link href="/dashboard" className={primaryCta}>
              Try the demo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-line">
          <div className="mx-auto max-w-[1120px] px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20 lg:pt-24">
            <div className="max-w-3xl">
              <h1 className="text-balance text-[clamp(2.5rem,5vw,3.5rem)] font-semibold leading-[1.08] tracking-[-0.02em]">
                Bills, invoices and the ledger behind them.
              </h1>
              <p className="mt-5 max-w-2xl text-[18px] leading-[1.55] text-muted">
                Approve a vendor bill, pay it in the currency the vendor asks for, and send customer
                invoices. Every movement posts to a double-entry ledger.
              </p>
              <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Link href="/dashboard" className={primaryCta}>
                  Try the demo <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <a href="#how" className={secondaryCta}>
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-muted">
                Passkey or NEAR wallet. The demo runs in mock mode, so no funds move.
              </p>
            </div>
            <ProductShot
              src="/landing/today.png"
              alt="The KEIZ Today view showing bills waiting for approval, cash and payable totals, and recent bills."
              caption="The Today view in the demo workspace. Payments are mocked."
              priority
              className="mt-10 sm:mt-12"
            />
          </div>
        </section>

        <section id="how" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-balance text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
                One bill, from arrival to posted.
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                The same record moves from draft to approval to settlement. Nothing is re-keyed, and
                every step leaves an audit trail.
              </p>
            </div>
            <ol className="mt-9 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="border-t border-line pt-4">
                  <span className="font-num text-[13px] text-muted">0{index + 1}</span>
                  <h3 className="mt-1.5 text-[16px] font-semibold">{step.title}</h3>
                  <p className="mt-1 text-[16px] leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
            <ProductShot
              src="/landing/bill-detail.png"
              alt="A vendor bill in KEIZ with line items, an approval trail, the vendor payout details and the settlement panel."
              caption="A bill after approval, with its approval trail and payout details."
              width={2240}
              height={2130}
              className="mt-10"
            />
          </div>
        </section>

        <section id="ledger" className="scroll-mt-24 border-b border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-balance text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
                Approving posts the entry. Paying clears it.
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                The ledger is written as the work happens, not rebuilt at month end. Debits and
                credits stay balanced without a spreadsheet.
              </p>
            </div>
            <ProductShot
              src="/landing/ledger-detail.png"
              alt="The KEIZ trial balance showing cash, receivables, payables, revenue and operating expenses, with debits and credits in balance."
              caption="The trial balance after the demo bills, payments and invoices."
              width={2240}
              height={2088}
              className="mt-9"
            />
            <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-14">
              <div>
                <h3 className="text-[16px] font-semibold">What the ledger records</h3>
                <dl className="mt-3 divide-y divide-line border-y border-line">
                  {LEDGER_ROWS.map((row) => (
                    <div key={row.term} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
                      <dt className="w-32 shrink-0 text-[16px] font-medium">{row.term}</dt>
                      <dd className="text-[16px] leading-relaxed text-muted">{row.detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="text-[16px] font-semibold">Paying a vendor</h3>
                <ul className="mt-3 space-y-2">
                  {PAYMENT_FACTS.map((fact) => (
                    <li key={fact} className="flex items-start gap-2 text-[16px] leading-relaxed text-muted">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-mint" />
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="trust" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-balance text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
                Roles, limits and keys.
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                Controls are part of the workflow, whether a person or the agent starts the payment.
              </p>
            </div>
            <div className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
              {CONTROLS.map((control) => (
                <div key={control.title} className="border-t border-line pt-4">
                  <h3 className="text-[16px] font-semibold">{control.title}</h3>
                  <p className="mt-1.5 text-[16px] leading-relaxed text-muted">{control.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-9 flex items-start gap-2 text-[16px] leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
              The assistant can read your books and draft a payment. It cannot move money.
            </p>
            <div className="mt-10 border-t border-line pt-6">
              <LogoStrip />
            </div>
          </div>
        </section>

        <FaqSection />

        <section className="border-b border-line bg-surface">
          <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-balance text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
                Open the demo workspace.
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">
                Sign in with a passkey or a NEAR wallet and load the demo data. You can click
                through approvals, payments and the ledger without spending anything.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Link href="/dashboard" className={primaryCta}>
                  Try the demo <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/login" className={secondaryCta}>
                  Sign in
                </Link>
              </div>
              <p className="mt-3 text-[13px] text-muted">
                Mock payments. No funds move until you connect a funded wallet.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-paper">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-[14px] leading-relaxed text-muted">
              Bills, invoices and a double-entry ledger for small teams.
            </p>
            <p className="mt-2 text-[13px] text-muted">
              NEAR, NEAR Intents, NEAR AI and OutLayer are trademarks of their respective owners.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[14px] text-muted sm:grid-cols-3">
            {NAV.map(([label, href]) => (
              <a key={href} href={href} className="transition-colors hover:text-ink">
                {label}
              </a>
            ))}
            <Link href="/privacy" className="transition-colors hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-ink">
              Terms
            </Link>
            <a href="https://docs.near-intents.org" target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              Intents docs
            </a>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[1120px] flex-col gap-2 px-4 py-4 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>© {new Date().getFullYear()} KEIZ</span>
            <span>Non-custodial signing</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
