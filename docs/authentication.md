# Wallet authentication

Public buyers authenticate with their own EOA wallet. The service does not require a shared operator token for buyer onboarding. Sign-in provides access to that wallet's orders and buyer actions; agreement and payment authorization remain separate signatures.

## Request a challenge

```http
POST /api/v1/auth/challenge
Content-Type: application/json

{"address":"0xYOUR_BUYER_ADDRESS"}
```

Replace the address placeholder with your actual 20-byte hexadecimal wallet address. The response is `201`:

```json
{
  "challenge": {
    "id": "<64 lowercase hexadecimal characters without 0x>",
    "address": "<checksummed buyer address>",
    "message": "<exact server-issued sign-in message>",
    "expiresAt": 1795070000
  }
}
```

The message binds the configured service origin, wallet address, Base Sepolia chain ID/network, random nonce, issue time and expiry. It states that authentication authorizes no payment or transaction.

## Sign and obtain a session

Use EIP-191 `signMessage` over the exact server-issued message after checking those bindings. Send:

```http
POST /api/v1/auth/session
Content-Type: application/json

{"challengeId":"<original challenge id>","signature":"<65-byte signature>"}
```

The `201` response contains `session.accessToken`, `session.address` and `session.expiresAt`. All expiry fields are epoch seconds. Challenges last 300 seconds and can be consumed once. Sessions last 1,800 seconds.

The server uses an atomic conditional write to consume the challenge and stores the SHA-256 hash of the opaque bearer token. The token has the format `arc_` followed by 43 base64url characters.

## Use the session

Send `Authorization: Bearer <session.accessToken>` on quote, order-read, acceptance, delivery, decision and case-processing requests. A buyer session can access only that buyer's private orders and authenticated processing actions. Other wallets' private orders return a non-disclosing 404.

Public service, case manifests and published evidence remain readable without a session. Their publication is part of the accepted agreement.

The local MCP client validates challenge bindings, caches its session and reauthenticates after expiry. Its wallet key stays local. It supports EOA signatures; smart-contract-wallet EIP-1271 authentication is outside the current interface.

## Operator credentials

`DEMO_ACCESS_TOKEN` is an optional trusted operator credential used by scheduled processing and legacy operator tools. Keep it server-side or in the authorized worker's secret store. It grants broader operational access than a buyer session and is not distributed to public buyers.

## Limits and errors

| Durable authentication counter | Per minute | Per day |
| --- | ---: | ---: |
| Challenge requests per IP | 20 | 200 |
| Challenge requests per wallet | 5 | 50 |
| Session attempts per IP | 40 | 400 |
| Session attempts per wallet | 10 | 100 |

Authentication JSON bodies are capped at 2 KiB. The API also applies per-instance public request limits and a shared authenticated-write limit.

A mismatched browser Origin returns 403. Invalid, replayed or expired challenges/sessions return 401. Authentication quota exhaustion returns 429. Retry only after the indicated window; obtain a new challenge after expiry.

[API reference](api.md) · [Buyer quickstart](quickstart.md) · [Trust model](trust-model.md)
