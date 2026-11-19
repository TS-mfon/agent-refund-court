import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRefund } from '../../src/refunds/reconcile.js';
import { runRefundWorker } from '../../src/refunds/worker.js';
import { workerFixture, receiptForRefund } from './worker-fixture.js';
import { h } from './fixtures.js';

function unavailableHistory(f: ReturnType<typeof workerFixture>) {
  let calls = 0;
  return {
    chain: { ...f.deps.chain, authorizationHistory: async () => {
      calls += 1;
      throw new Error('REFUND_HISTORY_SCAN_LIMIT');
    } },
    calls: () => calls,
  };
}
test('a fresh unused refund can prepare and broadcast when historical log queries are unavailable', async () => {
  const f = workerFixture(), history = unavailableHistory(f);
  const result = await runRefundWorker(f.paymentId, { ...f.deps, chain: history.chain });
  assert.equal(result.status, 'BROADCAST');
  assert.equal(history.calls(), 0);
  assert.equal(f.signatures().length, 1);
  assert.equal(f.broadcasts().length, 1);
  assert.ok(f.stored()?.state.authorization);
});
test('a known canonical principal receipt confirms an old payment without scanning history', async () => {
  const f = workerFixture(), transactionHash = h(40), history = unavailableHistory(f);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, transactionHash));
  f.setObservation({ headBlockNumber: 60050n });
  const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain: history.chain,
    observation: f.observation(), transactionHashes: [transactionHash] });
  assert.equal(result.status, 'REFUND_CONFIRMED');
  assert.equal(result.proof?.verified, true);
  assert.equal(result.proof?.amount, f.eligible.payment.amount);
  assert.equal(history.calls(), 0);
});
test('a supplied canonical refund or cancellation contradicting unused state still fails closed', async () => {
  for (const kind of ['refund', 'cancel'] as const) {
    const f = workerFixture(), transactionHash = h(40), history = unavailableHistory(f);
    f.setReceipt(receiptForRefund(f.eligible, transactionHash, kind));
    const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain: history.chain,
      observation: f.observation(), transactionHashes: [transactionHash] });
    assert.equal(result.status, 'CHAIN_RECONCILIATION_REQUIRED');
    assert.equal(result.errorCode, 'AUTHORIZATION_STATE_CONFLICT');
    assert.equal(result.proof, null);
    assert.equal(history.calls(), 0);
  }
});
test('a successful supplied receipt with the wrong payer or value cannot become an unused refund', async () => {
  for (const changed of ['payer', 'value'] as const) {
    const f = workerFixture(), transactionHash = h(40), history = unavailableHistory(f);
    const substitute = { ...f.eligible, to: changed === 'payer' ? f.eligible.from : f.eligible.to,
      value: changed === 'value' ? '9999' : f.eligible.value };
    f.setReceipt(receiptForRefund(substitute, transactionHash));
    const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain: history.chain,
      observation: f.observation(), transactionHashes: [transactionHash] });
    assert.equal(result.status, 'CHAIN_RECONCILIATION_REQUIRED');
    assert.equal(result.errorCode, 'SUCCESSFUL_RECEIPT_WITHOUT_REFUND_PROOF');
    assert.equal(result.proof, null);
    assert.equal(history.calls(), 0);
  }
});
test('a consumed nonce without a saved hash still recovers its verified principal from history', async () => {
  const f = workerFixture(), transactionHash = h(40);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, transactionHash));
  let historyCalls = 0;
  const chain = { ...f.deps.chain, authorizationHistory: async (...args: Parameters<typeof f.deps.chain.authorizationHistory>) => {
    historyCalls += 1; return f.deps.chain.authorizationHistory(...args);
  } };
  const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain,
    observation: f.observation(), transactionHashes: [] });
  assert.equal(result.status, 'REFUND_CONFIRMED');
  assert.equal(result.proof?.transactionHash, transactionHash);
  assert.equal(historyCalls, 1);
});
test('a consumed nonce without proof and unavailable history neither confirms nor broadcasts', async () => {
  const f = workerFixture(), history = unavailableHistory(f); f.setConsumed(true);
  const result = await runRefundWorker(f.paymentId, { ...f.deps, chain: history.chain });
  assert.equal(result.status, 'CHAIN_RECONCILIATION_REQUIRED');
  assert.ok('state' in result);
  assert.equal(result.state.proof, null);
  assert.equal(history.calls(), 1);
  assert.equal(f.signatures().length, 0);
  assert.equal(f.broadcasts().length, 0);
});
test('a known canonical cancellation needs no whole-payment history scan', async () => {
  const f = workerFixture(), transactionHash = h(40), history = unavailableHistory(f);
  f.setConsumed(true); f.setReceipt(receiptForRefund(f.eligible, transactionHash, 'cancel'));
  const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain: history.chain,
    observation: f.observation(), transactionHashes: [transactionHash] });
  assert.equal(result.status, 'AUTHORIZATION_CANCELED');
  assert.equal(result.proof, null);
  assert.equal(history.calls(), 0);
});
test('supplied pending or reverted hashes retain their original outcomes when the nonce is unused', async () => {
  for (const reverted of [false, true]) {
    const f = workerFixture(), transactionHash = h(40), history = unavailableHistory(f);
    if (reverted) f.setReceipt({ ...receiptForRefund(f.eligible, transactionHash), status: 'reverted' });
    const result = await reconcileRefund({ eligibility: f.eligible, policy: f.deps.policy, chain: history.chain,
      observation: f.observation(), transactionHashes: [transactionHash] });
    assert.equal(result.status, reverted ? 'UNUSED' : 'BROADCAST');
    assert.equal(result.errorCode, reverted ? 'TX_REVERTED' : 'WAITING_RECEIPT');
    assert.equal(result.proof, null);
    assert.equal(history.calls(), 0);
  }
});
