# Agent Refund Court

A planned, reproducible agent-commerce demo using **Internet Court + GenLayer + x402**.

A buyer agent pays for a short launch plan. If the delivered answer materially fails the agreed brief, Internet Court structures the dispute, GenLayer independently adjudicates it, and the demo seller executes a real testnet refund after finality.

**Current phase: implementation planning and read-only web scaffold.** No completed payment, deployed court, or confirmed refund is claimed by this scaffold.

## Start here

- [Full implementation blueprint: 26 sections](docs/plan.md)
- [Verified integration sources and remaining live checks](docs/sources.md)

Deadline: **November 23, 2026**. Application hosting is limited to GitHub and Vercel, with GitHub Actions for finite privileged work and private Vercel Blob for durable state.

## Fixed demo scope

- Short launch plan for the explicitly fictional developer tool TraceLite.
- Pre-agreed relevance, actionability, and grounding criteria.
- Real x402 exact payment on Base Sepolia.
- Actual agent acceptance/dispute decision.
- Real bounded GenLayer adjudication.
- Separate seller-funded, exact-principal testnet refund.
- Public agent skill and read-only case/proof viewer.
- Polished video under 45 seconds with the three official logos.

## Important trust boundary

GenLayer judges the admitted evidence. A trusted registrar admits payment/delivery facts and a seller-operated worker executes refunds. The demo demonstrates cooperative refunds; it does not guarantee recovery from an unwilling or insolvent seller.

Fixtures will be explicitly labelled. Real payment, court, and refund evidence must pass the blueprint's live gates before the final demo is represented as working.

## Implementation and release

The blueprint specifies components, signatures, IDs, state machines, API routes, Blob concurrency, Actions resumption, token-level refund replay protection, tests, coverage, secrets, UI, daily milestones, reproduction, costs, video, and release gates.

There is no funded execution button on the public scaffold. Do not send mainnet funds or provide private keys through this page.
