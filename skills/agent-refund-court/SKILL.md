---
name: agent-refund-court
description: Run the Agent Refund Court demo, resume an interrupted purchase, or inspect the receipts for an x402 quality dispute judged by GenLayer.
disable-model-invocation: true
license: MIT
compatibility: "Node.js 24+, npm, Git; Base Sepolia test USDC; authorized demo token; Gemini API access"
metadata:
  source: TS-mfon/agent-refund-court
  date_added: "2026-11-19"
  effort: medium
---

# Agent Refund Court

Buy one short launch plan through x402, have the buyer agent assess the original answer, and send a material quality dispute to the demo's GenLayer QualityCourt. A seller-operated worker consumes a finalized refund ruling and returns the original USDC principal.

Internet Court's official review adapter supplies the mandate, rubric, evidence, decision, and consequence framework. This repository implements that framework as a demo contract and workflow. The integration uses no hosted Internet Court ruling API. See [the implementation mapping](references/internet-court-adapter.md) before describing the integration to a reviewer.

## When to use

- Run a user-authorized, bounded testnet purchase.
- Resume a pending order using its original local checkout.
- Inspect payment, court, and refund evidence in the case viewer.

## When NOT to use

For generic GenLayer contract development, use **write-contract** or **genlayer-cli**. For production commerce, escrow, permission revocation, or reputation updates, use the corresponding Internet Court upstream connector after loading its actual source. This demo implements one quality-refund flow.

## Workflow

Keep this checklist:

- [ ] Discovered the service and established the authorized purchase
- [ ] Confirmed local buyer credentials and testnet funding
- [ ] Ran one purchase or resumed the original order
- [ ] Inspected the original answer and case evidence
- [ ] Verified the outcome and reported any pending stage

1. **Discover and establish the mandate.** Read `/api/v1/service` at the requested origin. Confirm the seller, USDC price, Base Sepolia network, court address, and enabled purchase capability. The default demo costs 0.01 test USDC. Use the user's existing authorization when it covers this purchase; otherwise obtain a mandate before signing. Completion: one known service, one approved scenario, and one bounded purchase.

   Read [Internet Court's GenLayer adapter](upstream/internet-court/integrations/genlayer-intelligent-contracts/SKILL.md) and [the local mapping](references/internet-court-adapter.md). Apply its sequence: mandate, fixed rubric, original evidence, independent decision, concrete consequence.

2. **Prepare the local buyer.** Follow [reproduction](../../docs/reproduction.md). Execute `node --import tsx tools/setup-demo.ts` only when the private wallet file is absent. The buyer signs locally from `~/.config/agent-refund-court/wallets.json`; the web interface contains no funded buyer key. Fund that buyer with Base Sepolia USDC. Load `DEMO_ACCESS_TOKEN` and `GEMINI_API_KEY` from private configuration. Use a live-verified Flash-Lite `MODEL_ID`; see [model configuration](../../docs/models.md).

   Completion: the intended buyer identity and sufficient test USDC exist, and secrets remain outside the repository and command arguments.

3. **Run one scenario.** From the repository root, execute one of these commands:

   ```sh
   npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad
   npm run demo -- --origin https://agent-refund-court.vercel.app --scenario good
   npm run demo -- --origin https://agent-refund-court.vercel.app --scenario live
   ```

   Choose one command, not all three by default. `bad` and `good` explicitly select delivery fixtures; payment, buyer evaluation, court adjudication when disputed, and any refund use the real integration. `live` also generates the seller's answer through the configured model. TraceLite is fictional in every scenario.

   The CLI prints `orderId` before payment and `caseId` after delivery. Save them. If an operation times out, return to this step by resuming the original order:

   ```sh
   npm run demo -- --origin https://agent-refund-court.vercel.app --scenario bad --resume 0xYOUR_ORIGINAL_ORDER_ID
   ```

   Replace the placeholder with the printed 32-byte hexadecimal order identifier. Preserve the same wallet and local buyer-state files. Completion: an accepted answer, or a persisted dispute with an original payment identity. A timeout leaves the step pending.

4. **Inspect the frozen evidence.** Open the CLI's viewer URL. Read the accepted brief and rubric, original delivery, buyer claim, seller defense, and receipt hashes. `/api/v1/cases/<caseId>/evidence` publishes the sealed dispute bundle. The buyer decides whether to dispute; the scenario name cannot select the court verdict.

   Completion: evidence identities match the case and the page identifies fixture, live, or recorded provenance.

5. **Verify and report the outcome.** An accepted good answer ends without a court case or refund. A disputed case may need several polls. To progress an existing case without initiating a new purchase:

   ```sh
   npm run worker -- --origin https://agent-refund-court.vercel.app --case 0xYOUR_CASE_ID --steps 120
   ```

   Replace the placeholder with the printed case identifier. This command uses the authorized server's registrar and seller worker. It does not give the client a way to choose a ruling or refund recipient.

   For a quality refund, require all of: a verified original payment; a verified `finalized` court proof with decision `REFUND`; a verified `confirmed` refund receipt for the original payer, token, and amount; and case status `refunded`. Verify the payment/refund explorer links and sealed evidence.

   Report the viewer URL, scenario disclosure, actual status, and available transaction hashes. If the court is provisional, undetermined, failed, or awaiting confirmation, report that state and the original resume identifiers. A zero CLI exit code alone does not prove completion.

## References

- [Reproduction and operator setup](../../docs/reproduction.md): read before first execution or moving to another machine.
- [Trust model](../../docs/trust-model.md): read before making security or enforcement claims.
- [Internet Court mapping](references/internet-court-adapter.md): read before running or presenting the integration.
- [Official Internet Court entry snapshot](upstream/internet-court/SKILL.md): provenance and upstream routing; this snapshot is not the complete upstream package.
- [Upstream source and license](upstream/internet-court/SOURCE.md): read when updating the bundled adapter.

## Rules

- Keep buyer signing local and transaction scope testnet-only.
- Use the same signed checkout after uncertainty; create a new purchase only after resolving the original payment.
- Submit the original agreement, delivery, claim, and defense; preserve their hashes.
- Derive amounts and recipients from verified payment facts, never model output.
- Execute quality refunds only after independently verified GenLayer finality.
- State fixture and recorded provenance wherever those cases are shown.
- Describe enforcement as a cooperating seller worker; claim no escrow, trustless bridge, permission revocation, reputation registry, or official endorsement.
