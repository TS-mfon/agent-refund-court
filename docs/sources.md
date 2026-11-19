# Sources and version pins

Reviewed November 19, 2026. Primary documentation establishes protocol and SDK behavior; the repository's tests and recorded receipts establish what this implementation actually exercised.

## Documentation structure research

The [official Uniswap v4 Core README](https://github.com/Uniswap/v4-core/blob/main/README.md) explains its mechanism, architecture, interfaces and local integration path. Its reviewed README blob was `e21626c822d574f8613db3551a8b1ca6339ae863`.

The [maintained Aave V3 Origin README](https://github.com/aave-dao/aave-v3-origin/blob/main/README.md) links version-specific technical material and distinguishes security evidence from integration guidance. Its reviewed README blob was `c792e4c5f5e343de1e778a6cd34c6a50cc13247f`. The older `aave/aave-v3-core` repository explicitly redirects to Origin.

Those repositories informed this documentation's mechanism, role, integration and evidence structure. No claim of equivalent security, scale or endorsement follows from that design reference.

## Internet Court

- [Official skill repository and consortium](https://github.com/internet-court/internet-court-skill#the-consortium).
- [GenLayer review adapter](https://github.com/internet-court/internet-court-skill/blob/main/integrations/genlayer-intelligent-contracts/SKILL.md).
- [Vendored source and license record](../skills/agent-refund-court/upstream/internet-court/SOURCE.md).
- [Concrete local integration mapping](../skills/agent-refund-court/references/internet-court-adapter.md).

The unmodified local snapshot is pinned to commit `462bf30efaea73c8af4ed9d6e9970d4495224ad2` and retains its MIT license. It supplies adapter instructions, not a deployed external ruling service.

## x402 and USDC

- [Supported networks and tokens](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/network-and-token-support.mdx).
- [Scheme/payment-flow overview](https://github.com/x402-foundation/x402/blob/main/docs/schemes/overview.mdx).
- [Official upfront server example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/servers/upfront/README.md).
- [Official custom client example](https://github.com/x402-foundation/x402/blob/main/examples/typescript/clients/custom/README.md).
- [EIP-3009 exact client source](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/src/exact/client/eip3009.ts).
- [ERC-3009 specification](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-3009.md).
- [Circle authorization implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol).

The implemented payment path requires V2 exact/upfront EIP-3009 on Base Sepolia. Token authorization state includes cancellation; actual matching authorization/transfer events are required to prove money moved.

## GenLayer

- [Equivalence principle](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle).
- [Prompt crafting](https://docs.genlayer.com/developers/intelligent-contracts/crafting-prompts).
- [Writing data and receipt waits](https://docs.genlayer.com/developers/decentralized-applications/writing-data).
- [Transaction statuses](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions/transaction-statuses).
- [genlayer-js reference](https://docs.genlayer.com/references/genlayer-js).

The contract pins runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`. The [deployment manifest](deployment.json) records actual source/deployment binding. The [live proof](live-proof.md) records a substantive final ruling, separate from the deployment transaction.

## MCP and agent clients

- [Official TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk).
- [Local STDIO transport](https://modelcontextprotocol.io/specification/latest/basic/transports#stdio).
- [Official Codex MCP configuration](https://developers.openai.com/codex/mcp).
- [Official Codex skills](https://developers.openai.com/codex/skills).
- [Codex MCP configuration source](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs).

Context7 verified local command/args/env STDIO configuration against official SDK and Codex source. The repository supplies its own local wrapper; no npm publication or hosted MCP endpoint is assumed.

## Vercel and GitHub

- [Vercel Storage SDK](https://github.com/vercel/storage).
- [Blob conditional writes](https://github.com/vercel/storage/blob/main/packages/blob/src/put-helpers.ts).
- [Private fresh Blob reads](https://github.com/vercel/storage/blob/main/packages/blob/src/get.ts).
- [GitHub scheduled-workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- [Schedule policy source](https://github.com/github/docs/blob/main/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md).
- [GitHub schedule-delay source](https://github.com/github/docs/blob/main/data/reusables/actions/schedule-delay.md).

The reviewed schedule reference blob was `36c7ec49393c0b592722c02948d6a5910979c1a0`. Public schedules are disabled after 60 days of repository inactivity; high-load runs may be delayed or dropped. A schedule is not a durable queue.

## Version authority

`package.json` and `package-lock.json` are the dependency/version authority. The existing integration pins x402 packages 2.31.0, genlayer-js 1.1.8, viem 2.58.0 and @vercel/blob 2.9.0. Check the current lockfile for the MCP SDK and the complete runtime/toolchain pins.

A compatible SDK release, test coverage or an upstream guide cannot substitute for a real configured-deployment check. Provider availability, finality and operational limits remain deployment-specific.

[Verified live evidence](live-proof.md) · [Models](models.md) · [Partner guide](partner-guide.md)
