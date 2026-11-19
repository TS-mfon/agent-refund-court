# Trust model

GenLayer independently judges whether the original purchased answer materially fulfilled its agreed purpose. A cooperating seller then executes a refund. The demo demonstrates an adjudication-to-payment workflow; it does not guarantee recovery from an unwilling or insolvent seller.

## What Internet Court contributes

The implementation follows Internet Court's official GenLayer review adapter: frozen mandate and rubric, structured original evidence, independent qualitative decision, and an explicit consequence path. Its entry skill specifically routes disputed jobs, SLAs, and refunds to that adapter.

This repository implements the adapter as a demo `QualityCourt` contract, an agent skill, and a seller workflow. It uses no deployed production IC ruling service or consultation MCP. It implements no reputation registry, escrow contract, ERC-7710 delegation, or permission-revocation controller. The [integration mapping](../skills/agent-refund-court/references/internet-court-adapter.md) identifies every concrete component and the adapted decision vocabulary.

## Authorities

| Component | Authority and trust assumption |
| --- | --- |
| Buyer wallet | Signs locally; authorizes the agreed purchase and its own accept/dispute decision |
| Seller receipt signer | Signs the agreement and immutable delivery binding; authorized by deployment configuration |
| x402 facilitator | Verifies and settles the original USDC authorization; its response is a transaction hint, not sufficient proof |
| Base RPC and proof verifier | Check configured chain, direct USDC calldata, canonical block, confirmations, authorization event, and matching transfer |
| Registrar | Rechecks original payment and evidence before admitting the case; GenLayer trusts the admitted Base facts |
| GenLayer validators | Independently judge the original brief, rubric, answer, and claims; substantive decision fields must agree |
| Seller refund worker | Rechecks finality and original payment, derives payer/token/amount, checks reserve, and signs the refund |
| Vercel Blob | Holds durable workflow state using conditional writes and fenced operations |
| Public viewer | Validates manifest consistency and reports evidence; it cannot initiate a funded buyer purchase |

The GenLayer contract enforces evidence schema, hash bindings, fixed rubric, registrar authorization, and one immutable case per original payment. It does not independently query Base or receive a trustless cross-chain proof. StudioNet is the demonstration network; no production security or latency guarantee is implied.

## Economic boundaries

The default agreement is one 0.01 test-USDC payment for one answer on Base Sepolia, chain ID 84532, token `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Model output cannot choose a principal amount, refund recipient, token, or chain.

A quality refund requires a verified finalized `REFUND` ruling bound to the original agreement and delivery. The worker uses a deterministic refund authorization nonce and returns the exact original principal to the original payer. Gas, model usage, and court costs are outside that principal.

The purchase payment settles before delivery. x402 supplies payment mechanics, not a chargeback or escrow guarantee. Seller reserve and availability remain necessary for a refund.

## Evidence and finality

A signed checkout additionally binds the agreement and HTTP resource to the EIP-3009 payment authorization. The backend persists the original authorization before settlement and checks on-chain proof before delivery.

The original answer is committed once and signed. The dispute bundle contains that answer, original agreement and payment, buyer claim, and seller defense. Fixture labels and expected demo outcomes are excluded from the court's model prompt.

The court distinguishes provisional acceptance from finality. Validators compare decision, material-failure flag, and failed criteria, while allowing reasoning wording to differ. Invalid model output or validator disagreement cannot be silently converted to a refund.

The default Base payment proof requires two confirmations and checks the receipt against its canonical block. The refund worker has its own configured confirmation requirement. These are testnet confirmation policies, not guarantees against every possible reorganization.

## Failure behavior and recovery

An uncertain settlement is reconciled using the original authorization and transfer evidence. Recovery does not mint a replacement payment. Canceled or used authorizations require actual matching transfer logs; authorization state alone does not establish that money moved.

Delivery generation uses a fenced lease. A stale producer cannot replace a committed answer. Court registration and adjudication phases persist their transaction identities. An ambiguous crash between submission and persistence requires reconciliation; the system preserves the uncertainty.

`INSUFFICIENT_EVIDENCE`, undetermined consensus, failed registration, network errors, and missing finality produce visible unresolved or pending states. Reserve shortfall, insufficient gas, failed or canceled refund authorizations, and unconfirmed transfers remain visible. The interface reports a refund only after receipt verification.

Appeals and revised evidence are outside this immutable-case demo. A user may inspect the original evidence and ask the operator to investigate an unresolved case; the operator cannot rewrite a finalized record through a public endpoint.

## Data and credentials

The accepted agreement explicitly permits publication of case evidence. The example product and brief are fictional; use synthetic or sanitized material for demonstrations. Published hashes bind content but do not make it private.

Buyer keys remain in local private configuration. Backend keys, model credentials, Blob tokens, and demo tokens stay in server or operator secrets. The access token gates subsidized writes; independent signatures bind buyer actions. Public routes show only case and service metadata.

This is a builder implementation based on Internet Court's MIT-licensed connector. Logos identify the participating technologies; they do not establish official endorsement.
