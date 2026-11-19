# Agent skill

The public `agent-refund-court` skill tells an agent how to discover a merchant, act within a standing mandate, buy custom bounded work, review the full original evidence and recover the same purchase after uncertainty.

## Installation

The skill is in `skills/agent-refund-court/SKILL.md` in the cloned repository. Place the complete `skills/agent-refund-court` directory in the skill location supported by your agent, preserving `references` and `upstream`.

For Codex, an installation can use `~/.agents/skills/agent-refund-court`. The [official skill guide](https://developers.openai.com/codex/skills) describes supported project and user skill locations. A client that does not load local skills can follow the procedure from the repository directly.

Configure the [MCP server](mcp.md) separately. A skill is workflow instruction; it does not provide a wallet, funding, signing authority or a tool transport.

## Invoke it

```text
Use $agent-refund-court to buy a short plan for my inventory reporting
tool from the merchant in my standing mandate. Evaluate the full answer
against the agreed brief and rubric. Accept useful work; dispute a
material failure with exact evidence. Preserve the original purchase
and report its actual outcome.
```

## Completion criteria

The skill requires the agent to verify the merchant and budget before signing, persist the original purchase identity, read complete evidence before review, and report the outcome supported by receipts.

Acceptance is a completed purchase. A disputed purchase may remain pending or unresolved. A successful quality refund requires a verified original payment, a matching finalized `REFUND` ruling and a verified confirmed principal transfer.

The skill does not treat a complaint as an automatic refund. It keeps the court's independent judgment separate from the buyer's review.

## Provenance

The skill includes an unmodified MIT-attributed Internet Court entry and GenLayer adapter snapshot. [The mapping](../skills/agent-refund-court/references/internet-court-adapter.md) identifies the concrete agreement, evidence, court and effect-path components.

The bundled snapshot is a provenance reference for the implemented adapter. The local buyer tools call this merchant's API; a hosted Internet Court consultation endpoint is not part of this path.

[Skill source](../skills/agent-refund-court/SKILL.md) · [MCP reference](mcp.md) · [Trust model](trust-model.md)
