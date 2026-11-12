# KEIZ — NEAR HACKATHON submission guide

Prepared 2026-11-09. Source of truth: <https://nearhackathon.com/HACKATHON.md>.
Re-read it before submitting; dates and rules can change.

> This document is a checklist, not a submission. Do not send anything until the
> human has reviewed the full payload and explicitly confirmed it.

## Deadline snapshot

| Fact | Value |
|---|---|
| Hackathon | NEAR HACKATHON |
| Development ends | **2026-11-14T23:59:00Z** |
| Judging starts | 2026-11-16T00:00:00Z |
| Results by | 2026-11-18T23:59:00Z |
| Submission API | `POST https://nearhackathon.com/api/applications` |
| Change requests | <https://nearhackathon.com/request-changes> |
| Rules | <https://nearhackathon.com/HACKATHON.md> |

There is one submission per project and one submission per repository. A second
submission of the same repository is rejected. Mistakes are corrected with a change
request, never by submitting again.

---

## 1. What KEIZ is

KEIZ is a B2B spend workspace for small teams that handle their own finance. It puts
vendor bills (AP), customer invoices (AR), multi-step approvals, stablecoin payouts and a
double-entry ledger in one product.

NEAR is part of the product, not a badge:

- **NEP-413** one-time message signing for wallet login; full-access keys only.
- **NEAR Intents / 1Click** for cross-chain vendor payouts and customer collection.
- **NEAR AI Cloud** for private inference in the finance assistant.
- **OutLayer / Intel TDX** for optional policy-bound agent custody.
- **Agent jobs** for hiring specialist sub-agents from the assistant, with a policy-checked
  budget and a structured result (mock settlement in this build).
- **`keiz-collect`** for on-chain receivables (optional — Settings also offers a plain
  treasury mode and one-click deployment) and **`keiz-vault`** for a policy-bound
  treasury contract.
- **Shared invoice payments** — token-scoped public links with USDC/USDT quotes, refund
  addresses and live paid status.

Be precise in the README and demo: the vault contract exists but invoice approval is not
yet wired to on-chain proposals. Do not describe the vault as the live AP rail.

---

## 2. Recommended tracks

Include every track the project genuinely fits. One submission covers them all.

| Track id | Fit | Evidence to show |
|---|---|---|
| `realworld` | Strongest | AP/AR, approval flow, stablecoin payouts, receipts, reporting. |
| `business` | Strong | Treasury-style AP/AR, approvals, AI finance assistant, agent spending and specialist hiring. |
| `agents` | Strong | Assistant lists and hires specialist sub-agents, pays them within the agent policy, and consumes the result. The agent wallet cannot move funds alone. |
| `security` | Strong | RBAC, separation of duties, caps, atomic daily spend, policy-checked agent hires, NEP-413 full-access check, TEE custody. |
| `privacy` | Conditional | Include only if the demo shows NEAR AI Cloud/TEE-backed inference or custody. |
| `defi` | No | The product uses Intents for settlement, but it is not a DEX, vault or lending product. |
| `thesis`, `swarms`, `games`, `nfts`, `memecoins`, `social`, `open` | No | No direct fit; do not pad the track list. |

Recommended submission set: `["realworld", "business", "agents", "security"]`, plus
`"privacy"` only when there is a visible TEE/private-AI moment in the demo.

---

## 3. Before submitting: repository checklist

Work through this list with the human.

- [ ] Repository is **public** before 2026-11-14T23:59:00Z.
- [x] Add a `LICENSE` file. MIT is fine (Q-014).
- [x] README is written for a machine reader and a human reader:
  - [x] What the product is.
  - [x] The problem it solves.
  - [x] How to run it.
  - [x] A “do X → see Y” judge path.
  - [x] No marketing language.
- [x] If this is not a brand-new repository, separate the hackathon work per Q-003:
  dedicated branch, or `pre-hackathon` / `hackathon-submission` tags, plus a README
  section linking the diff. (The history starts inside the hackathon window, so there is
  no pre-hackathon baseline.)
- [x] Disclose the pre-hackathon baseline and any existing product on another chain.
- [x] List libraries, templates, boilerplate, pre-existing own libraries and AI-generated
  code in the README (Q-005).
