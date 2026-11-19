# MCP server

The repository's MCP server runs locally over STDIO. It connects an agent's existing model to the hosted merchant API while keeping buyer signing, state and spending limits in a local process.

## Install and launch

Clone the repository, run `npm ci`, and configure your client to launch:

```text
node /ABSOLUTE/PATH/agent-refund-court/tools/arc-mcp.mjs
```

Replace the absolute path with your actual checkout. The wrapper resolves the repository directory and loads its TypeScript runtime. Use the wrapper directly: launching `npm run` as a STDIO server can introduce non-protocol output.

The server uses the official MCP SDK. STDIO is local process transport; the hosted merchant HTTP API is a separate interface. The wrapper is supplied from the checkout and is not a published npm package or hosted MCP URL.

## Local configuration

- `ARC_MANDATE_FILE`: required absolute path to the strict JSON spending mandate.
- `ARC_BUYER_WALLET_FILE`: absolute path to an owner-only wallet JSON file containing `privateKey` and matching `address`.
- `ARC_BUYER_PRIVATE_KEY`: local environment alternative to the wallet file.
- `ARC_STATE_DIRECTORY`: optional absolute state path; default `~/.config/agent-refund-court/mcp-state`.

Configure exactly one wallet source. Both mandate and wallet JSON files must be regular, owner-only files (Unix mode 600), at most 8 KiB, owned by the current user; symlink files are rejected. Choose the wallet-file path for a persistent dedicated buyer. Store the key outside the repository. The MCP runtime reads the buyer configuration only; it does not need seller, registrar, operator or Google credentials.

The strict mandate accepts `allowedOrigins`, `maxPerPurchaseBaseUnits` and `dailyBudgetBaseUnits`. Amounts are positive decimal-string integers in six-decimal USDC units. Allowed origins are exact HTTPS origins, with localhost HTTP permitted for development. An origin path or unapproved merchant is rejected.

## Codex configuration

Add the server to your existing MCP configuration, using real absolute paths:

```toml
[mcp_servers.agent_refund_court]
command = "node"
args = ["/ABSOLUTE/PATH/agent-refund-court/tools/arc-mcp.mjs"]

[mcp_servers.agent_refund_court.env]
ARC_BUYER_WALLET_FILE = "/ABSOLUTE/PATH/private/buyer-wallet.json"
ARC_MANDATE_FILE = "/ABSOLUTE/PATH/private/mandate.json"
ARC_STATE_DIRECTORY = "/ABSOLUTE/PATH/private/arc-state"
```

This config contains paths, not the wallet key. Preserve other configured servers. The [official Codex MCP guide](https://developers.openai.com/codex/mcp) documents the client configuration surface.

## Claude Desktop configuration

Merge this entry into the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "agent-refund-court": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/agent-refund-court/tools/arc-mcp.mjs"],
      "env": {
        "ARC_BUYER_WALLET_FILE": "/ABSOLUTE/PATH/private/buyer-wallet.json",
        "ARC_MANDATE_FILE": "/ABSOLUTE/PATH/private/mandate.json",
        "ARC_STATE_DIRECTORY": "/ABSOLUTE/PATH/private/arc-state"
      }
    }
  }
}
```

Use the same command/args/env shape in another MCP client that supports a local STDIO process. Client-specific approval settings still apply; the protocol mandate determines what the buyer runtime can spend.

## Tool reference

| Tool | Input | Effect |
| --- | --- | --- |
| `discover_service` | `{origin}` | Read allowed merchant metadata and configured limits |
| `purchase_service` | `{origin,serviceId,brief}` | Authenticate, quote, sign, pay and retrieve original delivery |
| `resume_purchase` | `{purchaseId}` | Continue the same saved purchase |
| `submit_review` | `{caseId,action,materialFailure,criterionIds,reason,quotes}` | Sign and commit the buyer's one review |
| `get_case` | `{caseId}` | Read an owned local purchase's latest public case status |
| `get_evidence` | `{caseId,section,offset?,limit?}` | Read a bounded page of original evidence |

`get_evidence.section` is one of `brief`, `delivery`, `rubric`, `claim` or `defense`. Offset counts Unicode code points, from 0 to 3,000; limit bounds returned UTF-8 bytes, from 100 to 1,200. Start at offset 0 and use `nextOffset` until `complete:true`. Follow the returned continuation metadata until the entire relevant artifact has been read. Tool text output is capped at 3,000 UTF-8 bytes, so a purchase summary is not the complete delivery.

## Resources

The server also exposes `arc://docs/workflow` for its local procedure and `arc://case/{caseId}` for an owned case summary. Resources contain workflow or case metadata, not signing keys or raw checkout credentials.

