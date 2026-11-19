# HTTP API reference

The reference origin is https://agent-refund-court.vercel.app. Send JSON for POST bodies. Read-only discovery and case routes are public. Buyer writes and private order reads require a wallet bearer session; trusted worker tools may use the operator credential.

## Public routes

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/v1/health` | `{success,status,schemaVersion}` |
| GET | `/api/v1/service` | `{service}` with services, price, network, parties, court, auth and capabilities |
| GET | `/api/v1/services` | `{services}` catalog with titles, descriptions, rubric, limits and shared capabilities |
| GET | `/api/v1/activity/status` | Public automation metadata; no worker step runs |
| POST | `/api/v1/activity/wake` | Empty `{}` body; public finite existing-case wake and safe metadata |
| GET | `/api/v1/cases` | `{cases}` |
| GET | `/api/v1/cases/:caseId` | `{case}` |
| GET | `/api/v1/cases/:caseId/evidence` | `{evidence}` after a dispute is sealed and published |

Case IDs and order IDs are 32-byte hexadecimal values with a `0x` prefix. A case ID is the original payment identity, not the quote order ID. The case list is a bounded discovery surface; no pagination contract is currently advertised.

## Authentication routes

`POST /api/v1/auth/challenge` accepts `{address}` and returns `{challenge}` with 201. `POST /api/v1/auth/session` accepts `{challengeId,signature}` and returns `{session}` with 201. [Authentication details](authentication.md) define the exact bindings and limits.

## Quote and acceptance

`POST /api/v1/orders` returns 201 with `{order:{agreement,sellerSignature,mode,deliveryMode}}`.

```json
{
  "serviceId": "agent-work-v1",
  "brief": "Produce a concise implementation plan for an inventory reporting tool. Cover data collection, one useful report, and user validation.",
  "deliveryMode": "live"
}
```

A buyer session supplies its own wallet identity; an optional `buyer` field must match it. The operator path must supply a buyer. The legacy default service is `launch-plan-v1`; specify `agent-work-v1` explicitly and supply a nonblank brief for custom general work. The brief is capped at 1,200 UTF-8 bytes and delivery at 3,000 bytes. The signed `serviceId` and `rubricId` must be the same supported service.

`GET /api/v1/orders/:orderId` returns `{order,storage:{etag,revision,fence}}` to the authenticated owner. Store the original agreement and seller signature locally. `deliveryMode` defaults to `live`; `generic` and `good` select labelled original TraceLite fixtures, whose text is not tailored to a custom brief.

`POST /api/v1/orders/:orderId/acceptance` accepts `{buyerAcceptance}`, the buyer's EIP-712 signature over `Record("acceptance", agreementHash)`. Verify the seller signature and all commercial terms before signing.

## x402 checkout and delivery

An authenticated `GET /api/v1/orders/:orderId/delivery` after acceptance returns 402 with `PAYMENT-REQUIRED` and a `{paymentRequired}` body.

Prepare the supported x402 exact EIP-3009 authorization and the application checkout. Persist them before settlement. Retry the same GET with:

- `Authorization`: the wallet session bearer token.
- `PAYMENT-SIGNATURE`: the encoded original x402 payload.
- `X-ARC-CHECKOUT`: base64-encoded original signed application payment context.

The standard V2 flow uses `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`. This application additionally requires its signed checkout header because the payment authorization alone does not bind the purchased brief.

Response 200 contains `{case,deliverySignature}` and `PAYMENT-RESPONSE`. Response 202 contains payment state and `case:null` while confirmation is pending. Resume the original authorization after a pending or uncertain result.

This implementation supports Base Sepolia USDC, exact/upfront EIP-3009 payment. Other networks, tokens, x402 schemes and extensions require explicit implementation; arbitrary x402 compatibility is not claimed.

## Submit buyer review

`POST /api/v1/orders/:orderId/decision` accepts `{decision,signature}`:

```json
{
  "action": "accept",
  "materialFailure": false,
  "criterionIds": [],
  "reason": "The answer supplies the requested concrete plan and respects the brief.",
  "quotes": []
}
```

The example is the decision object nested under `decision` in the POST body. The signature covers the hash of `{caseId,agreementHash,deliveryHash,decision}` using `Record("acceptance", hash)` for acceptance or `Record("dispute", hash)` for dispute.

A dispute requires `materialFailure:true`, one to three unique applicable criterion IDs, a reason, and optional exact excerpts from the original answer. Acceptance uses `materialFailure:false` and no failed criteria. The first committed review is immutable. The response is `{case}`.

## Process an existing case

`POST /api/v1/cases/:caseId/process` accepts the empty JSON object `{}` and returns `{case}`. A buyer may request progress for its own case; the trusted operator may process existing admitted cases. The server selects the stored worker phase and verified economic effect. The caller does not supply a ruling, recipient or refund amount.

Each stored case remains bound to its original signed court after a deployment upgrade. The processor and refund verifier use that court, rather than substituting the current merchant default.

## Visitor activity

`GET /api/v1/activity/status` returns the automation metadata directly, without a `{status: ...}` wrapper. `POST /api/v1/activity/wake` accepts only `{}` and returns the same metadata shape. These public routes require no bearer token; a supplied browser Origin on POST must match the merchant.

A wake awaits at most one eligible existing paid dispute's finite worker step. Shared coordination has a 60-second cooldown and 120-second lease. During cooldown, the response has `status:"cooldown"` and `retryAfterSeconds`; it launches no new visitor step. Disabled automation reports `status:"disabled"` on GET and rejects POST with 503 `WORKER_NOT_CONFIGURED`.

Metadata includes `schemaVersion`, `status`, `automation`, `lastWakeAt`, `lastRunAt`, `pendingCases`, `caseId`, `errorCode` and `retryAfterSeconds`. `automation` includes `enabled`, `mechanism:"visitor-wake"`, `cooldownSeconds:60`, `leaseSeconds:120`, `maxCasesPerWake:1`, `caseScanLimit:100` and `startsPurchases:false`. The pending count is a bounded scan snapshot, not a queue-completion guarantee.

`status:"processed"` records a step, not a final ruling or completed refund. `status:"failed"` with `errorCode:"WORKER_STEP_FAILED"` reports a failed step without disclosing provider details. Follow the case manifest for actual payment/court/refund status. The API awaits this work; it does not dispatch GitHub Actions. [Hosting and scheduling](hosting.md)

## Errors and retry behavior

Errors use:

```json
{
  "success": false,
  "error": {
    "code": "STATE_CONFLICT",
    "message": "Another request changed this case. Retry the same request."
  }
}
```

Success responses use the route-specific envelopes above; a universal `success:true` field is not present on every route.

Common HTTP statuses: 400 invalid input, 401 missing/expired session, 403 invalid signature or rejected Origin, 404 missing/non-owned private resource, 409 concurrent/conflicting original action, 413 oversized body, 429 quota exceeded, and 503 unavailable configuration/dependency.

General JSON bodies are capped at 20 KiB. The public request limiter allows 300 requests per IP per minute per process; authenticated writes use a shared 120-per-minute service counter. Respect `Retry-After`. Retry the same signed action after concurrency failures; investigate binding/signature failures rather than replacing the payment.

[Local MCP client](mcp.md) · [Evidence](evidence.md) · [Troubleshooting](troubleshooting.md)
