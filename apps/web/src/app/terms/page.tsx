import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto w-full max-w-[640px] px-5 py-16">
        <Link href="/login" className="text-[13px] text-muted underline underline-offset-4 hover:text-ink">
          ← Back to sign in
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          KEIZ is a reference spend-management workspace. By signing in you agree to use it only
          for lawful invoice and payment activity, and to keep your wallet or passkey secure.
        </p>
        <div className="mt-8 space-y-5 text-[13px] leading-relaxed text-muted">
          <p>
            On-chain transactions are irreversible. You are responsible for verifying vendor
            payout addresses, invoice amounts and the network before signing a deposit. KEIZ never
            holds your keys and cannot reverse a settled payment.
          </p>
          <p>
            The software is provided as-is, without warranties. This page is a placeholder for a
            production legal agreement and is not legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
