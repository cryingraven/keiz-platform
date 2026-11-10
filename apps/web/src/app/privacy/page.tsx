import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <div className="mx-auto w-full max-w-[640px] px-5 py-16">
        <Link href="/login" className="text-[14px] text-muted underline underline-offset-4 hover:text-ink">
          ← Back to sign in
        </Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          KEIZ stores the minimum needed to run your workspace: your NEAR account id, vendor bills,
          customer invoices, customers, vendors, payments, journal entries and an audit log.
        </p>
        <div className="mt-8 space-y-5 text-[14px] leading-relaxed text-muted">
          <p>
            Wallet sign-in asks your wallet to sign a NEP-413 message; that signature is verified
            server-side. KEIZ never receives a private key.
          </p>
          <p>
            Bill and invoice documents, ledger entries and payment metadata are stored in the
            configured MongoDB database. On-chain data is public by nature.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-ink">Custody and private inference</h2>
          <p>
            <span className="font-medium text-ink">Agent custody.</span> When you enable OutLayer
            custody, the agent keys live inside OutLayer’s Intel TDX enclave. The master secret is
            derived from NEAR MPC, and policy is evaluated inside the TEE before anything is signed.
            KEIZ stores an AES-256-GCM encrypted API key and returns the custody handoff only to the
            workspace owner.
          </p>
          <p>
            <span className="font-medium text-ink">Private inference.</span> When configured with a
            NEAR AI Cloud key, prompts and responses go to NEAR AI Cloud, which runs inference in
            Intel TDX and NVIDIA confidential computing and can provide TEE attestation and signed
            responses. If you run the local provider, prompts stay in your API process and no
            external model call is made.
          </p>
          <p>
            <span className="font-medium text-ink">Workspace isolation.</span> Every authenticated
            query is scoped by the orgId in your session. Assistant tools receive orgId from the
            request context, never from model output. Chat history and workspace data are stored in
            your configured MongoDB.
          </p>
          <p>
            <span className="font-medium text-ink">Audit data.</span> The audit log records the
            method, path, user, status, IP and timestamp. It does not store request bodies. Secret
            values are never logged.
          </p>
          <p>
            <span className="font-medium text-ink">TEE.</span> A Trusted Execution Environment is
            hardware-isolated compute. It reduces exposure but is not a guarantee against every
            threat; review the provider’s attestation and terms.
          </p>
          <p>
            <span className="font-medium text-ink">Third-party services.</span> OutLayer, NEAR AI
            Cloud, NEAR RPC and 1Click process data as needed for the features you
            enable. Their terms and privacy policies apply.
          </p>
          <p>
            This page is a placeholder for a production privacy notice and is not legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
