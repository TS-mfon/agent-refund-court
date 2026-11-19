# Trust model

GenLayer independently judges whether the original purchased answer materially fulfilled its accepted purpose. A cooperating seller executes an eligible refund. Adjudication, payment-fact admission and transfer execution are different trust boundaries.

## Authorities

| Component | Authority and assumption |
| --- | --- |
| Buyer wallet | Local EOA signing; authorizes its own agreement, bounded payment and review |
| Seller receipt signer | Signs the agreement and one immutable delivery binding |
| x402 facilitator | Verifies/settles the original authorization; its transaction hint needs chain verification |
| Base RPC/proof verifier | Checks configured chain, calldata, canonical receipt, confirmations, nonce and matching events |
| Registrar | Rechecks Base payment and original evidence before court admission |
| GenLayer validators | Independently assess qualitative fulfillment and compare substantive decision fields |
| Seller refund worker | Verifies final eligibility, derives original monetary terms, checks reserve/gas and signs transfer |
| Durable storage | Holds workflow state, fenced delivery operations, jobs, counters and receipts |
| Public viewer | Checks manifest consistency and reports evidence; public wake advances bounded existing work |
| Local MCP runtime | Enforces the user's allowlist and spending mandate while preserving original checkout state |

The court validates evidence schema, content hashes, policy, registrar authorization, court address and one immutable case per original payment. It does not independently query Base or accept a trustless cross-chain proof. It trusts the registrar's admitted payment facts.

## Independent judgment

The buyer claim and seller defense are allegations. They do not select the court's result. Validators read the accepted brief, rubric, original answer, claim and defense; fixture labels and expected outcomes are excluded from the qualitative prompt.

Decision, material-failure flag and failed criteria must agree substantively. Reasoning wording can differ. Invalid model output and validator disagreement cannot silently become a refund.

The controller requires a successful finalized transaction and matching latest final contract state. A provisional accepted transaction is insufficient.

## Economic limits

The purchase settles to the seller before delivery. Repayment depends on the cooperating seller's reserve, gas and availability. The implementation has no escrow, forced repayment or trustless Base-to-GenLayer bridge.

The exact original principal is refundable for material failure. Gas, model and court costs are excluded. Principal, payer, token, chain and nonce come from verified original facts rather than model output.

The reference instance is Base Sepolia/StudioNet testnet infrastructure. Tests and recorded receipts do not establish an independent security audit, production uptime, economic sustainability or a universal finality guarantee.

## Authentication and abuse limits

An EIP-191 challenge provides short-lived buyer access after local ownership proof. Agreement, checkout and review require independent EIP-712 signatures. The optional operator credential retains broader trusted tooling access and remains private.

Authentication counters, public/write limits, bounded text, activity cooldowns and local buyer budgets constrain use. Public wallet registration does not establish a unique human identity; Sybil and infrastructure-abuse risk remains an operator concern.

The public visitor wake awaits at most one existing paid-dispute step under a shared 60-second cooldown and 120-second coordination lease. It supplies no public funded buyer, arbitrary destination or model-selected transfer permission. A processed wake is not a completed refund. The API executes the step directly; GitHub scheduling remains a separate fallback.

## Evidence and privacy

Agreement acceptance explicitly permits publication of case evidence. Use synthetic or sanitized briefs. Content hashes preserve identity but do not make published text private.

Private keys stay in the local buyer/server signing processes. Provider keys, Blob tokens, bearer sessions and operator credentials remain private. Their values are excluded from browser bundles and public proof manifests.

The original delivery is committed once under a fenced lease. A stale producer cannot replace it. Sealed disputes and finalized records are immutable in the exposed interface. Revised evidence and a custom appeal interface are outside this version.

## Failure and recovery

Uncertain settlement resumes the same original authorization. A used or canceled flag without matching transfer events cannot prove payment. Refund confirmation requires canonical exact-transfer evidence.

Court registration, adjudication and refund jobs persist their identities. The stored signed agreement determines the original court across deployment upgrades; new defaults apply to new orders only. An ambiguous submission remains visible and requires reconciliation. Insufficient evidence, undetermined consensus, missing finality, reserve shortfall, gas shortfall and confirmation delays remain pending or unresolved.

A successful quality refund is reported only after original payment, final judgment and principal return are all verified. The implementation cannot guarantee recovery from an unwilling or insolvent seller.

An authentication or discovery failure before quote submission leaves the purchase resumable. If the quote request may have been submitted but its order identity was not recorded, `QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL` stops automatic requoting. Reconcile the original order from merchant/local records; the current MCP tool does not accept a replacement order or reset that intent. Preserve the state and involve the operator rather than create a second purchase.

## Attribution

Internet Court's MIT-licensed adapter supplies the mandate/rubric/evidence/decision/effect framework implemented here. The repository operates its own QualityCourt rather than a production hosted Internet Court ruling service. Technology logos identify integrations and do not establish endorsement.

[Evidence](evidence.md) · [Refunds](refunds.md) · [Authentication](authentication.md) · [Adapter mapping](../skills/agent-refund-court/references/internet-court-adapter.md)
