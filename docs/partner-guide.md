# Partner integration guide

Integrate the protocol by preserving the agreement, original evidence and original payment identity throughout the workflow. The HTTP API is the transport reference; the local MCP server is a reusable buyer.

## Buyer integration

Use the published merchant origin and an agent-controlled EOA wallet. Read discovery, enforce an explicit merchant allowlist and spending budget, then authenticate wallet ownership.

Verify the seller's agreement signature and freeze its origin, resource, parties, token, amount, brief, rubric and court before signing buyer acceptance. Preserve the standard x402 payload and the application's signed checkout before submitting them.

After delivery, verify the original receipt and read the entire answer. Submit one signed accept/dispute decision against the exact delivery. Resume the original checkout after uncertainty.

The [MCP tools](mcp.md) implement this path for existing agents without requiring a separate model provider.

## Seller integration

Host the signed quote and delivery endpoints, settle only the supported payment flow, and verify canonical chain receipts before delivery. Use durable create-only records and conditional writes to commit one original answer.

Admit buyer claims only from the original payer. Freeze one dispute per original payment, with exact excerpts and a bounded defense. The court must receive the same evidence and quality policy the buyer accepted.

Your registrar and seller worker are explicit trusted roles. If they are unavailable or reserve is insufficient, expose that state instead of describing a refund as completed.

## Judgment-to-effect contract

The court evaluates quality; the effect controller evaluates finality and economic eligibility.

The controller must verify the expected court, successful final transaction, case/payment identity, evidence hash, agreement hash and delivery hash. It derives principal, recipient, token and nonce from the original payment. The model's explanation does not select monetary terms.

A changed court, rubric or service requires a new agreement version and compatible admission checks. Retain old deployments and bindings for old cases.

## Adding a service

The current service set is fixed to `agent-work-v1` and `launch-plan-v1`. A new service is a protocol change involving:

- Strict agreement and discovery schemas.
- A purpose-specific frozen rubric using the supported criterion vocabulary.
- Seller generation and bounded delivery requirements.
- Buyer policy and review validation.
- Compatible GenLayer admission and prompts.
- Evidence, proof, retry and adversarial test vectors.
- Discovery, API, MCP and operator documentation.

Declaring a service in metadata alone does not provide its court or fulfillment behavior. Keep the service disabled until its actual end-to-end behavior is verified.

## Deployment acceptance

Before exposing your merchant to buyers, verify your own origin, role-key identities, exact token/network, final court deployment, durable storage behavior, payment settlement, live seller output, signed buyer intake, final independent judgment and exact confirmed refund.

An accepted live-generated purchase and a refunded fixture establish different facts. Preserve each case's provenance. Test malicious embedded instructions, fabricated excerpts, wrong-payer access, modified evidence, uncertain payments, concurrent deliveries, provisional rulings, consumed nonces and reserve/gas shortfalls.

## Supported boundary

The current implementation is cooperative and testnet-only. Escrow, a trustless Base-to-GenLayer bridge, forced repayment, arbitrary payment schemes, partial refunds, revised-evidence appeals and long-running delegated services need additional design and implementation.

[API](api.md) · [Evidence](evidence.md) · [Hosting](hosting.md) · [Trust model](trust-model.md)
