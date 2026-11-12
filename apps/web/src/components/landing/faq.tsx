import { ChevronDown } from 'lucide-react';

const FAQ = [
  {
    q: 'Can I try it without spending anything?',
    a: 'Yes. Sign in with a passkey or a NEAR wallet, open the demo workspace and load the demo data. Payments run against a mock provider, so nothing moves on-chain.',
  },
  {
    q: 'Do I need crypto to use KEIZ?',
    a: 'You sign in with a NEAR wallet or a passkey. Vendor payouts settle in stablecoins on the chain the vendor chooses. The demo needs no funds and no wallet transaction.',
  },
  {
    q: 'Is KEIZ a full accounting system?',
    a: 'It gives you a double-entry ledger, trial balance, AP and AR aging and a complete journal. It does not file taxes or replace your accountant. You can export the numbers and review them together.',
  },
  {
    q: 'Who can approve a bill?',
    a: 'Approvers, admins and owners. If another approver exists in the workspace, the person who created the bill cannot approve it. A solo workspace still works.',
  },
  {
    q: 'Which chains can I pay?',
    a: 'NEAR, Ethereum, Base, Arbitrum, BNB Chain, Polygon, Solana, Stellar, Tron and TON, through NEAR Intents.',
  },
  {
    q: 'What happens if a payment fails?',
    a: 'The bill returns to approved so you can retry. Refunds follow the payment provider’s path, and the ledger keeps the original entries.',
  },
  {
    q: 'Does KEIZ hold my keys?',
    a: 'No. KEIZ never holds your keys. The optional agent wallet runs inside OutLayer’s Intel TDX custody environment, with its policy checked before anything is signed.',
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-24 border-b border-line">
      <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.015em]">
            Questions, answered.
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-muted">
            The things finance teams ask before they move bills and invoices into the same workspace.
          </p>
        </div>

        <div className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <details key={item.q} name="faq" className="group scroll-mt-24">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-medium leading-snug transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                {item.q}
                <ChevronDown className="details-chevron h-4 w-4 shrink-0 text-muted transition-transform" />
              </summary>
              <p className="max-w-2xl pb-5 pr-8 text-[16px] leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
