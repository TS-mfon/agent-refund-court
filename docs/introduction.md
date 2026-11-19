# Agent Refund Court

Agent Refund Court lets an agent purchase bounded text work, inspect the original answer, and dispute a material failure against terms agreed before payment. x402 settles the purchase. Internet Court supplies the review framework. A GenLayer intelligent contract independently judges the sealed dispute. A cooperating seller returns the original USDC principal after a verified final refund ruling.

## The problem

A successful payment proves that money moved. It does not prove that an answer fulfilled its brief. A useful refund protocol needs a frozen purpose, a shared quality standard, the exact original delivery, an independent judgment, and a controller that applies that judgment to the original payment.

For example, an agent can buy a concise implementation plan for an inventory tool. If the answer supplies relevant steps and respects the stated constraints, the buyer accepts it. If it supplies generic encouragement without the promised plan, the buyer can identify that material failure and submit the original evidence for judgment.

## The mechanism

- Agree: the seller signs the brief, rubric, price, buyer, resource, court and publication terms.
- Pay: the buyer signs acceptance and a bounded x402 authorization; the service verifies the canonical Base receipt.
- Deliver: the seller commits and signs one immutable answer.
- Review: the buyer accepts the answer or signs a criterion-based dispute.
- Judge: GenLayer validators assess the original evidence and compare substantive findings.
- Apply: the seller worker refunds the exact original principal only after verified finality and transfer reconciliation.

An accepted answer completes the purchase without a court ruling. A dispute can produce `REFUND`, `NO_REFUND`, or `INSUFFICIENT_EVIDENCE`. Filing a complaint does not guarantee repayment.

## Who uses it

Buyer agents connect their own local wallet through the [MCP server](mcp.md) and use their existing model to review the answer. Buyers need a funded Base Sepolia wallet and a standing spending mandate; they do not need the seller's operator token or a separate Gemini buyer credential.

Seller operators host the API, sign receipts, maintain a refund reserve, admit verified payment facts to their court, and run a finite worker. Integrators can use the same signed API without the provided MCP client.

Observers use the public case viewer to inspect the accepted terms, exact answer, ruling and chain receipts.

## Current scope

Version 0.1.0 supports one-shot text services on Base Sepolia with six-decimal test USDC. Briefs are limited to 1,200 UTF-8 bytes; answers to 3,000 bytes. The service exposes a general `agent-work-v1` task and the original `launch-plan-v1` example. The published service metadata is the authority for enabled capabilities and price.

The implementation uses a trusted registrar and a seller-operated refund worker. Repayment depends on the seller's reserve and availability. This testnet implementation has no independent security audit or production guarantee. Read the [trust model](trust-model.md) before integrating.

## Start here

[Buy with your agent](quickstart.md) · [Protocol and services](protocol.md) · [Inspect a verified case](live-proof.md) · [Run a seller](hosting.md) · [API reference](api.md)
