import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRefundEligibility } from '../../src/refunds/eligibility.js';
import type { RefundContext } from '../../src/refunds/types.js';
import { context, policy, h, payer } from './fixtures.js';
test('a matching finalized ruling refunds only the verified principal to its original payer', () => {
  const result = checkRefundEligibility(context, policy);
  assert.equal(result.eligible, true);
  if (!result.eligible) return;
  assert.equal(result.to, payer); assert.equal(result.value, '10000'); assert.equal(result.reason, 'quality');
});
test('provisional, unresolved, and malformed court results never authorize payment', () => {
  for (const status of ['accepted','pending','undetermined','failed'] as const) {
    assert.equal(checkRefundEligibility({ ...context, court: { ...context.court, status } }, policy).eligible, false);
  }
  const malformed = { ...context, court: { ...context.court, result: { ...context.court.result, materialFailure: false } } };
  assert.equal(checkRefundEligibility(malformed, policy).eligible, false);
});
test('wrong court, payment identity, or sealed evidence bindings never authorize payment', () => {
  const variants: RefundContext[] = [
    { ...context, reservationPaymentId: h(99) },
    { ...context, payment: { ...context.payment, payer: '0x4444444444444444444444444444444444444444' } },
    { ...context, payment: { ...context.payment, verified: false } },
    { ...context, payment: { ...context.payment, seller: '0x4444444444444444444444444444444444444444' } },
    { ...context, court: { ...context.court, caseId: h(99) } },
    { ...context, court: { ...context.court, evidenceHash: h(99) } },
    { ...context, court: { ...context.court, contractAddress: '0x4444444444444444444444444444444444444444' } },
    { ...context, court: { ...context.court, network: 'studionet' as const } },
    { ...context, rulingBinding: { ...context.rulingBinding, agreementHash: h(99) } },
    { ...context, rulingBinding: { ...context.rulingBinding, deliveryHash: h(99) } },
    { ...context, rulingBinding: { ...context.rulingBinding, transactionHash: h(99) } },
  ];
  for (const variant of variants) assert.equal(checkRefundEligibility(variant, policy).eligible, false);
  assert.equal(checkRefundEligibility({ ...context, payment: { ...context.payment, chainId: 1 } } as never, policy).eligible, false);
  assert.equal(checkRefundEligibility({ ...context, payment: { ...context.payment, token: '0x' + '44'.repeat(20) } } as never, policy).eligible, false);
});
test('trusted non-delivery approval has the same financial nonce and requires its terminal fence', () => {
  const operational = { ...context, deliveryHash: null, court: null, rulingBinding: null,
    operationalApproval: { status: 'OPERATIONAL_REFUND_APPROVED' as const, paymentId: context.paymentId,
      deadlineSeconds: 100, approvedAtSeconds: 100, generationFenceInvalidated: true, noCommittedDelivery: true } };
  const a = checkRefundEligibility(context, policy), b = checkRefundEligibility(operational, policy);
  assert.equal(b.eligible, true);
  if (a.eligible && b.eligible) { assert.equal(b.nonce, a.nonce); assert.equal(b.reason, 'non_delivery'); }
  for (const change of [{generationFenceInvalidated:false},{noCommittedDelivery:false},{approvedAtSeconds:99},{paymentId:h(99)}]) {
    assert.equal(checkRefundEligibility({ ...operational, operationalApproval: { ...operational.operationalApproval, ...change } }, policy).eligible, false);
  }
  assert.equal(checkRefundEligibility({ ...operational, deliveryHash: context.deliveryHash }, policy).eligible, false);
});
