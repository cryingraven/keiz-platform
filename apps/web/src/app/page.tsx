import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FileText,
  Fingerprint,
  Layers,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { ConnectButton } from '@/components/connect-button';
import { Logo } from '@/components/shell';
import { Badge, Card } from '@/components/ui';

const FEATURES = [
  {
    icon: FileText,
    kicker: 'Invoice automation',
    title: 'From vendor upload to approval, without the spreadsheet',
    body: 'Vendors submit once. Finance approves with a real audit trail, and the invoice is ready to pay the moment it clears.',
    points: ['Line-item totals in integer minor units', 'Approval + rejection history', 'Status transitions you can trace'],
  },
  {
    icon: Layers,
    kicker: 'NEAR Intents',
    title: 'One route, any chain the vendor wants',
    body: 'A quote from 1Click locks the rate before anyone signs. The vendor receives the exact invoice amount; the payer sees the cap.',
    points: ['EXACT_OUTPUT quotes', '10 minute deposit window', 'Refund path built in'],
  },
  {
    icon: Bot,
    kicker: 'NEAR AI assistant',
    title: 'Ask your ledger a question, in plain language',
    body: 'The assistant reads invoices and spend through tools scoped to your workspace. It can draft a payment proposal — never move funds.',
    points: ['Tool calls, not guesses', 'Per-org data isolation', 'Signed responses when using NEAR AI Cloud'],
  },
  {
    icon: Wallet,
    kicker: 'Agent wallet',
    title: 'Autonomy with a leash',
    body: 'A dedicated key with per-transaction and daily caps, an asset allowlist, and a human approval threshold you set.',
    points: ['Encrypted at rest (AES-256-GCM)', 'Re-checked at execution time', 'Kill switch per workspace'],
  },
];

