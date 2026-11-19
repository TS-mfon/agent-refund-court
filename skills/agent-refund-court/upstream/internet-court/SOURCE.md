# Internet Court source snapshot

Source: https://github.com/internet-court/internet-court-skill
Commit: 462bf30efaea73c8af4ed9d6e9970d4495224ad2
Retrieved: 2026-11-19

The Internet Court Consortium's MIT license applies to the entry skill and files under `integrations/`; its vendored protocol skills have separate licenses and are not copied here.

Included unmodified:

- `SKILL.md`: official entry skill, retained as provenance and routing context.
- `integrations/genlayer-intelligent-contracts/SKILL.md`: official qualitative-review adapter used by this demo.
- `integrations/genlayer-intelligent-contracts/references/agent-supervisor-contract.md`: accompanying supervisor example.
- `LICENSE`: Internet Court Consortium's license and copyright notice.

This is a narrow source snapshot, not a complete installation of Internet Court. Other routes named by the entry skill are available in the upstream repository. Resolve them there before applying any unrelated branch; do not infer missing skills.

The local [agent skill](../../SKILL.md) and [implementation mapping](../../references/internet-court-adapter.md) specialize the review framework to a one-shot quality refund. The original supervisor's authority-revocation examples remain reference material; those capabilities are not implemented by this demo.
