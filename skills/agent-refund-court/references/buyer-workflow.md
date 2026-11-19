# Local buyer setup and review

Use this reference for first setup, a missing MCP connection, or review input construction.

## Setup

Clone [TS-mfon/agent-refund-court](https://github.com/TS-mfon/agent-refund-court), use Node.js 24+, and run `npm ci`. Configure the client to launch:

```text
node /ABSOLUTE/PATH/agent-refund-court/tools/arc-mcp.mjs
```

Set `ARC_BUYER_WALLET_FILE` and `ARC_MANDATE_FILE` to absolute local paths. Both JSON files must be regular, owner-only files (Unix mode 600), owned by the current user and at most 8 KiB. Symlinks are rejected.

The wallet file contains `privateKey` and matching `address`. Alternatively use `ARC_BUYER_PRIVATE_KEY` in the local process environment; configure exactly one wallet source. Keep the key out of agent output and repository/browser files.

The mandate contains only:

```json
{
  "allowedOrigins": ["https://agent-refund-court.vercel.app"],
  "maxPerPurchaseBaseUnits": "10000",
  "dailyBudgetBaseUnits": "50000"
}
```

Those limits mean 0.01 test USDC per purchase and 0.05 per UTC day. Configure values from the user's authorized mandate. The local ledger retains uncertain reservations and does not replenish them on refund.

`ARC_STATE_DIRECTORY` optionally selects an absolute persistent directory; the default is `~/.config/agent-refund-court/mcp-state`. Keep the same wallet and directory for recovery.

Fund the buyer with Base Sepolia USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. This exact authorization path uses no unlimited approval. Public wallet authentication requires no operator token. The calling agent's own model reviews the answer; no separate buyer Gemini credential is required.

[Full quickstart and wallet creation](https://agent-refund-court.vercel.app/docs/quickstart) · [Codex/Claude configuration](https://agent-refund-court.vercel.app/docs/mcp)

## Purchase

```json
{
  "origin": "https://agent-refund-court.vercel.app",
  "serviceId": "agent-work-v1",
  "brief": "Write a concise implementation plan for an inventory reporting tool. Cover data collection, one useful report and user validation. Assume one builder and no paid integrations."
}
```

Call `purchase_service` only after discovery and mandate checks. Persist its purchase/order/case identifiers. An identical wallet/origin/service/brief reuses the original purchase; use `resume_purchase` for uncertain results.

## Evidence

`get_evidence` accepts `{caseId,section,offset?,limit?}`. Read `brief`, `rubric` and `delivery` completely before review. Offset counts Unicode code points; limit is 100–1,200 UTF-8 bytes. Follow `nextOffset` until `complete:true`.

A summary is capped at 3,000 bytes and may omit the answer. The service rubric—not a generic remembered checklist—is authoritative.

## Acceptance

Call `submit_review`:

```json
{
  "caseId": "<original 0x-prefixed case id>",
  "action": "accept",
  "materialFailure": false,
  "criterionIds": [],
  "reason": "The answer gives the requested concrete plan and respects the supplied constraints.",
  "quotes": []
}
```

## Dispute

Use the same fields with `action:"dispute"`, `materialFailure:true`, one to three unique agreed criterion IDs, a reason up to 1,200 bytes and at most three exact original excerpts of at most 500 bytes each.

The supported IDs are `relevance`, `actionability` and `grounding`. Explain what materially failed against the accepted brief. Minor style preference does not qualify. The runtime signs and commits the review; the court decides the result.
