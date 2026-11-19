# Implementation and acceptance gates

The original scaffold plan has been replaced by the implemented protocol documentation. [Architecture and services](protocol.md), [API](api.md), [evidence](evidence.md), [refunds](refunds.md) and [hosting](hosting.md) define the current boundaries.

This file records what evidence is required to claim a working integration. A completed deployment, an attractive interface or passing doubles alone cannot establish the complete financial flow.

## Acceptance gates

| Gate | Required evidence |
| --- | --- |
| Signed purpose | Buyer and seller verify identical brief, rubric, principal, resource and court |
| Real purchase | Supported x402 authorization plus canonical exact Base Sepolia USDC receipt |
| Original delivery | One committed answer and a valid seller delivery signature |
| Independent buyer review | Buyer evaluates complete original evidence without fixture verdict labels |
| Immutable dispute | Payer-signed material claim, exact excerpts and a sealed original bundle |
| Meaningful court | Independent qualitative GenLayer judgment with substantive validator agreement |
| Finality | Successful final transaction and matching latest final contract state |
| Principal return | Exact original payer/token/amount/nonce verified in canonical confirmed refund receipt |
| Recovery | Same original authorization/job resumes after uncertainty and concurrent work |
| External onboarding | New local buyer owns its wallet, mandate and state, without operator or extra buyer-model credentials |
| Operator deployment | Independent seller controls its registrar-bound court, role keys, reserve and durable state |
| Public proof | Accurate manifests, evidence, transaction links and fixture/recorded disclosures |
| Checks | Relevant unit/integration/E2E/contract checks; 80% enforced TypeScript coverage |
| Documentation | Actual interfaces, complete onboarding, trust boundaries and runnable local examples |

## Existing live evidence

The original launch-plan fixture case has a verified purchase, independent final `REFUND` ruling and exact 0.01 test-USDC return. A separate live-generated answer was purchased and independently accepted. [Receipts and verification limits](live-proof.md)

The expanded custom-brief/public-wallet/MCP surface must be checked against its own enabled deployment and current source. Original-case receipts establish the original case, not every future buyer, task or deployment.

## Current release checkpoint

The two-service QualityCourt deployment is finalized at `0x4eaf1BAc12573BDeA26a0c437D1f2ED4914600Ed`; [the current manifest](deployment.json) records its verified source, registrar and supported services. [The original manifest](deployments/launch-plan-v1.json) preserves the court used by the recorded refund. Existing cases continue to use their signed original court.

The current source contains the custom task agreement/generation/court path, public service catalog, scoped wallet authentication, local MCP buyer and bounded awaited visitor wake. Activity processes at most one existing eligible case under a shared cooldown/lease; GitHub's five-minute schedule is a separate fallback.

Before marking this release complete, record evidence for these remaining gates:

- Publish the reviewed current source and verify its GitHub checks and Vercel deployment, including public catalog, documentation routes and activity metadata.
- Complete a fresh own-wallet/custom-brief purchase through the public skill/MCP against that exact enabled deployment. Preserve its original identifiers, full delivery, review and actual terminal or pending outcome.
- Verify any fresh disputed case against its own final judgment and principal-return receipts; the original proof does not establish this new case.
- Recheck the original proof under its original court binding and verify the existing recorded video's duration, hash, disclosures and public availability.

The checkpoint records implemented boundaries and outstanding release evidence, not an assertion that every gate has passed.

## Required failure checks

Exercise wrong-payer access, replayed sign-in, expired sessions, altered agreement/delivery, fabricated excerpts, unsupported services, oversize Unicode text, conflicting review, uncertain settlement, consumed/canceled nonce contradictions, concurrent generation, missing finality, undetermined consensus, reserve/gas shortfalls and stored-receipt recovery.

Require evidence preservation and visible pending/unresolved states at failure boundaries. A model or backend exception must not choose an economic result.

## Financial invariants

The original payment identity and deterministic refund nonce are stable across restarts and deployments. Refund principal, recipient, token and authorizer are derived from the verified payment. The quality path requires the agreed court's independently verified final award.

The lower-level operational non-delivery approval is separate and does not fabricate a quality judgment. Revised-evidence appeals, arbitrary x402 schemes and forced repayment remain outside this version.

## Release reporting

Record actual checked commit/deployment, enabled services, proof manifests, test results, limitations and the video artifact. Preserve fixture/recorded disclosures and distinguish accepted work from disputed court results.

[Partner acceptance](partner-guide.md) · [Trust model](trust-model.md) · [Submission record](submission.md)
