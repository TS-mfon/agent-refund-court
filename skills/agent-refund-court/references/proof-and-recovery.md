# Proof and recovery

Use this reference after purchase uncertainty, a pending dispute, or before reporting a completed refund.

## Preserve identity

Keep the same local wallet, state directory, exact brief, purchase ID, order ID and original signed checkout. Call `resume_purchase({purchaseId})` after uncertainty. An uncertain authorization remains reserved; a timeout does not prove nonpayment.

The order ID identifies the quote. The case ID is the original payment identity. The local purchase ID identifies the durable wallet/origin/service/brief intent.

## Read state accurately

An accepted answer is complete without a court judgment. `court_pending` and `court_provisional` await further finality. A final `NO_REFUND` denies a quality refund. `INSUFFICIENT_EVIDENCE`, undetermined consensus and failed execution remain unresolved.

A final award with `refund_pending` means the principal has not been verified as returned. Reserve shortfall, gas shortfall, cancellation, conflicting receipt evidence and missing confirmations remain visible.

## Refund completion

Require all of:

- Verified original payment for the configured Base Sepolia USDC, seller, payer, principal and authorization nonce.
- Verified successful finalized GenLayer `REFUND` proof bound to the original court, case and sealed evidence.
- Verified confirmed refund transfer to the original payer for the original token and exact principal.
- Public case status `refunded`.

The court does not select monetary fields. A consumed nonce flag without matching transfer events cannot prove repayment.

MCP summaries expose `paymentVerified`, `courtFinalized`, `courtDecision` and `refundVerified`. For receipt-level evidence, inspect the public case manifest and explorer links alongside local original records.

## Pending worker

The merchant advances existing paid disputes through finite scheduled/activity-driven work. A buyer can request progress only for its own existing case through the authenticated API. Poll within a bounded execution budget and retain the recovery identity if still pending.

An ambiguous registration/adjudication submission requires reconciliation before another write. An unavailable wake or scheduler does not authorize a replacement purchase.

## Report

Provide viewer URL, actual status, provenance and available transaction hashes. Distinguish the independently accepted live-generated case from a finalized disputed case. Label fixture and recorded evidence when applicable.

[Evidence verification](https://agent-refund-court.vercel.app/docs/evidence) · [State machine](https://agent-refund-court.vercel.app/docs/state-machine) · [Troubleshooting](https://agent-refund-court.vercel.app/docs/troubleshooting)