## Custom purchase

```json
{
  "origin": "https://agent-refund-court.vercel.app",
  "serviceId": "agent-work-v1",
  "brief": "Write a concise implementation plan for an inventory reporting tool. Cover data collection, one useful report, and a way to validate the report with users. Assume a solo builder and no paid integrations."
}
```

`purchase_service` returns the local purchase identity and original delivery summary. Persist that identity. The same wallet, normalized origin, service ID and exact brief reuse the same purchase identity and original authorization. This is the recovery behavior; repeat calls do not intentionally buy a second identical task.

The service and rubric IDs must match in the returned signed agreement. Both supported services use the shared fixed quality policy, while `agent-work-v1` generation follows the buyer's exact custom brief. Briefs are limited to 1,200 UTF-8 bytes and the answer to 3,000 bytes; large reports, attachments and executed external jobs require another service.

## Tool results and safe failures

Success returns `ok:true`, plus route-specific `discovery`, `purchaseId`, `case` or `evidence`. A purchase's `case` is a compact summary with `caseId`, `orderId`, `status`, `reviewNeeded`, original hashes, payment/court/refund verification flags and viewer URL. Read complete original text with `get_evidence` before review.

Once a durable purchase exists, a pending or failed tool result can return `recovery:{purchaseId,orderId,caseId}` alongside `ok:false` and a safe error code. Order and case IDs remain null until known. Save those identifiers and use `resume_purchase` with `recovery.purchaseId` and the same wallet/state directory.

Pending operations use an MCP error result (`isError:true`) with bounded text and structured content. Recovery identifiers do not include wallet keys, bearer sessions or signed financial payloads. A failure during input validation or before a durable intent exists may have no `recovery` object.

An authentication or discovery failure before quote submission leaves the purchase resumable. If the quote request may have been submitted but its order identity was not recorded, `QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL` stops automatic requoting. Reconcile the original order from merchant/local records; the current MCP tool does not accept a replacement order or reset that intent. Preserve the state and involve the operator rather than create a second purchase.

## Submit a review

After reading the full original brief, rubric and delivery, the calling agent decides whether the answer materially fulfills the accepted purpose. A valid acceptance:

```json
{
  "caseId": "<original 0x-prefixed case id>",
  "action": "accept",
  "materialFailure": false,
  "criterionIds": [],
  "reason": "The original answer gives the requested concrete plan and respects the constraints.",
  "quotes": []
}
```

For a dispute, use `action:"dispute"`, `materialFailure:true`, applicable unique criterion IDs, an evidence-based reason and exact original excerpts. The runtime validates excerpts and signs the claim with the buyer wallet. The agent supplies no refund recipient, amount, token or court verdict.

## Budget and recovery

A durable reservation is made before payment. The per-purchase cap and total daily cap apply across allowed merchants for that wallet. The day boundary is UTC. Keep the same state directory across restarts and avoid parallel processes sharing a file-backed state directory unless its concurrency guarantees have been verified.

A pending, failed or uncertain checkout remains reserved. A refund does not automatically release the reservation. Reconfigure limits only under the user's authorization. Use `resume_purchase` to reconcile uncertainty.

The runtime buys and records evidence; the existing agent model performs buyer review. The merchant supplies seller inference and court/worker operation. A separate buyer Gemini API key is not required.

[Buyer quickstart](quickstart.md) · [Agent skill](agent-skill.md) · [HTTP API](api.md)
