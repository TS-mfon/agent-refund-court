# Models and budgets

The external MCP buyer uses its existing agent model to review the original answer. Seller generation, optional bundled demo-buyer evaluation and GenLayer court inference are separate roles.

## Role limits

| Role | Model/source | Maximum output tokens |
| --- | --- | ---: |
| Seller answer | Direct Google REST; default `gemini-3.1-flash-lite` | 512 |
| Seller defense | Same configured seller provider | 128 |
| Optional bundled buyer CLI | Direct Google REST buyer configuration | 384 |
| External MCP buyer | Calling agent's existing model | Controlled by that agent |
| GenLayer court | Network validators' independent inference | Network/contract execution policy |

A usual disputed bundled-demo workflow caps seller, buyer and defense output at 1,024 combined tokens. Inputs are additional. The external MCP path removes the separate bundled-buyer provider call.

Text bounds still apply: brief 1,200 UTF-8 bytes, delivery 3,000 bytes, buyer reason 1,200 bytes, defense 1,200 bytes, and complete court envelope 16 KiB. MCP tool results are bounded to 3,000 bytes and original text is paginated.

## Provider behavior

Every Google request asks for one candidate. The adapter uses `thinkingBudget:0` for the supported 2.5 Flash-Lite family and `thinkingLevel:minimal` for supported 3.1/3.5 Flash-Lite models. Minimal reasoning does not guarantee that thinking is disabled.

The timeout defaults to 20 seconds and the prompt is capped at 8 KiB. The adapter does not automatically retry a provider call. Blocked, truncated, incomplete, malformed or timed-out output produces a visible error rather than an invented answer.

The bundled buyer uses native structured output plus application validation. It can identify an accept/dispute decision and criterion failures; it cannot choose a refund recipient, token, amount, chain or execution instruction.

## Credentials

The seller receives `GEMINI_API_KEY` through server secrets. The API key is sent in the `x-goog-api-key` header and is omitted from URLs, browser code, public evidence and logs.

`MODEL_ID` selects the supported Flash-Lite model. Discovery alone does not prove that a listed alias is available to your account or supports the actual request. Verify overrides with a real bounded generation call before enabling them.

The external buyer requires only its agent, local wallet, mandate and MCP connection. The provider credential belongs to the seller. The optional demo CLI has its own buyer-model requirements.

## Verified probe

On November 19, 2026, a 3.1 Flash-Lite probe produced an answer that the bundled buyer accepted. Seller latency was 6,741 ms with 286 output tokens; buyer latency was 3,256 ms with 97 output tokens. Combined provider-reported usage was 1,182 tokens including inputs. No thoughts-token count was reported.

These measurements describe one probe. They do not establish latency, cost or model-availability guarantees.

## Checks

```sh
npm run test -- tests/agent
node --use-env-proxy --import tsx tools/discover-model.ts
node --use-env-proxy --import tsx tools/check-model.ts --model gemini-3.1-flash-lite
```

Regression tests use doubles. Discovery does not generate content; the private probe makes one live seller call and one buyer call, reads the configured private model credential and may consume provider credits.

[Google thinking guide](https://ai.google.dev/gemini-api/docs/generate-content/thinking) · [GenerateContent response reference](https://ai.google.dev/api/generate-content) · [MCP buyer](mcp.md) · [Hosting](hosting.md)
