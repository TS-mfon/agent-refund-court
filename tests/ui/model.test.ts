import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCase, parseCases, formatMoney, refundConfirmed, statusLabel, safeExternalUrl, proofLinks } from '../../web/model.js';
import { sampleCase, paidCase, refundedCase, hash } from './sample.js';

test('empty published case response stays empty', () => assert.deepEqual(parseCases({ cases: [] }), []));
test('invalid public manifest cannot be displayed as a refund', () => {
  assert.throws(() => parseCase({ case: { ...sampleCase(), status: 'refunded' } }), /validation/i);
  assert.throws(() => parseCases({ cases: [sampleCase(), { id: 'bad' }] }), /validation/i);
});
test('exact six-decimal money avoids floating point and preserves large amounts', () => {
  assert.equal(formatMoney('10000'), '0.01');
  assert.equal(formatMoney('1000001'), '1.000001');
  assert.equal(formatMoney('9007199254740993000000'), '9007199254740993');
});
test('confirmed refund requires matching payment and finalized quality ruling', () => {
  const c = refundedCase();
  assert.equal(refundConfirmed(c), true);
  assert.equal(refundConfirmed({ ...c, refund: { ...c.refund!, amount: '20000' } }), false);
  assert.equal(refundConfirmed({ ...c, court: { ...c.court!, status: 'accepted' } }), false);
  assert.throws(() => parseCase({ case: { ...c, refund: { ...c.refund, payer: '0x5555555555555555555555555555555555555555' } } }), /validation/i);
});
test('an award and provisional ruling never imply transfer confirmation', () => {
  const c = refundedCase();
  const pending = { ...c, status: 'refund_pending' as const, refund: { ...c.refund!, status: 'pending' as const, verified: false, transactionHash: null, blockNumber: null, blockHash: null } };
  assert.equal(refundConfirmed(pending), false);
  assert.equal(statusLabel(pending), 'Refund awaiting confirmation');
  assert.equal(statusLabel({ ...c, status: 'court_provisional', court: { ...c.court!, status: 'accepted' } }), 'Provisional ruling');
});
test('proof URLs are constructed from actual validated receipt hashes', () => {
  const links = proofLinks(refundedCase());
  assert.equal(links.payment, 'https://sepolia.basescan.org/tx/' + hash('3'));
  assert.equal(links.refund, 'https://sepolia.basescan.org/tx/' + hash('9'));
  assert.match(links.contract ?? '', /^https:\/\/explorer-studio.genlayer.com\/address\/0x/);
  assert.equal(proofLinks(sampleCase()).payment, null);
});
test('untrusted external URLs cannot use executable or credential-bearing schemes', () => {
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('https://user:pass@example.com'), null);
  assert.equal(safeExternalUrl('https://github.com/TS-mfon/agent-refund-court'), 'https://github.com/TS-mfon/agent-refund-court');
});
test('live and confirmed cases lead simulations without changing input', () => {
  const simulation = sampleCase({ id: hash('b') });
  const paid = paidCase();
  const source = [simulation, paid];
  const sorted = parseCases({ cases: source });
  assert.equal(sorted[0].id, paid.id);
  assert.equal(source[0], simulation);
});
