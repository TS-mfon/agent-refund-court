# Hosting and operations

A seller deployment needs an API, durable state, receipt signer, seller generator, registrar-bound GenLayer court and funded refund worker. The reference application uses Vercel for the site/API and private Blob storage, and GitHub for source, checks and scheduled finite processing.

## Local development

Use Node.js 24 or newer:

```sh
npm ci
npm run build
npm run dev
```

In another terminal run `npm run dev:web`. The API listens at http://127.0.0.1:3001 and the proxied frontend at http://127.0.0.1:5173. Without a configured payment service and durable storage, the application displays unavailable purchase capabilities.

## Seller environment

Start from the repository's `.env.example` and configure your deployment's secret store:

| Setting | Purpose |
| --- | --- |
| `SERVICE_ORIGIN` | Exact canonical HTTPS merchant origin |
| `SELLER_ADDRESS` / `SELLER_PRIVATE_KEY` | Purchase recipient and refund authorizer |
| `RECEIPT_SIGNER_PRIVATE_KEY` | Seller agreement and immutable delivery signatures |
| `GENLAYER_NETWORK` / `GENLAYER_RPC_URL` | Court network and RPC; the supported live adapter uses StudioNet |
| `GENLAYER_CONTRACT` | Your verified registrar-bound QualityCourt deployment |
| `GENLAYER_REGISTRAR_PRIVATE_KEY` | Admit cases and submit adjudication to that court |
| `GEMINI_API_KEY` / `MODEL_ID` | Seller and defense generation; default `gemini-3.1-flash-lite` |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` | Private durable state configuration |
| `BASE_RPC_URL` | Base Sepolia receipt and authorization verification |
| `X402_FACILITATOR_URL` | Supported exact-payment facilitator |
| `PRICE_BASE_UNITS` | Quote principal in six-decimal USDC base units |
| `DEMO_ACCESS_TOKEN` | Optional trusted operator/worker credential |

Use distinct role keys where practical. Validate that the seller address matches the refund key. Public buyer sessions do not need the operator credential.

## Deploy your own court

The contract source is `contracts/quality_court.py`, pinned to a concrete GenVM runner. Deploy with your registrar and the supported rubric configuration. The registrar embedded in the contract must match the backend registrar key.

```sh
node --use-env-proxy --import tsx tools/deploy-contract.ts
```

This submits a real StudioNet transaction using your configured registrar. Record its transaction hash, await verified successful finality, check registrar, pinned source and `get_config.supportedServices`, then set `GENLAYER_CONTRACT`. The current contract admits both matching service/rubric pairs; its constructor policy version remains `launch-plan-v1`.

If deployment becomes uncertain, resume with `--reconcile <original deployment transaction hash>`. Preserve that identity rather than redeploying blindly. The [current deployment manifest](deployment.json) records the finalized two-service reference instance at `0x4eaf1BAc12573BDeA26a0c437D1f2ED4914600Ed`. The [original manifest](deployments/launch-plan-v1.json) preserves the court used by the recorded proof. Those manifests do not grant another registrar authority over either instance.

## Vercel deployment

The committed `vercel.json` builds static assets into `dist`, routes `/api/*` to the Node handler and rewrites site paths to the app. API functions are configured for finite execution.

Create your own Vercel project and private Blob store, configure the seller environment, and deploy the reviewed checkout. The reference operator's `tools/configure-vercel.ts` and private configuration helpers target its dedicated project; review and adapt them before using another project.

Blob records use create-only paths, fresh private reads, strong ETag validation and conditional writes. Delivery generation uses fenced leases, so a stale process cannot replace the committed answer. Keep the same durable store during upgrades and retries.

## Worker execution

A configured worker advances existing disputed cases: registration, registration finality, adjudication, adjudication finality, and an eligible refund.

```sh
npm run worker -- --origin https://YOUR_MERCHANT_ORIGIN
```

The operator CLI uses `DEMO_ACCESS_TOKEN`. It does not create buyer purchases. Authenticated buyers can request processing for their own cases through the API. The local buyer does not receive seller or registrar keys.

Configure your fork's worker origin and repository guard in `.github/workflows/process-cases.yml`, provide its operator credential as a GitHub Actions secret, and keep the workflow on the default branch. The reference workflow uses a five-minute schedule, bounded runtime and concurrency.

## Activity and scheduling

The site reads `GET /api/v1/activity/status` and, when automation is enabled, requests `POST /api/v1/activity/wake` with `{}`. Both routes are public; an Origin header, if present, must match the merchant on the wake request. A visit progresses existing paid disputes and cannot create a purchase or choose transfer terms.

Each wake awaits a finite processor step for at most one eligible case from the bounded public case scan. Shared storage enforces a 60-second cooldown and a 120-second coordination lease across server instances. Repeated visits during cooldown return current metadata instead of launching another visitor step. Eligible cases rotate, so one long-pending case does not permanently take every wake.

The activity response contains `automation.enabled`, `cooldownSeconds`, `leaseSeconds`, `maxCasesPerWake`, `caseScanLimit` and `startsPurchases:false`, plus status, timestamps, pending count, last case ID, safe error code and retry delay. A `processed` activity status means a worker step ran, not that the case reached finality or a refund completed. Read the case manifest for its actual outcome.

Visitor processing runs directly in the API and is awaited. It does not dispatch GitHub Actions or keep a background process alive after the request. The five-minute GitHub schedule is a separate recovery path when no visitor is present.

GitHub schedules do not stop after a few quiet hours. Official policy disables public-repository scheduled workflows after 60 days with no repository activity. Scheduled runs can also be delayed or dropped during high load; they run only from the default branch. A web visit does not reset that inactivity policy or re-enable a disabled workflow.

Treat scheduling and visitor wake as opportunities to resume durable jobs. Neither supplies a strict finality-time guarantee. Pending cases remain inspectable and can be resumed with the authenticated processing endpoint or trusted operator CLI.

## Operating budget

Seller inference is capped at 512 output tokens and defense at 128. The bundled optional buyer model uses 384 output tokens; the external MCP buyer uses its existing agent. GenLayer validator inference is separate.

Monitor Blob operations, function execution, Actions minutes, court transactions, model usage, seller test-USDC reserve and refund gas. Model errors remain explicit rather than producing invented deliveries. Rate limits bound public requests, authentication, writes and activity wake. They do not remove all Sybil or service-abuse costs.

## Upgrade and checks

Preserve original agreement/delivery bytes, payment identities, sealed evidence, refund nonces and durable jobs. A new court applies to new signed agreements; old cases remain bound to their original court. Runtime processing reads the court from the stored signed agreement and constructs the matching court/refund verifier. Retain registrar access to every original court with pending cases; changing a default contract cannot migrate an already accepted agreement.

```sh
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build
npm run contract:lint
```

Contract checks require the Python dependencies in the repository's `pyproject.toml`. Live checks spend provider credits or use testnet transactions and are separate from deterministic tests.

[Partner checklist](partner-guide.md) · [Models](models.md) · [Troubleshooting](troubleshooting.md) · [Official sources](sources.md)
