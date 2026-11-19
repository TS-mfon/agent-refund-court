# Lightweight buyer and seller models

Buyer, seller, and seller defense default to the live-verified `gemini-3.1-flash-lite` model through the direct Google REST API. This bypasses Vercel AI Gateway, whose free credits require billing activation. It introduces no additional application host.

| Role | Maximum output tokens | Purpose |
| --- | ---: | --- |
| Seller | 512 | A 180–220 word launch plan |
| Buyer | 384 | A structured accept/dispute decision |
| Seller defense | 128 | A 40–60 word response to the complaint |

Every request asks for one candidate. Gemini 2.5 Flash-Lite uses `thinkingBudget: 0`; Gemini 3.1 and 3.5 Flash-Lite use `thinkingLevel: minimal`, which minimizes reasoning but does not guarantee that thinking is disabled. The default timeout is 20 seconds, the input prompt is limited to 8 KiB, and the adapter does not retry automatically. The usual disputed workflow makes three calls, with a combined maximum of 1,024 output tokens. Input tokens are additional; actual usage depends on the agreement and delivery.

The buyer uses Google's native `responseSchema` and application validation. It cannot select a refund amount, recipient, chain, or execution instruction. Quotes must occur verbatim in the original delivery. Truncated, blocked, incomplete, malformed, or timed-out responses produce explicit errors. They never produce an invented answer or verdict.

GenLayer's intelligent contract independently adjudicates the sealed case. These lightweight models do not replace validator consensus or decide whether funds move.

## Credentials and checks

The server receives `GEMINI_API_KEY` through its secret configuration; the API key is sent in the `x-goog-api-key` header. It is never embedded in a request URL, browser code, proof manifest, or log. `MODEL_ID` selects a supported Flash-Lite model; the adapter accepts the documented 2.5, 3.1, and 3.5 variants and rejects other models. The 2.5 alias returned HTTP 404 in the first live probe despite appearing in model discovery. Configuration must therefore be checked with a real generation call.

Run the deterministic regression tests:

```sh
npm run test -- tests/agent
```

The model discovery tool lists available Flash-Lite aliases without generating content. The private local probe reads `~/.config/agent-refund-court/model.json` and makes exactly one live seller call and one live buyer call. It reports token usage and elapsed time, omits generated text and credentials, and fails if the buyer disputes the generated plan:

```sh
node --use-env-proxy --import tsx tools/discover-model.ts
node --use-env-proxy --import tsx tools/check-model.ts --model gemini-3.1-flash-lite
```

The probe uses the provider API and may consume credits. Unit tests use explicit test doubles and do not call Google.

## Verified provider references

- [Thinking budgets, including Flash-Lite and disabling thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Flash-Lite structured JSON output via REST](https://ai.google.dev/gemini-api/docs/migrate-to-interactions)
- [GenerateContent response and finish reasons](https://ai.google.dev/api/generate-content)

These references establish the request format. Live model availability, credentials, latency, and token counts are proven by the probe, not by documentation alone.

## Live probe receipt

On November 19, 2026, the 3.1 Flash-Lite probe passed with a buyer acceptance of the seller's generated plan. Seller latency was 6,741 ms with 286 output tokens; buyer latency was 3,256 ms with 97 output tokens. Combined provider-reported usage was 1,182 tokens, including inputs. No thoughts-token count was reported. These are one probe's measurements, not a latency or cost guarantee. The configured output caps remain 512/384/128.
