import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, http } from 'viem';
import { AgreementSchema, SignatureSchema, CaseManifestSchema, HashSchema, SealedEvidenceSchema } from '../src/domain/schema.js';
import { hashContent, verifyRecord } from '../src/domain/identity.js';
import { PaymentContextSchema, validateCheckout, BaseUSDCProofVerifier } from '../src/payments/index.js';
import { sealCourtEvidence } from '../src/court/evidence.js';
import { createCourtClient } from '../src/court/client.js';
import { checkRefundEligibility } from '../src/refunds/eligibility.js';
import { verifyRefundLogProof } from '../src/refunds/reconcile.js';
import { createViemRefundChain } from '../src/workflow/refund-chain.js';
import { LocalStateStore } from '../src/workflow/local-store.js';
import { apiJSON, cliArguments, demoOrigin } from '../src/workflow/http.js';
async function main() {
  const args = cliArguments(process.argv.slice(2)), origin = demoOrigin(args.origin ?? process.env.SERVICE_ORIGIN ?? '');
  const token = process.env.DEMO_ACCESS_TOKEN; if (!token) throw new Error('DEMO_ACCESS_TOKEN_REQUIRED');
  const id = HashSchema.parse(args.case);
  const c = (await apiJSON(origin, token, '/api/v1/cases/' + id, z.object({ case: CaseManifestSchema }))).case;
  if (c.mode === 'simulation' || !c.payment?.verified || !c.delivery) throw new Error('NO_REAL_PURCHASE_PROOF');
  const local = new LocalStateStore(join(homedir(), '.config', 'agent-refund-court', 'buyer-state'));
  const saved = await local.get<{ context: unknown }>('buyer/orders/' + c.agreement.orderId + '.json');
  if (!saved) throw new Error('ORIGINAL_BUYER_CHECKOUT_REQUIRED');
  const context = PaymentContextSchema.parse(saved.value.context);
  await validateCheckout(context, { seller: c.agreement.seller, origin, amount: c.agreement.amount }, { allowExpired: true });
  if (hashContent(context.agreement) !== hashContent(c.agreement) || c.delivery.hash !== hashContent(c.delivery.text)) throw new Error('ORIGINAL_CONTENT_MISMATCH');
  const client = createPublicClient({ cacheTime: 0, transport: http(process.env.BASE_RPC_URL ?? 'https://sepolia.base.org', { timeout: 10000, retryCount: 0 }) });
  const observed = await new BaseUSDCProofVerifier({ client }).prove(context, c.payment.transactionHash);
  if (!observed.authorizationUsed || !observed.proof || hashContent(observed.proof) !== hashContent(c.payment)) throw new Error('PAYMENT_CHAIN_PROOF_FAILED');
  const order = (await apiJSON(origin, token, '/api/v1/orders/' + c.agreement.orderId, z.object({
    order: z.object({ agreement: AgreementSchema, deliverySignature: SignatureSchema }),
  }))).order;
  if (!await verifyRecord('delivery', hashContent({ caseId: id, agreementHash: hashContent(c.agreement), delivery: c.delivery }),
    order.deliverySignature, c.agreement.receiptSigner)) throw new Error('DELIVERY_SIGNATURE_FAILED');
  let courtVerified = false, refundVerified = false;
  if (c.court?.transactionHash) {
    const sealed = sealCourtEvidence((await apiJSON(origin, token, '/api/v1/cases/' + id + '/evidence',
      z.object({ evidence: SealedEvidenceSchema }))).evidence);
    if (sealed.evidenceHash !== c.evidenceHash || hashContent(sealed.evidence.agreement) !== hashContent(c.agreement) ||
      hashContent(sealed.evidence.delivery) !== hashContent(c.delivery) || hashContent(sealed.evidence.buyerClaim) !== hashContent(c.buyerClaim))
      throw new Error('COURT_EVIDENCE_BINDING_FAILED');
    const court = await createCourtClient({ contractAddress: c.court.contractAddress, endpoint: process.env.GENLAYER_RPC_URL })
      .reconcile({ caseId: id, evidenceHash: sealed.evidenceHash, transactionHash: c.court.transactionHash });
    if (hashContent(court) !== hashContent(c.court)) throw new Error('COURT_ORIGIN_PROOF_FAILED');
    courtVerified = court.verified && court.status === 'finalized';
    if (c.refund?.transactionHash) {
      const policy = { authorizer: c.payment.seller, courtNetwork: c.court.network, courtContractAddress: c.court.contractAddress,
        confirmations: 2, authorizationLifetimeSeconds: 300, minimumGasBalanceWei: '1000000000000', usdcDomain: { name: 'USDC', version: '2' } };
      const eligibility = checkRefundEligibility({ paymentId: id, reservationPaymentId: id, payment: observed.proof,
        agreementHash: sealed.evidence.agreementHash, deliveryHash: c.delivery.hash, evidenceHash: sealed.evidenceHash, court,
        rulingBinding: { finalized: courtVerified, paymentId: id, caseId: id, agreementHash: sealed.evidence.agreementHash,
          deliveryHash: c.delivery.hash, evidenceHash: sealed.evidenceHash, transactionHash: c.court.transactionHash },
        operationalApproval: null, alreadyConfirmedRefund: null }, policy);
      if (!eligibility.eligible) throw new Error('REFUND_POLICY_PROOF_FAILED');
      const chain = createViemRefundChain({ rpcUrl: process.env.BASE_RPC_URL, fromBlock: BigInt(c.payment.blockNumber) });
      const observation = await chain.observation(), receipt = await chain.receipt(c.refund.transactionHash);
      if (!receipt) throw new Error('REFUND_RECEIPT_UNAVAILABLE');
      const proof = verifyRefundLogProof({ eligibility, receipt, chainId: observation.chainId, headBlockNumber: observation.headBlockNumber,
        observedBlock: await chain.block(receipt.blockNumber), confirmations: 2 });
      const consumed = await chain.authorizationState(eligibility.from, eligibility.nonce, observation.headBlockNumber);
      if (!consumed || !proof || hashContent(proof) !== hashContent(c.refund)) throw new Error('REFUND_CHAIN_PROOF_FAILED');
      refundVerified = true;
    }
  }
  const verified = c.status === 'accepted' || c.status === 'refunded' && courtVerified && refundVerified ||
    c.status === 'court_finalized' && courtVerified && c.court?.result?.decision === 'NO_REFUND';
  console.log(JSON.stringify({ caseId: id, status: c.status, mode: c.mode, paymentVerified: true, deliveryVerified: true,
    courtVerified, refundVerified, verified, payment: c.payment.transactionHash, court: c.court?.transactionHash ?? null,
    refund: c.refund?.transactionHash ?? null, viewer: origin + '/?case=' + id }));
  if (!verified) process.exitCode = 1;
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROOF_VERIFICATION_FAILED';
  console.error(JSON.stringify({ error: code, verified: false })); process.exitCode = 1;
});
