# Refunds and economics

A quality refund returns the original paid principal to the original payer after an independent final award. The seller worker derives every monetary field from verified payment facts.

## Payment economics

The reference price is 0.01 Base Sepolia test USDC: exactly 10,000 base units for the six-decimal token at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

Operators may configure price before quoting. Each signed agreement freezes its amount. Clients should read discovery and inspect the original quote; documentation's reference price cannot override the signed agreement or the user's mandate.

The purchase settles before delivery. x402 handles the supported authorization/settlement flow. It does not provide escrow, chargeback rights or a guarantee of recovery from an unwilling seller.

## Quality eligibility

The worker requires all of these conditions:

- Canonical verified original payment for the configured chain and token.
- Matching original seller authorizer and payment identity.
- Verified successful final GenLayer `REFUND` ruling from the agreed court.
- Matching case, agreement, delivery, sealed evidence and adjudication transaction bindings.
- No already confirmed refund for the same original payment.

A provisional ruling, `NO_REFUND`, `INSUFFICIENT_EVIDENCE`, malformed proof or missing finality does not authorize a quality refund.

## Exact-principal return

The refund transfers from the original seller to the original payer, using the original token and exact integer amount. Model output cannot choose those values.

Gas, seller inference, buyer inference and court costs are outside the principal. The testnet reference service is subsidized; the 0.01 test-USDC quote is not a claim that it covers all infrastructure costs or supplies production unit economics.

## Non-delivery recovery

The lower-level refund module has a separately labelled operational non-delivery approval type. It requires an elapsed deadline, no committed delivery and an invalidated generation fence. That approval is distinct from a quality ruling.

The public quality-dispute flow does not expose an arbitrary non-delivery refund trigger. If payment is confirmed but generation remains unavailable, preserve the order and original authorization, resume delivery, and investigate the operational failure. Do not report a court award that did not occur.

## Reserve and gas

The seller needs enough test USDC to honor eligible principal returns and Base Sepolia ETH for refund gas. A funded buyer does not fund the seller's worker.

Reserve or gas shortfalls remain visible. The judgment stays intact while execution is delayed. The protocol cannot compel an insolvent or offline seller to transfer funds.

## Nonce and retries

The deterministic `ARC_REFUND_V1` nonce derives from original chain, token, seller and payment identity. The worker checks stored transaction receipts and authorization state before considering another submission.

A matching canonical, sufficiently confirmed receipt proves a refund. A consumed authorization flag with no matching transfer remains unresolved. A cancellation cannot be treated as payment. Contradictory receipts and mismatched recipients, tokens, amounts or nonces fail closed.

Pending broadcasts are reconciled using the original nonce and stored hashes. Repeated worker execution is intended to converge on one economic effect, not create a new refund after a lost response.

## Spending mandate accounting

The local buyer reserves each original purchase in its UTC-day ledger. Unknown financial outcomes remain reserved. Neither an award nor a confirmed refund automatically replenishes the buyer's daily allowance.

The standing mandate limits purchase authority. It is not escrow, a seller repayment obligation or a transfer delegation to the court.

[Evidence verification](evidence.md) · [State machine](state-machine.md) · [Trust model](trust-model.md)
