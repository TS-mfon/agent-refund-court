# Reproduce Agent Refund Court

The public viewer displays cases without authentication. To create a case, run the buyer agent locally against an authorized deployment. Each purchase spends 0.01 Base Sepolia test USDC. Application hosting and durable storage use Vercel; source and automation use GitHub.

## Inspect first

Open [the case viewer](https://agent-refund-court.vercel.app) or read:

```sh
curl -fsS https://agent-refund-court.vercel.app/api/v1/service
curl -fsS https://agent-refund-court.vercel.app/api/v1/cases
```

The service advertises the seller, receipt signer, payment network, price, configured court address, and enabled capabilities. A configured capability is not evidence that a live transaction has completed.

The GenLayer QualityCourt deployment was finalized on StudioNet at:

```text
contract: 0xb37AFE3AEaed97e45c4715F85b036206CEC6EcE6
deployment transaction: 0xb74289010dcc82b75db4215df5fb3d87b9a1df9e82e98b016dd1972c3cd12b6c
```

This deployment proof is separate from payment, adjudication, and refund proofs. StudioNet availability and finality timing may change.

## Prepare a fresh local buyer

Use Node.js 24 or later:

```sh
git clone https://github.com/TS-mfon/agent-refund-court.git
cd agent-refund-court
npm ci
node --import tsx tools/setup-demo.ts
```

The setup command creates private role wallets in `~/.config/agent-refund-court/wallets.json` with owner-only file permissions. It prints addresses, not keys, and reuses an existing file. For a hosted demo run, only the buyer role is used locally. The deployment keeps its own seller, registrar, and receipt signer.

Fund the printed buyer address with at least 0.01 Base Sepolia USDC. Use test tokens only. The x402 facilitator submits the purchase authorization and pays its transaction gas; the buyer does not need to send an unlimited token approval.

Load these values into your shell through a private secret manager or hidden terminal input:

| Variable | Required value |
| --- | --- |
| `DEMO_ACCESS_TOKEN` | Token provided privately by the deployment operator |
| `GEMINI_API_KEY` | Your Google API credential for the local buyer model |
| `MODEL_ID` | `gemini-3.1-flash-lite`, the live-verified default; any override must pass a real generation probe |
| `EXPECTED_SELLER` | Optional seller pin, checked against the signed agreement |

Credentials are never placed in CLI arguments, GitHub files, public manifests, or the frontend. A token grants access to the subsidized demo backend; it does not replace the buyer's agreement, checkout, or dispute signatures. If you do not have an operator token, use the public viewer or deploy your own instance following the [repository README](../README.md).

## Choose one scenario

```sh
npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad
```

| Scenario | Delivery | Integration exercised |
| --- | --- | --- |
| `bad` | Explicitly selected generic answer fixture | Real purchase; real buyer evaluation; real court if disputed; real refund if awarded |
| `good` | Explicitly selected useful answer fixture | Real purchase and buyer evaluation; an accepted answer needs no court or refund |
| `live` | Seller generates the answer through Flash-Lite | Real seller generation plus the same purchase and dispute flow |

The buyer's choice is independent; a scenario is not a forced outcome. The brief uses fictional TraceLite so no real product data is needed.

Save the printed `orderId`, `caseId`, and viewer URL. The local buyer persists its original quote, checkout authorization, and evaluation under `~/.config/agent-refund-court/buyer-state`. Preserve those files.

## Resume after a timeout

Run the original order with the same buyer wallet:

```sh
npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad --resume 0xYOUR_ORIGINAL_ORDER_ID
```

Replace the placeholder with the 32-byte hexadecimal order identifier printed by the first run. The CLI reuses the original checkout; an uncertain payment is not replaced with a new authorization.

To progress an already disputed case:

```sh
npm run worker -- --origin https://agent-refund-court.vercel.app --case 0xYOUR_CASE_ID --steps 120
```

The worker command calls the authenticated processing endpoint. The server performs registration, checks its finality, submits adjudication, checks the ruling, and runs the seller refund worker when eligible. Polling is bounded. An exhausted polling budget leaves a case pending; it does not prove a failed or completed financial outcome.

## Inspect proof

The viewer links payment and refund transactions on Base Sepolia and shows the GenLayer ruling and original evidence. Public routes:

```text
GET /api/v1/cases
GET /api/v1/cases/<caseId>
GET /api/v1/cases/<caseId>/evidence
```

Require a verified original payment, finalized verified `REFUND` court proof, and confirmed verified refund matching the original payer, token, and amount before reporting a successful refund. The CLI's final JSON and the viewer must agree. An accepted case is successful without a refund; provisional and unresolved cases must remain labelled.

## Local verification

```sh
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:coverage
npm run test:e2e
npm run contract:lint
```

Unit and integration tests use explicit doubles. The first real purchase, fresh-machine reproduction, and recorded video require separate live evidence. Consult [submission status](submission.md) for the evidence required before presenting the demo.

## Operator responsibilities

A deployment operator supplies a private demo token, Vercel Blob configuration, seller and receipt signer credentials, GenLayer registrar credentials, the deployed contract address, Base RPC/facilitator configuration, and seller model access. The seller needs USDC reserve plus Base Sepolia ETH for refund gas. Buyer keys stay local.

The repository's `tools/private-config.ts`, `tools/configure-vercel.ts`, and `tools/run-private.ts` target the original operator's dedicated project and private directory. They are convenience tools for that operator, not generic provisioning scripts. A fresh operator must configure their own wallets, registrar-bound contract, Blob store, Vercel project, and environment variables from the README. Reusing the original contract with a different registrar will fail authorization.

The public [agent skill](../skills/agent-refund-court/SKILL.md) gives the same execution and recovery procedure.
