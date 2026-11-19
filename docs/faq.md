# FAQ

## Is a refund automatic when my agent complains?

A dispute starts independent review. GenLayer can return `REFUND`, `NO_REFUND` or `INSUFFICIENT_EVIDENCE`. Quality repayment requires a verified final refund ruling and the seller's successful confirmed transfer.

## Why use GenLayer?

Payment and signature checks can establish deterministic facts. Whether a concise answer materially fulfilled its accepted purpose is a qualitative judgment. GenLayer validators evaluate the original evidence independently and compare substantive findings before the controller can apply a quality refund.

## What does Internet Court contribute?

Its GenLayer adapter defines the mandate, rubric, evidence, decision and concrete consequence framework used here. This repository implements that adapter in its own QualityCourt and seller workflow. It does not call a hosted Internet Court ruling API.

## Can I buy my own task?

Yes. `agent-work-v1` accepts a custom brief up to 1,200 UTF-8 bytes and returns bounded text up to 3,000 bytes. State a concise task appropriate to text generation. Discover the deployment first to confirm its enabled service and generator.

## Does a buyer need the operator token?

Public buyers sign a wallet-ownership challenge and obtain their own scoped session. The optional operator token belongs to the seller's trusted tooling and scheduled worker.

## Do I need a Gemini API key?

The MCP buyer uses your existing agent's model for review, so it does not require a separate Gemini credential. The seller uses its own configured model. The bundled optional demo buyer CLI uses its own model credential.

## Does the court hold my money?

The x402 purchase transfers principal to the seller before delivery. A seller-operated worker returns funds after an eligible award. The court does not custody the principal.

## Is repayment guaranteed?

Repayment requires a cooperating funded seller and available infrastructure. There is no escrow or trustless cross-chain enforcement in this implementation. Read the trust model before treating the service as a production financial guarantee.

## What money and networks are supported?

This implementation supports Base Sepolia test USDC with six decimals and the exact EIP-3009 x402 flow. The live court adapter uses GenLayer StudioNet. Mainnet funds, arbitrary tokens and additional payment schemes are outside the current interface.

## Are briefs and answers private?

Agreement acceptance permits publication of case evidence. Hashes bind that content but do not hide it. Use sanitized or synthetic material. Wallet keys and provider credentials stay in private local/server configuration.

## Can an agent spend without asking me every time?

A user-approved standing mandate authorizes purchases within an exact merchant allowlist, per-purchase cap and daily budget. The runtime enforces those limits. Actions outside that mandate need new authorization.

## What happens after a timeout?

Resume the same saved purchase with the same wallet and state directory. Its original authorization and budget reservation remain in place. A timeout does not establish that the payment failed.

## Is the recorded case the only useful flow?

The recorded case provides verifiable evidence of one real refund. The reusable API, MCP server and skill support new buyer wallets and custom briefs. A separate recorded live-generated purchase was accepted; it does not imply a court ruled on an undisputed answer.

## Is this audited or production-ready?

The repository includes deterministic tests and real testnet receipt evidence. It has no independent security audit or production service guarantee. The trust and operator boundaries are explicit.

[Get started](quickstart.md) · [Protocol](protocol.md) · [Live proof](live-proof.md) · [Trust model](trust-model.md)
