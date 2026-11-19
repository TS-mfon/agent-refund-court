# Internet Court integration mapping

Agent Refund Court implements Internet Court's GenLayer review adapter for bounded one-shot text work. Internet Court contributes the review framework; x402 moves the original purchase; GenLayer supplies independent qualitative judgment; the cooperating seller executes an eligible final consequence.

The official entry skill routes disputed jobs, SLAs and refunds to `integrations/genlayer-intelligent-contracts/SKILL.md`. That adapter requires a mandate, rubric, evidence schema, decision output, concrete effect path and auditability. Read the [unmodified bundled adapter](../upstream/internet-court/integrations/genlayer-intelligent-contracts/SKILL.md) for its wording.

| Adapter requirement | Concrete implementation |
| --- | --- |
| Review objective | Signed Agreement for the exact bounded service, brief, principal and refund policy |
| Mandate | User-approved merchant allowlist, per-purchase cap and daily budget in the local buyer runtime |
| Rubric | Frozen service descriptions using relevance, actionability and grounding |
| Original receipts/artifacts | SealedEvidence binds payment, agreement, exact delivery, claim and bounded defense |
| Intelligent-contract review | QualityCourt admission and independent original-evidence adjudication |
| Decision | REFUND, NO_REFUND or INSUFFICIENT_EVIDENCE with substantive findings |
| Effect path | Seller worker verifies final ruling and original payment, then signs exact-principal return |
| Auditability | Public manifests, evidence, signatures, contract/transaction links and state events |
| Failure path | Pending, provisional, insufficient-evidence, undetermined and operational-failure states remain visible |

The original `launch-plan-v1` example specializes the rubric to practical first-week promotion. `agent-work-v1` extends the same mechanism to concise custom text tasks with its service-specific frozen rubric. A new service requires compatible agreement, generation, admission and judgment logic; metadata alone is insufficient.

The general supervisor adapter uses continue/warn/constrain/revoke/escalate vocabulary. This implementation specializes the consequence to a one-shot purchase refund. It provides no long-lived delegation, reputation registry, escrow or ERC-7710 revocation controller.

Base payment facts are checked by the registrar and refund worker. The court validates the admitted facts and original evidence but receives no trustless cross-chain proof. Refund execution remains a seller-operated workflow. [Trust model](https://agent-refund-court.vercel.app/docs/trust-model)

## Source and attribution

Internet Court Consortium, MIT license. Repository: [internet-court/internet-court-skill](https://github.com/internet-court/internet-court-skill). Unmodified snapshot commit: `462bf30efaea73c8af4ed9d6e9970d4495224ad2`. The bundled [entry](../upstream/internet-court/SKILL.md), [adapter](../upstream/internet-court/integrations/genlayer-intelligent-contracts/SKILL.md), [source record](../upstream/internet-court/SOURCE.md) and [license](../upstream/internet-court/LICENSE) preserve provenance.

This builder implementation operates its own QualityCourt. It does not call a production hosted Internet Court ruling API or consultation MCP, and it claims no partner endorsement.
