# Verified live proof

The hosted demo completed a real x402 purchase, independent GenLayer ruling, and exact seller refund on November 19, 2026. The original 0.01 Base Sepolia USDC principal returned to the original buyer.

[Open the confirmed case](https://agent-refund-court.vercel.app/?case=0x4b3068cb77f1f4e2db7de1ccd08a335ed5d70855a475f9218e96bd023eef4bcc) · [Machine-readable receipt record](proofs/refunded-case.json)

| Step | Actual receipt |
| --- | --- |
| x402 purchase | [0x3e296839fb2ddb81505cb3210c85dc5b55678cd9856e2069c39ca5e3435009d4](https://sepolia.basescan.org/tx/0x3e296839fb2ddb81505cb3210c85dc5b55678cd9856e2069c39ca5e3435009d4) |
| GenLayer finalized REFUND | [0xd61d1c5e96f197c29df9bc84661f438baa82952f75d15f5adda491c1d375d66a](https://explorer-studio.genlayer.com/tx/0xd61d1c5e96f197c29df9bc84661f438baa82952f75d15f5adda491c1d375d66a) |
| Confirmed principal refund | [0x0f9639338e0f94c7ea6736634b20b3904a4b8f67db75edeee7cf135edb000ea0](https://sepolia.basescan.org/tx/0x0f9639338e0f94c7ea6736634b20b3904a4b8f67db75edeee7cf135edb000ea0) |

The buyer was `0x52003285023BFC1Ceac4de6ec9a55585200366b8`; the seller was `0xCa8d946a096cD8497C15865F8124007030Ea437d`. The payment and refund each contain exactly 10,000 six-decimal base units. The verifier checks original signed checkout/delivery, frozen evidence, successful finalized court receipt/state, and canonical same-transaction authorization/transfer events. It does not rely on the displayed status alone.

The answer in this case is the explicitly selected generic delivery fixture. Buyer evaluation, x402 payment, GenLayer adjudication, and refund use real integrations. TraceLite is fictional. Refund execution requires the cooperating seller described in the trust model.

A separate [live-generated purchase](https://agent-refund-court.vercel.app/?case=0x4d9e12fe5cf7f883c9a5fa9b98dff09d3fea6096733fe82bb52e98bbbaf3c58a) completed seller inference through Gemini 3.1 Flash-Lite and was independently accepted by the buyer. Its payment receipt is [0xcc1d44157be455e837eee769580d2356a8ecf54651f024a40b554aa58758e5d3](https://sepolia.basescan.org/tx/0xcc1d44157be455e837eee769580d2356a8ecf54651f024a40b554aa58758e5d3). No court ruling or refund is claimed for this accepted case.

## Run the independent check

Use the same original local buyer state and configured access token:

```sh
npm run proof:verify -- --origin https://agent-refund-court.vercel.app --case 0x4b3068cb77f1f4e2db7de1ccd08a335ed5d70855a475f9218e96bd023eef4bcc
```

The result reports `paymentVerified`, `deliveryVerified`, `courtVerified`, `refundVerified`, and `verified` as true. The public viewer remains available without private credentials.

## Integration findings

Private Blob reads can return weak ETags for compressed records. The adapter requests identity encoding and, if necessary, validates authoritative metadata against the bytes read before using a strong ETag for conditional writes. Stale writes still fail.

Refund reconciliation now inspects nonce state and stored transaction receipts before querying history. An unused nonce requires no historical scan; a known exact receipt proves an old payment's refund without scanning the whole interval. Unknown consumed nonces remain fail closed and may require a valid receipt hint if bounded history is unavailable.

Long court waits and deployment repairs were removed from the edited video. The video identifies the material as a recorded testnet case.
