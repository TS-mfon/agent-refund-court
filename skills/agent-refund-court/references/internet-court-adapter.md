# Internet Court integration mapping

This demo implements Internet Court's GenLayer review adapter for a one-shot quality dispute. Internet Court contributes the integration framework and reproducible skill workflow; x402 moves the purchase payment; the deployed GenLayer contract supplies the independent qualitative ruling.

The official entry skill routes disputed jobs, SLAs, and refunds to `integrations/genlayer-intelligent-contracts/SKILL.md`. That adapter requires a mandate, rubric, evidence schema, decision output, effect path, and auditability. Read the [bundled adapter](../upstream/internet-court/integrations/genlayer-intelligent-contracts/SKILL.md) for its actual wording.

| Official adapter requirement | Concrete demo component |
| --- | --- |
| Review objective and expected output | Buyer and seller sign an `Agreement` for one launch plan with the original brief and refund policy |
| Rubric | Fixed `launch-plan-v1` criteria: relevance, actionability, grounding |
| Structured receipts and output artifacts | `SealedEvidence` binds original payment, agreement hash, delivery hash, buyer claim, and seller defense |
| Intelligent Contract reviews behavior | `QualityCourt.register_case` admits the bounded bundle; `adjudicate` asks validators to independently assess material fulfillment |
| Decision output | `REFUND`, `NO_REFUND`, or `INSUFFICIENT_EVIDENCE`, with material-failure findings and reasoning |
| Concrete effect path | Worker rechecks finalized contract state and payment evidence, then signs an EIP-3009 transfer from the seller to the original payer |
| Auditability | Public case manifest, sealed evidence, original signatures, contract address, transaction hashes, and status events |
| Failure path | Pending, provisional, insufficient-evidence, failed, and reserve-shortfall states remain visible without an invented refund |

The adapter's general supervisor examples use `continue`, `warn`, `constrain`, `revoke`, and `escalate`. This demo deliberately specializes the decision vocabulary to a purchase refund. It implements no long-lived delegation and therefore requires no ERC-7710 revocation controller. It also implements no reputation registry.

The Base Sepolia payment is verified by the registrar and refund worker. The GenLayer contract validates admitted facts and evidence bindings; it does not independently bridge or fetch a Base receipt. The effect path is a seller-operated relayer workflow, with its trust assumptions documented in [the trust model](../../../docs/trust-model.md).

## Source

Internet Court Consortium, MIT license. Source repository: [internet-court/internet-court-skill](https://github.com/internet-court/internet-court-skill). Snapshot commit: `462bf30efaea73c8af4ed9d6e9970d4495224ad2`. The copied entry and adapter are unmodified provenance references, with their [license](../upstream/internet-court/LICENSE).

This implementation is a builder demo, not a deployed production Internet Court service, a call to the IC consultation MCP, or an endorsement by Internet Court, GenLayer, or x402.
