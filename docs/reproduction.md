# Reproduce the testnet flow

The primary path for a new buyer is the [own-wallet quickstart](quickstart.md) with the [MCP server](mcp.md). It supports custom briefs and uses the buyer agent's existing model. No seller operator token is required.

This guide covers the original launch-plan fixtures and the optional bundled demo CLI. Those scenarios provide controlled evidence for the same payment, review, court and refund flow.

## Inspect before spending

```sh
curl -fsS https://agent-refund-court.vercel.app/api/v1/service
curl -fsS https://agent-refund-court.vercel.app/api/v1/cases
```

Confirm the exact seller, receipt signer, price, network, court and enabled capabilities. The [recorded proof](live-proof.md) establishes one completed real refund; discovery metadata alone does not prove a new transaction completed.

## Own-agent reproduction

Configure your local buyer wallet, funded Base Sepolia USDC, mandate and MCP connection from the quickstart. Call `purchase_service` for a concise `agent-work-v1` brief. Read the full original brief, rubric and delivery with `get_evidence`, then submit one acceptance or evidence-based material dispute.

Use a task appropriate to bounded text generation. A satisfactory live answer may be accepted; a refund is not the required outcome of every purchase. If disputed, GenLayer independently decides the case.

## Optional fixture CLI

Use Node.js 24+ and the cloned checkout. The original CLI setup creates its own private role-wallet file and prints public addresses:

```sh
npm ci
node --import tsx tools/setup-demo.ts
```

The CLI uses the local buyer role. Against a hosted merchant, seller, registrar and receipt signer remain that deployment's own roles. Preserve the local private wallet/state file; it is separate from the recommended single-wallet MCP configuration.

Fund the printed buyer address with the advertised Base Sepolia test-USDC principal. Configure the local buyer model through `GEMINI_API_KEY` and `MODEL_ID` or its private local model configuration. The default verified model is `gemini-3.1-flash-lite`.

The demo CLI can authenticate through wallet sign-in. `DEMO_ACCESS_TOKEN` remains an optional operator override. `EXPECTED_SELLER` can pin the expected seller. Keep credentials out of command arguments and public files.

For one explicitly authorized test purchase, choose one scenario:

```sh
npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad
```

| Scenario | Delivery | Real integrations |
| --- | --- | --- |
| `bad` | Labelled generic fixture | Payment, buyer evaluation, court if disputed, refund if awarded |
| `good` | Labelled useful fixture | Payment and buyer evaluation; an accepted answer needs no court |
| `live` | Actual seller generation | Seller inference plus the same payment/review/dispute flow |

Change `--scenario` for the desired single run. TraceLite is fictional. A fixture label is presentation provenance, not a court verdict instruction.

The CLI's model-driven fixture path is an optional demonstration tool. The reusable MCP client provides the standing-budget workflow for external agents.

## Resume the original order

Save the printed order/case IDs and viewer URL. After an uncertain CLI result:

```sh
npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad --resume 0xYOUR_ORIGINAL_ORDER_ID
```

Replace the placeholder with the original 32-byte order ID. Use the same wallet and local state. The original checkout is reused. An unknown financial outcome is not permission to create a second authorization.

MCP buyers instead call `resume_purchase` with their original local purchase ID.

## Follow an existing dispute

The merchant advances existing disputes through its configured worker. A buyer session may call its own case's authenticated processing endpoint. An authorized operator can use:

```sh
npm run worker -- --origin https://agent-refund-court.vercel.app --case 0xYOUR_CASE_ID --steps 120
```

The operator worker needs its private operator token; it does not create purchases or let the client choose a ruling or refund destination. Bounded polling may end while the original case remains pending.

## Verify the outcome

Acceptance completes useful work without a court ruling. A quality refund requires verified original payment, a verified final `REFUND` finding and a confirmed verified transfer of exact original principal to the original payer.

Inspect the original evidence and all chain links. The [proof tool](live-proof.md) independently checks the recorded refunded case using its original local buyer state and configured verification credentials. A public viewer is available without those private records.

Report actual status, provenance, viewer URL and available payment/court/refund hashes. A zero CLI exit or displayed award alone does not prove principal returned.

## Deploy independently

Your seller needs its own Vercel project, private state, role keys, model access, funded refund reserve/gas and registrar-bound court. The original operator's private helpers target its dedicated project and are not generic provisioning scripts.

[Seller guide](hosting.md) · [API](api.md) · [Trust model](trust-model.md) · [Agent skill](../skills/agent-refund-court/SKILL.md)
