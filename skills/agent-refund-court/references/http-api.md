# HTTP integration without MCP

Use this branch only when the client can sign locally and persist original buyer state. Preserve the same user mandate and financial bounds as the MCP path.

1. Read `GET /api/v1/service` from the exact allowed merchant origin.
2. Request `POST /api/v1/auth/challenge {address}`; verify origin/wallet/network/expiry and sign the exact EIP-191 message locally.
3. Submit `POST /api/v1/auth/session {challengeId,signature}` and keep the returned bearer session private.
4. Request `POST /api/v1/orders` for the exact service and custom brief. Verify the signed quote and all commercial bindings.
5. Reserve principal within the user's mandate and locally sign buyer agreement acceptance.
6. Submit acceptance, read the delivery endpoint's original 402 challenge, and prepare/persist its x402 payload plus signed application checkout.
7. Retry the original delivery request with the same `PAYMENT-SIGNATURE`, `X-ARC-CHECKOUT` and wallet bearer session until verified original delivery is available or explicitly pending.
8. Verify signed delivery and original payment identity. Read the full accepted brief, rubric and answer. Sign and submit one accept/dispute decision.
9. Follow the original case and verify finality/transfer before reporting a refund.

The repository's `createBuyerClient` in `src/workflow/buyer.ts` supplies the quote, checkout, delivery and review implementation. A wallet-session adapter supplies ownership authentication; a persistent StateStore supplies original-record recovery; a pre-payment hook enforces the mandate.

Read the [API contract](https://agent-refund-court.vercel.app/docs/api) and [signature/evidence reference](https://agent-refund-court.vercel.app/docs/evidence) before implementing this branch. A generic automatic x402 retry client alone does not supply this application's agreement/delivery binding.