- [x] No secrets, keys, `.env` files or personal submission payloads in the repo.
- [x] Verification commands pass:

  ```bash
  pnpm install
  pnpm typecheck
  pnpm test
  pnpm --filter @keiz/api smoke
  pnpm --filter @keiz/web build
  ```

- [x] Demo is reproducible without mainnet funds. `PAYMENTS_MODE=mock` is the default;
  document it.
- [ ] Hosted demo, if used, stays up through 2026-11-18 and ideally 2026-11-25.
- [x] Known limits are documented honestly: 1Click is mainnet-only, OutLayer cross-chain
  Intents are mainnet-only, destination payout verification is incomplete, the AP vault is
  not wired to invoice approval, and agent hires settle in mock mode rather than via an
  on-chain agent-to-agent transfer.

### Docs reconciled before judges read them

- [x] `README.md` → “Login (passkey + wallet)”: the login page now offers a passkey card
  and one **Continue with a NEAR wallet** selector; the recovery-key UI is hidden.
- [x] `README.md` → “API surface”: add `/accounting/reports`,
  `/accounting/reports/export`, and the AP/AR/payments date-filter query params.
- [x] `README.md` → “Verification”: refresh test and smoke counts (99 unit tests, 59 smoke checks).
- [x] `docs/README.md`: remove the recovery-key wording from the login link.
- [x] `docs/integrations.md`: server-side PDF/XLSX report exports now exist; CSV export
  remains client-side.
- [x] `docs/architecture.md` / `docs/api.md`: confirm reporting routes and examples are
  present.

---

## 4. Demo post

The human records and publishes the post. Do not post on their behalf.

Requirements:

- Say the project was built at **NEAR HACKATHON**.
- Tag **@NEARProtocol**.
- Include **#NEARHackathon**.
- Attach the demo video or screenshots.
- Optional: **@NearLegion**, **@NearBuilders**.

Suggested first line — lead with the user problem:

> Small finance teams still approve bills in email, pay vendors by hand, and rebuild the
> books in a spreadsheet at month end.

Suggested post text (edit before publishing):

```text
Built KEIZ at NEAR HACKATHON.

Small finance teams still approve bills in email, pay vendors by hand, and rebuild the
books in a spreadsheet at month end.

KEIZ is one workspace for AP, AR, approvals, stablecoin payouts and a double-entry
ledger. Bills are paid in the vendor's currency on their chain through NEAR Intents.
The AI assistant can read the books and draft proposals, but only a human can approve
money movement. NEAR also handles auth with NEP-413 and private inference through
NEAR AI Cloud.

Demo: <video or screenshots>
Repo: <public repository>

What would you want automated first: bill approvals or customer follow-up?

#NEARHackathon @NEARProtocol
```

### 60–90 second demo script

1. **Sign in** — passkey login, no seed phrase.
2. **AP** — load demo data, open a vendor bill, approve it, pay in the vendor’s preferred
   stablecoin. Show the ledger postings and the paid state.
3. **AR** — issue a customer invoice, record a partial receipt, show the remaining
   balance and the cash posting.
4. **Accounting / Reporting** — switch monthly → quarterly → annual, show inflow/outflow,
   P&L and the balance sheet, then export PDF and Excel.
5. **Assistant** — ask “What do we owe this week?” or “Who has not paid?”, show the plan
   approval and a payment proposal that cannot move funds.
6. **Agent economy** — ask “Hire the tax reviewer for INV-1001.” Show the provider list,
   the hire confirmation, the policy check, and the returned tax-review result. The job
   appears under `/dashboard/agent` with its cost and mock settlement.
7. **Guardrail** — show the agent wallet policy blocking a spend above its limit.
8. **Close** — repo link and one specific question for feedback.

Keep architecture slides and setup out of the video. Show one complete user moment.

---

## 5. Values the human must provide

Do not guess, generate or fill any of these:

