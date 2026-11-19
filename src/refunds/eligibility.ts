import { z } from 'zod';
import { AddressSchema, HashSchema, PaymentProofSchema, CourtProofSchema, RefundProofSchema } from '../domain/schema.js';
import { hashContent, paymentIdentity, refundIdentity } from '../domain/identity.js';
import type { RefundContext, RefundEligibility, RefundPolicy } from './types.js';

const ContextSchema = z.object({
  paymentId: HashSchema, reservationPaymentId: HashSchema, payment: PaymentProofSchema,
  agreementHash: HashSchema, deliveryHash: HashSchema.nullable(), evidenceHash: HashSchema.nullable(),
  court: CourtProofSchema.nullable(),
  rulingBinding: z.object({ finalized: z.boolean(), paymentId: HashSchema, caseId: HashSchema,
    agreementHash: HashSchema, deliveryHash: HashSchema, evidenceHash: HashSchema, transactionHash: HashSchema }).strict().nullable(),
  operationalApproval: z.object({ status: z.literal('OPERATIONAL_REFUND_APPROVED'), paymentId: HashSchema,
    approvedAtSeconds: z.number().int().nonnegative(), deadlineSeconds: z.number().int().nonnegative(),
    generationFenceInvalidated: z.boolean(), noCommittedDelivery: z.boolean() }).strict().nullable(),
  alreadyConfirmedRefund: RefundProofSchema.nullable(),
}).strict();
export function validateRefundPolicy(policy: RefundPolicy): void {
  AddressSchema.parse(policy.authorizer); AddressSchema.parse(policy.courtContractAddress);
  if (!['studionet', 'testnet-bradbury'].includes(policy.courtNetwork)
    || !Number.isSafeInteger(policy.confirmations) || policy.confirmations < 1
    || !Number.isSafeInteger(policy.authorizationLifetimeSeconds) || policy.authorizationLifetimeSeconds < 30 || policy.authorizationLifetimeSeconds > 3600
    || !/^(0|[1-9][0-9]*)$/.test(policy.minimumGasBalanceWei)
    || !policy.usdcDomain.name || !policy.usdcDomain.version) throw new Error('Invalid refund policy');
}
const eq = (a: string | null, b: string | null) => a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
export function checkRefundEligibility(input: RefundContext, policy: RefundPolicy): RefundEligibility {
  validateRefundPolicy(policy);
  const parsed = ContextSchema.safeParse(input);
  if (!parsed.success) return { eligible: false, code: 'MALFORMED_CONTEXT' };
  const c = parsed.data, p = c.payment;
  const no = (code: string): RefundEligibility => ({ eligible: false, code });
  if (!p.verified) return no('UNVERIFIED_PAYMENT');
  if (!eq(c.paymentId, c.reservationPaymentId) || !eq(c.paymentId, paymentIdentity({ chainId: p.chainId, token: p.token, payer: p.payer, nonce: p.authorizationNonce }))) return no('PAYMENT_ID_MISMATCH');
  if (!eq(p.seller, policy.authorizer)) return no('AUTHORIZER_MISMATCH');
  if (c.alreadyConfirmedRefund?.verified && c.alreadyConfirmedRefund.status === 'confirmed') return no('ALREADY_CONFIRMED');
  let reason: 'quality' | 'non_delivery';
  if (c.operationalApproval) {
    const a = c.operationalApproval;
    if (!eq(a.paymentId, c.paymentId) || !a.noCommittedDelivery || c.deliveryHash !== null
      || !a.generationFenceInvalidated || a.approvedAtSeconds < a.deadlineSeconds) return no('INVALID_NON_DELIVERY_APPROVAL');
    reason = 'non_delivery';
  } else {
    const court = c.court, b = c.rulingBinding;
    if (!court?.verified || court.status !== 'finalized' || !b?.finalized || !court.transactionHash) return no('WAITING_FINALITY');
    if (court.result?.decision !== 'REFUND') return no('NO_REFUND_RULING');
    if (court.network !== policy.courtNetwork || !eq(court.contractAddress, policy.courtContractAddress)) return no('COURT_CONTEXT_MISMATCH');
    if (!eq(court.caseId, c.paymentId) || !eq(b.caseId, c.paymentId) || !eq(b.paymentId, c.paymentId)
      || !eq(court.evidenceHash, c.evidenceHash) || !eq(b.evidenceHash, c.evidenceHash)
      || !eq(b.agreementHash, c.agreementHash) || !eq(b.deliveryHash, c.deliveryHash)
      || !eq(b.transactionHash, court.transactionHash)) return no('EVIDENCE_MISMATCH');
    reason = 'quality';
  }
  return { eligible: true, reason, paymentId: c.paymentId, from: p.seller, to: p.payer,
    value: p.amount, nonce: refundIdentity(c.paymentId, p.seller), payment: p,
    bindingHash: hashContent({ paymentId: c.paymentId.toLowerCase(), agreementHash: c.agreementHash.toLowerCase(),
      transactionHash: p.transactionHash.toLowerCase(), token: p.token.toLowerCase(),
      from: p.seller.toLowerCase(), to: p.payer.toLowerCase(), value: p.amount }) };
}
