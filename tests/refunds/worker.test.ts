import test from 'node:test';
import assert from 'node:assert/strict';
import { runRefundWorker } from '../../src/refunds/worker.js';
import { receiptForRefund, workerFixture } from './worker-fixture.js';
import { h } from './fixtures.js';

test('a durable signed authorization precedes broadcast and confirmation proves the exact original principal', async () => {
  const f = workerFixture();
  const first = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(first.status, 'BROADCAST');
  assert.equal(f.signatures().length, 1); assert.equal(f.broadcasts().length, 1);
  const pending = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(pending.status, 'BROADCAST'); assert.equal(f.broadcasts().length, 1);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, f.lastHash()));
  const confirmed = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(confirmed.status, 'REFUND_CONFIRMED'); assert.ok('state' in confirmed);
  assert.equal(confirmed.state.proof?.verified, true);
  assert.equal(confirmed.state.proof?.amount, f.eligible.payment.amount);
  assert.equal(confirmed.state.proof?.payer, f.eligible.payment.payer);
  assert.equal(confirmed.state.proof?.authorizationNonce, f.eligible.nonce);
  assert.equal(f.broadcasts().length, 1);
});

test('a crash after broadcast before hash persistence recovers the exact payment from nonce history', async () => {
  const f = workerFixture(); f.mineOnBroadcast(); f.rejectNextSave('BROADCAST');
  const crashed = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(crashed.status, 'CHAIN_RECONCILIATION_REQUIRED');
  assert.equal(f.stored()?.state.status, 'AUTHORIZATION_PREPARED');
  assert.equal(f.stored()?.state.transactionHashes.length, 0);
  const saved = f.stored()?.state.authorization;
  assert.ok(saved);
  const recovered = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(recovered.status, 'REFUND_CONFIRMED');
  assert.ok('state' in recovered); assert.equal(recovered.state.authorization?.digest, saved.digest);
  assert.equal(f.signatures().length, 1); assert.equal(f.broadcasts().length, 1);
});

test('losing authorization persistence never broadcasts money', async () => {
  const f = workerFixture(); f.rejectNextSave('AUTHORIZATION_PREPARED');
  const result = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(result.status, 'CHAIN_RECONCILIATION_REQUIRED');
  assert.equal(f.stored(), null); assert.equal(f.broadcasts().length, 0);
});

test('concurrent retries serialize the signer and reuse one durable financial authorization', async () => {
  const f = workerFixture();
  const results = await Promise.all([runRefundWorker(f.paymentId, f.deps), runRefundWorker(f.paymentId, f.deps)]);
  assert.ok(results.every(result => result.status === 'BROADCAST'));
  assert.equal(f.signatures().length, 1); assert.equal(f.broadcasts().length, 1);
});

test('an expired dropped transaction renews its authorization window with the same financial nonce', async () => {
  const f = workerFixture(); await runRefundWorker(f.paymentId, f.deps);
  const original = f.broadcasts()[0]!;
  f.setObservation({ timestampSeconds: 2000 });
  const retry = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(retry.status, 'BROADCAST'); assert.equal(f.broadcasts().length, 2);
  const renewed = f.broadcasts()[1]!;
  assert.equal(renewed.nonce, original.nonce); assert.equal(renewed.to, original.to);
  assert.equal(renewed.from, original.from); assert.equal(renewed.value, original.value);
  assert.equal(renewed.bindingHash, original.bindingHash); assert.notEqual(renewed.digest, original.digest);
});

test('consumed nonce with a canonical cancellation is canceled and never a confirmed refund', async () => {
  const f = workerFixture(); await runRefundWorker(f.paymentId, f.deps);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, h(40), 'cancel'));
  const result = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(result.status, 'AUTHORIZATION_CANCELED'); assert.ok('state' in result);
  assert.equal(result.state.proof, null); assert.equal(f.broadcasts().length, 1);
});

test('consumed authorization state without matching transfer evidence cannot claim or rebroadcast a refund', async () => {
  const f = workerFixture(); f.setConsumed(true);
  const result = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(result.status, 'CHAIN_RECONCILIATION_REQUIRED'); assert.ok('state' in result);
  assert.equal(result.state.proof, null); assert.equal(result.state.errorCode, 'CONSUMED_WITHOUT_VERIFIED_TRANSFER');
  assert.equal(f.signatures().length, 0); assert.equal(f.broadcasts().length, 0);
});

test('unknown broadcast outcome recovers from the same durable signature without another financial send', async () => {
  const f = workerFixture(); f.mineOnBroadcast(); f.failBroadcast(true);
  const first = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(first.status, 'TX_FAILED'); assert.ok('state' in first);
  assert.equal(first.state.errorCode, 'BROADCAST_OUTCOME_UNKNOWN');
  const digest = first.state.authorization?.digest;
  const recovered = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(recovered.status, 'REFUND_CONFIRMED'); assert.ok('state' in recovered);
  assert.equal(recovered.state.authorization?.digest, digest);
  assert.equal(f.broadcasts().length, 1); assert.equal(f.signatures().length, 1);
});

test('eligibility is re-read after authorization persistence and a provisional ruling prevents broadcast', async () => {
  const f = workerFixture(); f.revokeOnSecondRead();
  const result = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(result.status, 'NOT_ELIGIBLE'); assert.ok('code' in result);
  assert.equal(result.code, 'WAITING_FINALITY');
  assert.ok(f.stored()?.state.authorization); assert.equal(f.broadcasts().length, 0);
});

test('reserve and gas shortfalls are distinct durable states without a financial broadcast', async () => {
  for (const [token, gas, status] of [[9999n, 1000n, 'RESERVE_SHORTFALL'], [10000n, 99n, 'GAS_SHORTFALL']] as const) {
    const f = workerFixture(); f.setBalances({ token, gas });
    const result = await runRefundWorker(f.paymentId, f.deps);
    assert.equal(result.status, status); assert.equal(f.stored()?.state.status, status);
    assert.equal(f.signatures().length, 0); assert.equal(f.broadcasts().length, 0);
  }
});

test('a matching transfer remains confirming until canonical confirmation depth is reached', async () => {
  const f = workerFixture(); await runRefundWorker(f.paymentId, f.deps);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, f.lastHash()));
  f.setObservation({ headBlockNumber: 100n });
  const pending = await runRefundWorker(f.paymentId, f.deps);
  assert.equal(pending.status, 'CONFIRMING'); assert.ok('state' in pending); assert.equal(pending.state.proof, null);
  f.setObservation({ headBlockNumber: 101n });
  assert.equal((await runRefundWorker(f.paymentId, f.deps)).status, 'REFUND_CONFIRMED');
});
