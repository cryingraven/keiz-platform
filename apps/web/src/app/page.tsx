import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock,
  Cpu,
  FileText,
  HandCoins,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { FaqSection } from '@/components/landing/faq';
import { MobileNav } from '@/components/landing/mobile-nav';
import {
  LogoStrip,
  NearAiLogo,
  NearIntentsLogo,
  OutLayerLogo,
} from '@/components/landing/logos';
import {
  AssistantPreview,
  DashboardPreview,
  LedgerPreview,
  MiniBillList,
  MiniInvoiceList,
  PaymentPreview,
} from '@/components/landing/previews';

const TRUST = [
  { label: 'NEAR wallet sign-in', icon: Wallet },
  { label: 'Approval trails', icon: ShieldCheck },
  { label: 'TEE-backed privacy', icon: Cpu },
  { label: 'Cross-chain payouts', icon: ArrowLeftRight },
  { label: 'Double-entry ledger', icon: BookOpen },
];

const CONTROLS = [
  {
    title: 'Roles that match the job',
    body: 'Owner, admin, approver and member. People see the work they need and nothing else.',
  },
  {
    title: 'Nobody approves their own bill',
    body: 'When there is another approver in the workspace, the person who created the bill cannot approve it. A solo workspace still works.',
  },
  {
    title: 'A trail you can follow',
    body: 'Every decision, comment, quote and payment status is recorded. You can see who did what, and when.',
  },
  {
    title: 'A leash on the agent',
    body: 'Per-transaction and daily caps, an asset allowlist and a human approval threshold you set. The agent can propose, not pay on its own.',
  },
];

const TIMELINE = [
  {
    label: 'Monday',
    title: 'A bill arrives',
    body: 'Add the vendor bill, check the lines and send it to the right approver.',
  },
  {
    label: 'Wednesday',
    title: 'The bill is approved',
    body: 'Pay it in the vendor’s currency. The expense and the payable are already posted.',
  },
  {
    label: 'Friday',
    title: 'A customer pays half',
    body: 'Record the receipt. The invoice moves to partially paid and cash comes in.',
  },
  {
    label: 'Month end',
    title: 'The books are ready',
    body: 'Trial balance, AP and AR aging and the journal are waiting. No spreadsheet to rebuild.',
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-brand">{children}</p>
  );
}

function StatusFlow({ steps }: { steps: string[] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
      {steps.map((step, index) => (
        <span key={step} className="inline-flex items-center gap-2">
          {index > 0 ? <span className="text-line-strong">/</span> : null}
          <span className="font-medium">{step}</span>
        </span>
      ))}
    </div>
  );
}

