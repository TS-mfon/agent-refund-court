# Buyer quickstart

Use your existing agent as the buyer. The local MCP server signs with your own wallet, buys an allowed service within your standing mandate, and lets the agent review the result with its current model.

## Inspect the merchant

The reference deployment is https://agent-refund-court.vercel.app. Public discovery requires no wallet or token:

```sh
curl -fsS https://agent-refund-court.vercel.app/api/v1/service
curl -fsS https://agent-refund-court.vercel.app/api/v1/services
```

Check `services`, `priceBaseUnits`, `network`, `seller`, `receiptSigner`, `courtAddress`, and `capabilities.purchase`/`generation`. This version uses `eip155:84532` and USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The reference price is 10,000 base units, or 0.01 test USDC. The catalog provides each service's title, fixed rubric, byte limits and current capabilities. A custom purchase uses `agent-work-v1` and requires a nonblank task brief within 1,200 UTF-8 bytes; delivery is bounded to 3,000 bytes.

## Install the local client

Use Node.js 24 or newer:

```sh
git clone https://github.com/TS-mfon/agent-refund-court.git
cd agent-refund-court
npm ci
```

The repository supplies a local wrapper, `tools/arc-mcp.mjs`. The project is private on npm; clone it and use an absolute wrapper path in the client configuration.

## Prepare a buyer wallet

Use an EOA wallet you control. Store a local JSON file with `privateKey` and its matching `address`, restrict it to the owning user, and point `ARC_BUYER_WALLET_FILE` at its absolute path. The key stays in the local MCP process.

To create a dedicated testnet wallet from this checkout:

```sh
node --input-type=module -e '
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const directory = join(homedir(), ".config", "agent-refund-court");
await mkdir(directory, { recursive: true, mode: 0o700 });
const privateKey = generatePrivateKey();
const address = privateKeyToAccount(privateKey).address;
const path = join(directory, "buyer-wallet.json");
await writeFile(path, JSON.stringify({ privateKey, address }), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ address, walletFile: path }));
'
```

This creates a new file once and prints only its address and path. If the file already exists, preserve it and use the original wallet.

Fund that address with Base Sepolia test USDC. A purchase needs at least the advertised principal. The x402 facilitator submits the original authorization; this flow does not require an unlimited token approval. The seller supplies refund gas and reserve. This implementation supports testnet funds only.

## Set a standing mandate

Create an owner-only local `mandate.json` file (Unix mode 600):

```json
{
  "allowedOrigins": ["https://agent-refund-court.vercel.app"],
  "maxPerPurchaseBaseUnits": "10000",
  "dailyBudgetBaseUnits": "50000"
}
```

This permits up to 0.01 test USDC per purchase and 0.05 per UTC day across the allowed origins for that local wallet. Keep the maximum purchase below or equal to the daily budget. An uncertain authorization retains its reservation; refunds do not replenish this ledger automatically.

The mandate is the user's authorization for purchases within its scope. A new approval is needed when the agent would exceed that scope, change the allowlist, or increase the spending limits.

## Connect the MCP server

Configure the local client with these environment variables:

- `ARC_BUYER_WALLET_FILE`: absolute path to the private buyer JSON file.
- `ARC_MANDATE_FILE`: absolute path to the mandate JSON file.
- `ARC_STATE_DIRECTORY`: optional absolute state directory; defaults to `~/.config/agent-refund-court/mcp-state`.

See [MCP configuration](mcp.md) for Codex and Claude Desktop examples.

## Buy and review

Give your agent a task and identify the standing mandate, for example:

```text
Using Agent Refund Court, buy a concise implementation plan for an
inventory reporting tool. It should cover data collection, one useful
report, and a way to validate the report with users. Use the merchant
and spending limits in my configured mandate. Inspect the full original
answer and accept it if it materially meets the brief; otherwise submit
an evidence-based dispute. Resume the original purchase after uncertainty.
```

The agent discovers the service, calls `purchase_service`, reads the full answer through `get_evidence`, and calls `submit_review`. It uses its own model; a Gemini API key is not required on this path.

Save the returned `purchaseId`, case summary's `orderId`/`caseId` and viewer URL. Once a durable purchase exists, a pending or failed tool result can return `recovery:{purchaseId,orderId,caseId}` alongside `ok:false` and a safe error code. Order and case IDs remain null until known. Save those identifiers and use `resume_purchase` with `recovery.purchaseId` and the same wallet/state directory. Accepted work ends with buyer acceptance. Disputed work progresses through the seller's court and refund worker; inspect `get_case` until the actual terminal or pending state is clear.

An authentication or discovery failure before quote submission leaves the purchase resumable. If the quote request may have been submitted but its order identity was not recorded, `QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL` stops automatic requoting. Reconcile the original order from merchant/local records; the current MCP tool does not accept a replacement order or reset that intent. Preserve the state and involve the operator rather than create a second purchase.

## Completion

Report acceptance when the original signed delivery has been accepted. Report a quality refund only when payment, final `REFUND` ruling and exact confirmed return transfer are verified. If the court or transfer is still pending, retain the identifiers and report that state.

[Agent skill](agent-skill.md) · [Authentication](authentication.md) · [Recovery](troubleshooting.md)
