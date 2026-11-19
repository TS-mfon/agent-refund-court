import { createAgreement } from '../../src/domain/factory.js';
import type { CaseManifest } from '../../src/domain/schema.js';

export const hash = (digit = '1') => ('0x' + digit.repeat(64)) as `0x${string}`;
export function sampleCase(overrides: Partial<CaseManifest> = {}): CaseManifest {
  const agreement = createAgreement({ brief: 'TraceLite is a local HTTP log timeline. Give three practical launch actions and a feedback method within five hours and no advertising budget.', origin: 'http://localhost:3001', buyer: '0x1111111111111111111111111111111111111111', seller: '0x2222222222222222222222222222222222222222', receiptSigner: '0x3333333333333333333333333333333333333333', now: 1795000000 });
  return {
    schemaVersion: 1, id: agreement.orderId, mode: 'simulation', createdAt: '2026-11-18T12:00:00.000Z', updatedAt: '2026-11-18T12:00:00.000Z',
    status: 'simulation', agreement, delivery: null, buyerClaim: null, sellerDefense: null, payment: null, court: null, refund: null, evidenceHash: null, events: [],
    provenance: { source: 'simulation', fixtureLabel: null, disclosure: 'Simulation; no payment, court submission, or refund occurred.' }, ...overrides,
  };
}
export function paidCase(): CaseManifest {
  const c = sampleCase();
  return { ...c, mode: 'fixture', status: 'delivered', provenance: { source: 'live', fixtureLabel: 'Deliberately poor demo delivery', disclosure: 'Real testnet payment; deliberately poor demo delivery.' },
    payment: { chainId: 84532, network: 'eip155:84532', token: c.agreement.token, payer: c.agreement.buyer, seller: c.agreement.seller, amount: c.agreement.amount, authorizationNonce: hash('2'), transactionHash: hash('3'), blockNumber: '123', blockHash: hash('4'), verified: true },
    delivery: { text: '<script>alert("evidence")</script> Promote it online.', hash: hash('5'), committedAt: 1795000001 } };
}
export function refundedCase(): CaseManifest {
  const c = paidCase();
  return { ...c, status: 'refunded', evidenceHash: hash('6'),
    court: { network: 'studionet', contractAddress: '0x4444444444444444444444444444444444444444', caseId: c.id, evidenceHash: hash('6'), transactionHash: hash('7'), status: 'finalized', verified: true, result: { decision: 'REFUND', materialFailure: true, reasoning: 'The delivery does not materially use the brief.', failedCriteria: ['relevance'] } },
    refund: { reason: 'quality', status: 'confirmed', authorizer: c.agreement.seller, payer: c.agreement.buyer, token: c.agreement.token, amount: c.agreement.amount, authorizationNonce: hash('8'), transactionHash: hash('9'), blockNumber: '124', blockHash: hash('a'), verified: true } };
}
