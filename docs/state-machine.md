# State machine and finality

Order, court and refund state are separate. A completed payment can coexist with pending delivery. A court finding can exist before it is final. A final refund award can exist before funds return.

## Purchase states

The durable order phases are `quoted`, `accepted`, `paid`, and `delivered`. Acceptance signs commercial terms; buyer review after delivery is a separate action.

The public case normally begins at `delivered`. The schema also permits `awaiting_payment` for a manifest surface that exists before confirmation. The current seller creates its case manifest after verified payment and committed delivery.

## Public case states

| Status | Meaning | Buyer action |
| --- | --- | --- |
| `delivered` | Original paid answer is committed | Read and submit one accept/dispute review |
| `accepted` | Buyer accepted the original answer | Purchase complete; no court ruling implied |
| `disputed` | Signed material claim and evidence are stored | Inspect evidence; follow the existing case |
| `court_pending` | Registration, adjudication or finality is pending | Resume/poll the same case |
| `court_provisional` | Court transaction is accepted provisionally | Await verified finality |
| `court_finalized` | Verified final substantive judgment exists | Inspect the actual decision |
| `refund_pending` | Award exists; return transfer is not confirmed | Inspect refund status and recovery diagnostics |
| `refunded` | Exact original principal transfer is verified | Report receipt-backed return |
| `unresolved` | Evidence, consensus or execution cannot support completion | Preserve identifiers and investigate |
| `simulation` | Explicit simulation without transaction proofs | Do not describe it as a live payment |

## Court job phases

The worker persists `new → registering → registration_sent → registered → adjudicating → adjudication_sent → terminal`.

Registration must finalize successfully before adjudication is submitted. A crash while a write is marked `registering` or `adjudicating` can leave an ambiguous submission. The worker exposes `COURT_SUBMISSION_RECONCILIATION_REQUIRED` instead of inventing a new transaction identity.

Repeated execution resumes the stored phase. It does not replace the original evidence.

## Court outcomes

- `REFUND`: the original evidence supports a material criterion failure.
- `NO_REFUND`: the purpose was materially met, or the claim establishes only minor imperfection/preference.
- `INSUFFICIENT_EVIDENCE`: a substantive decision cannot be supported.

The court proof distinguishes `pending`, `accepted`, `finalized`, `undetermined` and `failed`. `accepted` is provisional. Only a verified `finalized` proof with a matching `REFUND` result can authorize a quality refund.

## Refund outcomes

A refund proof may be `not_due`, `awarded`, `pending`, `confirmed`, `failed`, `reserve_shortfall` or `canceled`. Reserve and gas shortfalls are operational states; they do not change the judgment.

Confirmation requires a successful canonical receipt with matching original payer, seller authorizer, token, amount and deterministic nonce. A used nonce alone cannot establish a transfer.

## Recovery rule

Keep the same wallet, state directory, purchase ID, order ID and original checkout after uncertainty. Retry the existing action or resume the existing purchase. Creating a second authorization before resolving the first can create a second payment.

[Refunds and economics](refunds.md) · [Evidence verification](evidence.md) · [Troubleshooting](troubleshooting.md)
