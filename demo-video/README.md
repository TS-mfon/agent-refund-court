# Agent Refund Court video

A 44-second, 1920×1080, 30 FPS H.264 demo. It uses AI-authored Remotion editing, motion and captions around actual browser captures and verified case data. Audio is intentionally silent. No generated footage or synthesized chain receipts are used.

The renderer rejects a case unless the original payment, finalized GenLayer REFUND ruling, and returned USDC principal are all verified and match. The on-screen fixture disclosure stays visible.

## Reproduce

From this directory:

```sh
npm ci
npm test
npm run capture -- --origin https://agent-refund-court.vercel.app --case 0xACTUAL_CASE_ID
npm run render -- --props case.json
```

Replace the case placeholder with a completed case from the public viewer. Capture uses the parent's Playwright browser. Rendering uses Remotion's bundled browser. Linux needs Chromium's native libraries; this development environment supplied ALSA from an isolated temporary directory through LD_LIBRARY_PATH.

The render saves QA stills to out/qa, the MP4 to out/agent-refund-court.mp4, and public copies to ../public/demo.mp4 and ../public/demo-poster.png. Previous public exports are replaced only after rendering succeeds. provenance.json records the actual receipts, captured source and artifact hash.

Run `npm run studio` for the editable composition. The default preview requires a completed input case; it does not invent a success.

## Story

| Seconds | Focus |
| --- | --- |
| 0–4 | An agent paid for work |
| 4–9 | Agent skill and agreed brief |
| 9–15 | Real x402 payment and original answer |
| 15–21 | Buyer complaint and frozen evidence |
| 21–29 | Finalized independent GenLayer judgment |
| 29–36 | Seller worker and confirmed USDC refund |
| 36–40 | Matching original payer and principal |
| 40–44 | Reproduce and inspect the receipts |

The three protocol logos are copied verbatim from the repository's attributed official assets. Their owners retain trademark rights. Remotion's free license applies to this individual noncommercial demo; see https://www.remotion.dev/docs/license.