| Field | Rule |
|---|---|
| `projectName` | 2–80 characters |
| `leadName` | 2–80 characters |
| `email` | Valid email, max 160 characters; max 2 submissions per email |
| `size` | Exactly one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` |
| `tracks` | One or more track ids, each listed once |
| `nearAddress` | Mainnet NEAR account, 2–64 chars, lowercase, matching the NEAR account regex |
| `projectUrl` | Public repository URL, max 300 chars, unique per repository |
| `demoUrl` | Public X demo post URL, max 300 chars |
| `idea` | 20–2000 characters |
| `consent` | `true` only after the human agrees to the contact notice |

Consent notice, read verbatim:

> “I agree that the organizers may use these details to review our submission and
> contact us about this hackathon.”

Never invent a payout account. The human creates it in any NEAR wallet.

---

## 6. Draft “idea” field

Edit for accuracy and length, then have the human approve it. This is 20–2000 characters.

```text
Small finance teams still run vendor bills, customer invoices and approvals across
spreadsheets and disconnected payment tools. KEIZ is a self-custodial B2B spend
workspace that puts AP, AR, approvals and a double-entry ledger in one place. Bills are
routed to approvers, paid in the vendor's preferred stablecoin on their chain, and
customer receipts update the books automatically. NEAR is part of the product: NEP-413
signs users in, NEAR Intents handles cross-chain settlement, NEAR AI Cloud provides
private inference for the finance assistant, and OutLayer/TEE-enforced policy limits the
agent wallet. The assistant can read the books, draft proposals, and hire specialist
sub-agents for bounded jobs within that policy. Only a human can approve money movement.
```

---

## 7. Submission procedure

### 7.1 Generate the request id once

```bash
uuidgen | tr A-Z a-z
# or
node -e 'console.log(crypto.randomUUID())'
```

Save it. A retry after a network error or `503` must reuse the same value.

### 7.2 Build the payload

Use exactly these fields. Do not add `website` — it is a spam trap and any non-empty
value rejects the submission.

```json
{
  "requestId": "<UUID generated once>",
  "projectName": "<human-provided name>",
  "leadName": "<human-provided lead>",
  "email": "<human-provided email>",
  "size": "<human-provided team size>",
  "tracks": ["realworld", "business", "agents", "security"],
  "nearAddress": "<human-provided mainnet NEAR account>",
  "projectUrl": "<public repository>",
  "demoUrl": "<public X post>",
  "idea": "<approved idea text>",
  "consent": true
}
```

Check before sending:

- [ ] `projectUrl` is public and is not already submitted.
- [ ] `demoUrl` is a public X post and includes the required tags.
- [ ] `tracks` contains every genuine fit, no duplicates.
- [ ] `idea` is 20–2000 characters.
- [ ] `consent` is `true` and the human heard the notice verbatim.
- [ ] The full JSON payload was printed and the human said yes.
- [ ] Payload is not committed or pasted into a public channel.

### 7.3 Send once

```bash
curl -sS -X POST https://nearhackathon.com/api/applications \
  -H 'Content-Type: application/json' \
  -d @submission-payload.json
```

Keep `submission-payload.json` local and delete it after the submission; it contains
personal data.

### 7.4 Handle the response

| Status | Meaning | Action |
|---|---|---|
| `201` | Saved | Tell the human. Done. Do not submit again. |
| `400` | Validation failed | Fix the fields in `fields`; retry with the same `requestId`. |
| `403` | Submissions closed or cross-site request | Tell the human. Do not retry. |
| `409` | Repository already submitted, or email limit reached | Ask the human. Never swap the link or email to get around it. Use request-changes if the earlier submission is wrong. |
| `413` | Body too large | Shorten `idea`; retry. |
| `503` | Storage temporarily unavailable | Wait a minute; retry with the same `requestId`. |

---

## 8. Request changes after submission

A saved submission cannot be edited directly.

1. The human opens <https://nearhackathon.com/request-changes>.
2. Enter the email, NEAR account and repository link exactly as submitted. If one of
   those is the mistake, enter what was submitted as best remembered.
3. Tick every field to change and give the new value.
4. Leave a Discord or Telegram handle.
5. Submit the request; organizers review it by hand.

Do not create a second submission to fix a mistake.

---

## 9. Post-submission

- Keep the repository public through judging.
- Keep the demo post live.
- Keep any hosted demo up through at least 2026-11-18, ideally 2026-11-25.
- Watch the contact email and Discord/Telegram for organizer questions.
- Do not deploy to mainnet or move funds unless the human explicitly asks.

---

## 10. Hard stops

- Do not make the repository public, push, or force-push without the human.
- Do not post on X or any other network on their behalf.
- Do not sign transactions, spend tokens, or deploy to mainnet.
- Do not commit secrets, keys, `.env` files or the submission payload.
- Do not submit twice.
- Do not send a payload that has not been printed and confirmed.
