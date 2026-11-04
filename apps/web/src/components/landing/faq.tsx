import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ChevronDown } from 'lucide-react';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqGroup {
  label: string;
  items: FaqItem[];
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    label: 'Getting started',
    items: [
      {
        q: 'Can I try it without spending anything?',
        a: 'Yes. Open the workspace and load the demo data. It runs with a mock payment provider, so you can click through approvals, payments and the ledger without moving funds.',
      },
      {
        q: 'Do I need crypto to use it?',
        a: 'You sign in with a passkey or a NEAR wallet. Vendor payouts settle in stablecoins on the chain the vendor chooses.',
      },
    ],
  },
  {
    label: 'Accounting',
    items: [
      {
        q: 'Is KEIZ a full accounting system?',
        a: 'It gives you a double-entry ledger, trial balance, AP and AR aging, and a complete journal. It does not file taxes or replace your accountant. Export the numbers and review them with your accountant.',
      },
      {
        q: 'Can I record partial customer payments?',
        a: 'Yes. The invoice moves to partially paid, the remaining balance stays visible, and the ledger posts the cash you actually received.',
      },
      {
        q: 'Who can approve a bill?',
        a: 'Approvers, admins and owners. If another approver exists in the workspace, the person who created the bill cannot approve it.',
      },
    ],
  },
  {
    label: 'Payments',
    items: [
      {
        q: 'Which chains can I pay?',
        a: 'NEAR, Ethereum, Base, Arbitrum, BNB Chain, Polygon, Solana, Stellar, Tron and TON.',
      },
      {
        q: 'What happens if a payment fails?',
        a: 'The invoice returns to approved so you can retry. The deposit follows the provider’s refund path.',
      },
    ],
  },
  {
    label: 'Privacy & TEE',
    items: [
      {
        q: 'What is a TEE?',
        a: 'A Trusted Execution Environment is hardware-isolated compute. Code and data run inside it, and the hardware can produce a cryptographic attestation of what ran.',
      },
      {
        q: 'Where are agent keys stored?',
        a: 'With OutLayer custody, agent keys live inside OutLayer’s Intel TDX enclave. The master secret is derived from NEAR MPC, and policy is enforced before signing. KEIZ stores an encrypted API key, never the raw key.',
      },
      {
        q: 'Is the assistant private?',
        a: 'When connected to NEAR AI Cloud, prompts run through private, encrypted inference in TEEs. The local provider keeps prompts on your machine for offline demos. Either way, tools are scoped to your workspace and the assistant cannot move funds.',
      },
      {
        q: 'Does KEIZ hold my money or keys?',
        a: 'No. KEIZ never holds your keys. The optional agent wallet runs inside OutLayer’s Intel TDX custody environment, with its own policy checked before signing.',
      },
    ],
  },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-24 border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="w-full">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">FAQ</p>
          <h2 className="mt-3 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
            The short version.
          </h2>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted">
            The questions finance teams ask before they move their bills and invoices into one
            place.
          </p>

          <div className="mt-7 rounded-2xl border border-line bg-paper/60 p-5">
            <p className="text-[12px] font-medium">Still have a question?</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Ask the assistant about your own workspace, or open the demo and click through it.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboard/chat"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[12px] font-medium text-white transition hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Ask the assistant <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-[12px] font-medium text-ink transition hover:border-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Open the workspace
              </Link>
            </div>
            <a
              href="#privacy"
              className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
            >
              Trust &amp; privacy <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="space-y-8">
          {FAQ_GROUPS.map((group, groupIndex) => (
            <div key={group.label}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                  {group.label}
                </h3>
                <span className="font-num text-[10px] text-muted">
                  {String(groupIndex + 1).padStart(2, '0')}
                </span>
              </div>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {group.items.map((item, itemIndex) => (
                  <details
                    key={item.q}
                    id={slugify(item.q)}
                    name="faq"
                    open={groupIndex === 0 && itemIndex === 0}
                    className="faq-item scroll-mt-24 px-4 transition hover:bg-paper/40 open:bg-paper/60 sm:px-5"
                  >
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-[14px] font-medium leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                      {item.q}
                      <ChevronDown className="details-chevron mt-0.5 h-4 w-4 shrink-0 text-muted transition" />
                    </summary>
                    <p className="max-w-2xl pb-4 text-[13px] leading-relaxed text-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