const STEPS = [
  { n: '01', title: 'Sign in with NEAR', body: 'A NEP-413 message proves key ownership. No transaction, no gas.' },
  { n: '02', title: 'Approve the invoice', body: 'Vendors are paid in the asset and chain they already use.' },
  { n: '03', title: 'Settle through Intents', body: '1Click quotes the route; you deposit; the status timeline does the rest.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="hidden items-center gap-6 text-[13px] text-muted md:flex">
              <a href="#product" className="transition hover:text-ink">Product</a>
              <a href="#how" className="transition hover:text-ink">How it works</a>
              <a href="#stack" className="transition hover:text-ink">Stack</a>
              <a
                href="https://docs.near.org/chain-abstraction/intents/overview"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 transition hover:text-ink"
              >
                Docs <ArrowUpRight className="h-3 w-3" />
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="hidden rounded-full px-3 py-2 text-[13px] font-medium text-muted transition hover:text-ink sm:block"
            >
              Dashboard
            </Link>
            <ConnectButton compact />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 grid-lines hero-fade opacity-70" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="max-w-xl">
            <Badge className="border-brand/20 bg-brand-soft text-brand-deep" dot>
              B2B payments, settled on NEAR
            </Badge>
            <h1 className="mt-5 text-[42px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[56px]">
              Invoice in.
              <br />
              Payment out.
              <br />
              <span className="text-brand">Settled on NEAR.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">
              KEIZ is a spend workspace for teams that pay vendors across chains. Approve the
              invoice, lock a NEAR Intents quote, and let the agent handle everything inside your
              policy.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-white transition hover:bg-ink-soft"
              >
                Open the workspace <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-sm font-medium transition hover:border-ink/30"
              >
                See settlement flow
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Fingerprint className="h-3.5 w-3.5" /> NEP-413 login
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" /> NEAR Intents 1Click
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> NEAR AI Cloud
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-brand/10 via-transparent to-mint/10 blur-2xl" />
            <Card className="relative overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  Payment · INV-1042
                </span>
                <Badge className="border-amber/20 bg-amber-soft text-amber" dot>
                  Awaiting deposit
                </Badge>
              </div>
              <div className="px-5 py-5">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[11px] text-muted">Vendor receives</p>
                    <p className="font-num mt-1 text-3xl font-semibold tracking-tight">$4,200.00</p>
                  </div>
                  <p className="font-num text-right text-[11px] text-muted">
                    via USDC on Base
                    <br />
                    <span className="text-ink">quote locked 09:41</span>
                  </p>
                </div>

                <div className="mt-5 space-y-2.5">
                  {[
                    ['Invoice approved', 'Finance · 2 signatures', true],
                    ['Quote committed', '1Click · route to Base', true],
                    ['Deposit detected', '0x8f…21c4 · 3 confirmations', false],
                    ['Settled to vendor', 'Intents verifier', false],
                  ].map(([title, meta, done], index) => (
                    <div key={index} className="flex items-start gap-3">
                      <span
                        className={
                          done
                            ? 'mt-0.5 grid h-4 w-4 place-items-center rounded-full bg-mint text-white'
                            : 'mt-0.5 h-4 w-4 rounded-full border border-line-strong'
                        }
                      >
                        {done ? <CheckCircle2 className="h-3 w-3" /> : null}
                      </span>
                      <div className="min-w-0 flex-1 border-b border-dashed border-line pb-2">
                        <p className="text-[13px] font-medium">{title}</p>
                        <p className="font-num text-[10px] text-muted">{meta}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl bg-paper px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted">Deposit address</p>
                  <p className="font-num mt-1 truncate text-[12px]">0x8f2a1b7c4d2e6f0a3b5c8d1e4f7a0b2c5d8e1f4a</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section id="product" className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
              The workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Four jobs, one ledger.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Built around the parts of AP that actually cost time: chasing approvals, reconciling
              status, and re-keying the same invoice into a payment portal.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <Card key={feature.kicker} className="p-6 transition hover:border-line-strong">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-paper text-ink">
                    <feature.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                    {feature.kicker}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold leading-snug tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{feature.body}</p>
                <ul className="mt-4 space-y-1.5">
                  {feature.points.map((point) => (
                    <li key={point} className="flex items-center gap-2 text-[12px] text-muted">
                      <CheckCircle2 className="h-3.5 w-3.5 text-mint" />
                      {point}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
                Settlement flow
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Three steps, no bridge UI.
              </h2>
            </div>
            <p className="max-w-sm text-[13px] text-muted">
              1Click has no testnet. This build ships with a deterministic mock provider so the flow
              is reviewable without moving mainnet funds.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <Card key={step.n} className="relative overflow-hidden p-6">
                <span className="font-num text-[11px] text-muted">{step.n}</span>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{step.body}</p>
                <div className="absolute -bottom-10 -right-6 h-24 w-24 rounded-full bg-brand/5" />
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="stack" className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
                Under the hood
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Boring infrastructure. Interesting payments.
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[12px] sm:grid-cols-3">
              {[
                ['Next.js 16', 'App Router + Tailwind 4'],
                ['NestJS 12', 'Typed API, Mongo native'],
                ['MongoDB', 'Append-only event log'],
                ['NEP-413', 'Signed-message auth'],
                ['1Click', 'Cross-chain quotes'],
                ['NEAR AI', 'Tool-calling assistant'],
              ].map(([name, meta]) => (
                <div key={name} className="border-t border-white/10 pt-2.5">
                  <p className="font-medium text-white">{name}</p>
                  <p className="mt-0.5 text-white/40">{meta}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Logo />
            <p className="mt-2 max-w-xs text-[12px] text-muted">
              A reference spend workspace for NEAR Intents, NEAR AI, and NEP-413.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-muted">
            <a href="https://docs.near.org" target="_blank" rel="noreferrer" className="hover:text-ink">
              NEAR docs
            </a>
            <a href="https://docs.near-intents.org" target="_blank" rel="noreferrer" className="hover:text-ink">
              Intents docs
            </a>
            <a href="https://cloud.near.ai" target="_blank" rel="noreferrer" className="hover:text-ink">
              NEAR AI
            </a>
            <span className="inline-flex items-center gap-1 text-muted">
              <ShieldCheck className="h-3.5 w-3.5" /> Non-custodial signing
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
