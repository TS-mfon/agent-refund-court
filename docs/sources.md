# Verified integration sources

Reviewed November 18, 2026. These are primary-source references for the blueprint. Source availability does not replace deployed acceptance tests.

## Internet Court
- [Official consortium and skill repository](https://github.com/internet-court/internet-court-skill#the-consortium): x402 is a listed member; IC is a skills/connector integration surface.
- [GenLayer review adapter](https://github.com/internet-court/internet-court-skill/blob/main/integrations/genlayer-intelligent-contracts/SKILL.md): mandate, rubric, evidence, decision, concrete consequence path.
- [Public MCP source](https://github.com/internet-court/mcp/blob/main/app/%5Btransport%5D/route.ts): the consultation agent placeholder must not be mistaken for a deployed case/ruling service.
- [Vendored official GenLayer contract skill](https://github.com/internet-court/internet-court-skill/blob/main/vendored/genlayer/write-contract/SKILL.md): runner pinning, supported storage, independent validator comparison.

## x402
- [Networks and assets](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/network-and-token-support.mdx): Base Sepolia, USDC, development facilitator.
- [Payment flow overview](https://github.com/x402-foundation/x402/blob/main/docs/schemes/overview.mdx): default authorization versus upfront flow.
- [Official upfront server example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/upfront/README.md).
- [Official custom client example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/clients/custom/README.md).
- [EIP-3009 client implementation](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/exact/client/eip3009.ts): signed fields do not include HTTP order/agreement/delivery.
- [Lifecycle hooks](https://github.com/x402-foundation/x402/blob/main/docs/advanced-concepts/lifecycle-hooks.mdx).
- [Actual resource server behavior](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/server/x402ResourceServer.ts): hook errors and fail-closed behavior require careful persistence.
- [Offer/receipt extension specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md): does not replace the demo's delivery binding.

## Token and refund
- [ERC-3009 specification](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-3009.md): authorization-based transfers and replay guard.
- [Circle implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol): authorizationState includes cancellation; require actual AuthorizationUsed plus matching Transfer.

## GenLayer
- [Equivalence principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle): custom leader/validator logic and error handling.
- [Prompt crafting](https://docs.genlayer.com/developers/intelligent-contracts/crafting-prompts): independent evaluation and substantive-field comparison.
- [Writing data](https://docs.genlayer.com/developers/decentralized-applications/writing-data): ACCEPTED versus FINALIZED receipt waits.
- [Transaction statuses](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions/transaction-statuses): provisional/terminal states.
- [genlayer-js reference](https://docs.genlayer.com/references/genlayer-js).

## Vercel and GitHub
- [Vercel Storage SDK](https://github.com/vercel/storage).
- [Blob conditional writes](https://github.com/vercel/storage/blob/main/packages/blob/src/put-helpers.ts): create-only and ifMatch semantics.
- [Blob private origin reads](https://github.com/vercel/storage/blob/main/packages/blob/src/get.ts): useCache:false.
- [GitHub Actions concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): concurrency is not a durable job queue.
- [Vercel deployment API SDK docs](https://github.com/vercel/sdk/blob/main/docs/sdks/deployments/README.md).

## Explicitly unproven until live spikes
- Published dependency releases implement all selected upstream features.
- Deployed Blob concurrency/fresh reads.
- Deployed x402 payment/recovery and USDC refund behavior.
- Actual GenLayer network/runner availability, context bounds, substantive agreement, and finality latency.
- Real seller model access and cost.
- Independent fresh-configuration reproduction.
