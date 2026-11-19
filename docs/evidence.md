# Evidence and signatures

The actionable case contains the original agreement, delivery, payment, buyer claim and seller defense. Hashes and signatures bind those records to one payment. Their content is public under the agreement's publication term.

## Frozen evidence

`SealedEvidence` contains `schemaVersion`, `caseId`, `agreement`, `agreementHash`, `delivery`, `buyerClaim`, `sellerDefense` and `payment`. The complete canonical envelope is limited to 16 KiB.

Briefs and buyer reasons are limited to 1,200 UTF-8 bytes, answers to 3,000 bytes, and seller defense to 1,200 bytes. A claim has at most three unique criterion IDs and three exact answer excerpts of at most 500 bytes each.

The server verifies the buyer's signature, payer ownership, delivery hash and dispute deadline. The registrar rechecks payment facts before admission. The court validates the schema, canonical hashes, fixed policy, court binding and original payment identity. Commands embedded in an answer, claim or defense are treated as evidence rather than instructions.

## Content hashes

```text
agreementHash = SHA256(UTF8(canonicalJSON(agreement)))
deliveryHash  = SHA256(UTF8(originalDeliveryText))
evidenceHash  = SHA256(UTF8(canonicalJSON(sealedEvidence)))
```

Canonical JSON sorts object keys and preserves array order. Strings retain their exact content. The evidence boundary rejects unsupported values, unsafe numeric fields and invalid Unicode. Trimming, normalization or changing an excerpt changes its binding.

## Financial identities

```text
paymentId = keccak256(abi.encode(
  "ARC_PAYMENT_V1", chainId, token, payer, originalAuthorizationNonce
))
caseId = paymentId
refundNonce = keccak256(abi.encode(
  "ARC_REFUND_V1", 84532, USDC, seller, paymentId
))
```

A refund nonce is stable across retries and deployments. A workflow ID, current timestamp or replacement court address does not create a new refund identity. This makes recovery apply to the same authorized economic effect.

## Signature layers

Wallet authentication uses an EIP-191 sign-in message bound to the service origin, account, network, nonce and expiry. It grants buyer access and authorizes no payment.

Application records use EIP-712 with domain `AgentRefundCourt`, version `1`, chain `84532`, and the configured USDC verifying-contract address. A `Record(kind, hash)` signature binds seller agreement, buyer acceptance, seller delivery or buyer decision.

The checkout separately binds order ID, agreement hash, resource hash, original authorization digest, payer, seller, amount and expiry. Both `PAYMENT-SIGNATURE` and the original `X-ARC-CHECKOUT` header must describe the same signed payment context.

The EIP-3009 token authorization is a separate signature for its token transfer. Its standard fields alone do not identify the HTTP brief or delivered answer; the application checkout provides that binding.

## Payment proof

The Base verifier checks chain identity and token; direct authorization calldata; successful receipt; canonical block hash; configured confirmations; `AuthorizationUsed` and matching `Transfer` events in the same transaction; payer, seller, amount and original nonce.

A facilitator response is a useful transaction hint. It is not sufficient financial proof by itself. Cancellation or authorization state without matching transfer events cannot establish payment.

## Court and refund proof

The court verifier requires a successful finalized transaction and latest final contract state bound to the expected contract, case, evidence hash, agreement and delivery. Validator agreement compares decision, material-failure flag and failed criterion identifiers; reasoning wording may differ.

The refund verifier repeats chain, canonical block, confirmation, nonce, authorizer and transfer checks. It derives the recipient, token and amount from the original verified payment.

The public viewer validates manifest consistency. For independent chain verification, use the repository proof tool with the original local buyer record and its documented configuration. [The verified proof](live-proof.md) records actual transaction links and the limits of that check.

## Publication and privacy

A hash does not hide public evidence. Use synthetic or sanitized briefs because agreement acceptance permits publication. Private keys, bearer sessions, API credentials and storage tokens are excluded from public manifests. Local buyer state remains necessary for secure resume and original-record comparison.

[Authentication](authentication.md) · [Trust model](trust-model.md) · [Verified live case](live-proof.md)
