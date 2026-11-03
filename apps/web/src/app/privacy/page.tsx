import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto w-full max-w-[640px] px-5 py-16">
        <Link href="/login" className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
          ← Back to sign in
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          KEIZ stores the minimum needed to run your workspace: your NEAR account id, invoices,
          vendors, payments and an audit log.
        </p>
        <div className="mt-8 space-y-5 text-[13px] leading-relaxed text-muted">
          <p>
            Passkey sign-in is brokered by NEAR Auth and Auth0. A passkey never leaves your device,
            and KEIZ never receives a private key. Wallet sign-in asks your wallet to sign a
            NEP-413 message; that signature is verified server-side.
          </p>
          <p>
            Invoice documents and payment metadata are stored in the configured MongoDB database.
            On-chain data is public by nature. This page is a placeholder for a production privacy
            notice and is not legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