function PrivacyCard({
  logo,
  icon,
  title,
  body,
}: {
  logo?: ReactNode;
  icon?: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex h-8 items-center gap-2">
        {logo ?? (
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-paper text-ink">
            {icon}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3 md:gap-8">
            <Logo />
            <MobileNav />
            <nav className="hidden items-center gap-4 text-[14px] text-muted md:flex lg:gap-6">
              <a href="#product" className="transition hover:text-ink">
                Product
              </a>
              <a href="#accounting" className="transition hover:text-ink">
                Accounting
              </a>
              <a href="#payments" className="transition hover:text-ink">
                Payments
              </a>
              <a href="#security" className="transition hover:text-ink">
                Security
              </a>
              <a href="#faq" className="transition hover:text-ink">
                FAQ
              </a>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/login"
              className="hidden text-[14px] font-medium text-muted transition hover:text-ink lg:block"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-[14px] font-medium text-white transition hover:bg-ink-soft sm:px-4"
            >
              Open workspace <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-line">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(79,70,229,0.09),transparent_45%)]"
            aria-hidden
          />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-12 lg:py-24">
            <div>
              <Eyebrow>For small teams that handle their own finance</Eyebrow>
              <h1 className="mt-4 max-w-2xl text-balance text-[36px] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[48px] lg:text-[52px] xl:text-[62px]">
                One place for the money going out and the money coming in.
              </h1>
              <p className="mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-muted">
                KEIZ brings vendor bills, customer invoices, approvals, payments and the books
                behind them into one workspace. Approve a bill, pay the vendor in the currency they
                want, send an invoice, and the ledger updates itself.
              </p>
              <div className="mt-7 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-white transition hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  Open the workspace <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#product"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-sm font-medium transition hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  See how it works
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-muted sm:gap-x-5">
                {TRUST.map((item) => (
                  <li key={item.label} className="inline-flex items-center gap-1.5">
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <LogoStrip />

        <section id="product" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="max-w-2xl">
              <Eyebrow>The daily work</Eyebrow>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                Bills out. Invoices in. Same workspace.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Most tools pick one side of the ledger. Your business does not. Keep the bills you
                owe and the invoices you send in one place, with the same people and the same books.
              </p>
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-12">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-paper text-ink">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="text-[12px] font-medium uppercase tracking-wider text-muted">
                    Bills (AP)
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">From inbox to paid.</h3>
                <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
                  Add a vendor bill, route it to the right approver, and pay it in the currency and
                  chain the vendor asks for. When it settles, the expense and the payable are
                  already posted.
                </p>
                <div className="mt-5">
                  <MiniBillList />
                </div>
                <StatusFlow steps={['Draft', 'Submitted', 'Approved', 'Paid']} />
              </div>

              <div className="lg:border-l lg:border-line lg:pl-10 xl:pl-12">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-paper text-ink">
                    <HandCoins className="h-4 w-4" />
                  </span>
                  <span className="text-[12px] font-medium uppercase tracking-wider text-muted">
                    Invoices (AR)
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-tight">From sent to settled.</h3>
                <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted">
                  Create a customer invoice, send it, and record full or partial payments as they
                  arrive. KEIZ tracks what is still owed and posts the cash against receivables.
                </p>
                <div className="mt-5">
                  <MiniInvoiceList />
                </div>
                <StatusFlow steps={['Issued', 'Partially paid', 'Paid']} />
              </div>
            </div>

            <p className="mt-8 max-w-2xl border-t border-line pt-5 text-[13px] text-muted">
              Both sides share the same vendors, customers and ledger. A bill and a customer
              invoice never have to be reconciled by hand at the end of the month.
            </p>
          </div>
        </section>

        <section id="accounting" className="scroll-mt-24 border-b border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-20">
            <div>
              <Eyebrow>Accounting</Eyebrow>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                Every payment writes the entry.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                Approving a bill posts the expense and the payable. Paying it clears the payable
                against cash. Sending an invoice posts the receivable and the revenue. Recording a
                receipt brings the cash in. You do not re-key a thing.
              </p>
              <div className="mt-8 space-y-6">
                <div className="border-t border-line pt-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-brand" />
                    <h3 className="text-[14px] font-semibold">See the trial balance</h3>
                  </div>
                  <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    Debits and credits, account by account, with a clear balanced check. The
                    statement is ready whenever you need it.
                  </p>
                </div>
                <div className="border-t border-line pt-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-brand" />
                    <h3 className="text-[14px] font-semibold">Know what is overdue</h3>
                  </div>
                  <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    AP and AR aging tell you what to schedule and who to chase, grouped by how late
                    it is.
                  </p>
                </div>
                <div className="border-t border-line pt-4">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-brand" />
                    <h3 className="text-[14px] font-semibold">Correct with reversals</h3>
                  </div>
                  <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    Posted entries stay put. Void a bill or invoice and KEIZ posts the reversal, so
                    the history still adds up.
                  </p>
                </div>
              </div>
            </div>
            <LedgerPreview />
          </div>
        </section>

        <section id="payments" className="scroll-mt-24 bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:items-center lg:py-20">
            <div>
              <div className="flex items-center gap-3">
                <NearIntentsLogo variant="dark" />
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
                  Settlement layer
                </span>
              </div>
              <h2 className="mt-3 max-w-lg text-balance text-[28px] font-semibold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">
                Pay the vendor the way they want to be paid.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">
                Your vendor asks for USDC on Base. Another wants it on Solana. KEIZ locks the amount,
                shows you what will land, and handles the route through NEAR Intents. You approve.
                They receive the exact invoice amount.
              </p>
              <ul className="mt-7 space-y-3 text-[14px] text-white/75">
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  The exact amount is shown before you sign.
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  NEAR, Ethereum, Base, Arbitrum, BNB Chain, Polygon, Solana, Stellar, Tron and TON.
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                  If a route fails, the invoice returns to approved so you can retry.
                </li>
              </ul>
            </div>
            <PaymentPreview />
          </div>
        </section>

        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
            <div>
              <Eyebrow>Assistant</Eyebrow>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                Ask your books a question.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                “What do we owe this week?” “Who has not paid?” “What did we spend on cloud last
                quarter?” The assistant reads your workspace and answers with your numbers.
              </p>
              <p className="mt-6 inline-flex items-start gap-2 text-[13px] leading-relaxed text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                It can read your books and draft payment proposals. It cannot move money.
              </p>
              <div className="mt-5 rounded-xl border border-line bg-paper px-4 py-3">
                <div className="flex items-center gap-2">
                  <NearAiLogo />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                    Private inference
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  Connected to NEAR AI Cloud, prompts run through private, encrypted inference
                  inside Intel TDX and NVIDIA confidential computing. The local provider keeps
                  everything on your machine for offline demos.
                </p>
              </div>
            </div>
            <AssistantPreview />
          </div>
        </section>

        <section id="security" className="scroll-mt-24 border-b border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="max-w-2xl">
              <Eyebrow>Controls</Eyebrow>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                The guardrails a finance team asks for.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Approvals, roles and limits are part of the workflow, not bolted on. The same rules
                apply whether a person or the agent starts the payment.
              </p>
            </div>
            <div className="mt-10 grid gap-8 sm:grid-cols-2">
              {CONTROLS.map((item, index) => (
                <div key={item.title} className="border-t border-line pt-5">
                  <p className="font-num text-[11px] text-muted">0{index + 1}</p>
                  <h3 className="mt-2 text-[15px] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-8 inline-flex items-center gap-1.5 text-[12px] text-muted">
              <Wallet className="h-3.5 w-3.5" /> Sign in with a NEAR wallet. One message signature,
              no transaction.
            </p>
          </div>
        </section>

        <section id="privacy" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="max-w-2xl">
              <Eyebrow>Privacy &amp; TEE</Eyebrow>
              <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                Your books. Your keys. Your data.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Sensitive work runs inside hardware-isolated environments, not a shared black box.
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              <PrivacyCard
                logo={<OutLayerLogo />}
                title="Keys stay in the enclave"
                body="With OutLayer custody, agent keys live inside Intel TDX. The master secret is derived from NEAR MPC, and policy is checked inside the TEE before anything is signed. KEIZ stores only an encrypted API key."
              />
              <PrivacyCard
                logo={<NearAiLogo />}
                title="Private, verifiable AI"
                body="When the assistant runs on NEAR AI Cloud, private, encrypted inference happens in Intel TDX and NVIDIA confidential computing. NEAR AI Cloud can provide TEE attestation and signed responses."
              />
              <PrivacyCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Isolated by workspace"
                body="Every query is scoped to your organization. The assistant only sees your workspace tools. Secrets are AES-256-GCM encrypted at rest, and the agent can propose payments but never move them."
              />
            </div>

            <div className="mt-8 grid gap-4 border-t border-line pt-6 sm:grid-cols-2 lg:grid-cols-3">
              <p className="text-[12px] leading-relaxed text-muted">
                <span className="font-medium text-ink">TEE</span> = Trusted Execution Environment.
                Hardware-isolated compute with cryptographic attestation.
              </p>
              <p className="text-[12px] leading-relaxed text-muted">
                Prompts to NEAR AI Cloud run in TEEs. The local provider keeps everything on your
                machine for offline demos.
              </p>
              <p className="text-[12px] leading-relaxed text-muted">
                NEAR wallet sign-in. KEIZ never holds your keys.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-xl">
                <Eyebrow>A calmer month end</Eyebrow>
                <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                  No re-keying. No month-end scramble.
                </h2>
              </div>
              <p className="max-w-sm text-[14px] leading-relaxed text-muted">
                The work you already do, without the spreadsheet at the end of it.
              </p>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {TIMELINE.map((item) => (
                <div key={item.label} className="border-t border-line pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-brand">
                    {item.label}
                  </p>
                  <h3 className="mt-2 text-[14px] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <FaqSection />

        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
            <div className="rounded-[28px] bg-ink px-5 py-10 text-center text-white sm:px-12 sm:py-12">
              <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-white/45">
                Start here
              </p>
              <h2 className="mx-auto mt-3 max-w-2xl text-balance text-[26px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                Bring your bills, invoices and books into one place.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/60">
                Open the workspace and load the demo data. You can click through approvals, payments
                and the ledger without spending anything.
              </p>
              <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row sm:gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-ink transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:w-auto"
                >
                  Open the workspace <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#product"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-white/20 px-5 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:w-auto"
                >
                  See how it works <ArrowRight className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-4 text-[12px] text-white/40">
                NEAR wallet. No seed phrase shared.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted">
              Bills, invoices and a double-entry ledger for small teams.
            </p>
            <p className="mt-3 text-[12px] text-muted">
              Built on NEAR Intents and NEAR AI.
            </p>
            <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted">
              NEAR, NEAR Intents, NEAR AI and OutLayer are trademarks of their respective owners.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-muted sm:grid-cols-3 sm:gap-x-10">
            <a href="#product" className="transition hover:text-ink">
              Product
            </a>
            <a href="#accounting" className="transition hover:text-ink">
              Accounting
            </a>
            <a href="#payments" className="transition hover:text-ink">
              Payments
            </a>
            <a href="#security" className="transition hover:text-ink">
              Security
            </a>
            <a href="#privacy" className="transition hover:text-ink">
              Trust &amp; privacy
            </a>
            <Link href="/privacy" className="transition hover:text-ink">
              Privacy policy
            </Link>
            <Link href="/terms" className="transition hover:text-ink">
              Terms
            </Link>
            <a
              href="https://docs.near.org"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition hover:text-ink"
            >
              NEAR docs <ArrowUpRight className="h-3 w-3" />
            </a>
            <a
              href="https://docs.near-intents.org"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-ink"
            >
              Intents docs
            </a>
            <a
              href="https://cloud.near.ai"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-ink"
            >
              NEAR AI
            </a>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>© {new Date().getFullYear()} KEIZ</span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Non-custodial signing
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
