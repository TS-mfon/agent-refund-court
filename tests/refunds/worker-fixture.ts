import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { USDC_ADDRESS } from '../../src/domain/schema.js';
import { refundAuthorizationTypedData } from '../../src/refunds/authorization.js';
import { checkRefundEligibility } from '../../src/refunds/eligibility.js';
import { REFUND_EVENT_ABI } from '../../src/refunds/reconcile.js';
import type { EligibleRefund, RefundAuthorization, RefundContext, RefundObservation, RefundReceipt, RefundStatus,
  RefundWorkerDependencies, SignedRefundAuthorization, StoredRefundState } from '../../src/refunds/types.js';
import { context, policy, h } from './fixtures.js';

export function receiptForRefund(e: EligibleRefund, transactionHash: Hex, kind: 'refund' | 'cancel' = 'refund'): RefundReceipt {
  const meta = { address: USDC_ADDRESS, transactionHash, blockNumber: 100n, blockHash: h(21), removed: false };
  const authorization = { ...meta, logIndex: 0, data: '0x' as const,
    topics: encodeEventTopics({ abi: REFUND_EVENT_ABI, eventName: kind === 'refund' ? 'AuthorizationUsed' : 'AuthorizationCanceled',
      args: { authorizer: e.from, nonce: e.nonce } }) as readonly Hex[] };
  const transfer = { ...meta, logIndex: 1,
    topics: encodeEventTopics({ abi: REFUND_EVENT_ABI, eventName: 'Transfer', args: { from: e.from, to: e.to } }) as readonly Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(e.value)]) };
  return { transactionHash, status: 'success', blockNumber: 100n, blockHash: h(21),
    logs: kind === 'refund' ? [authorization, transfer] : [authorization] };
}
export function workerFixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const workerPolicy = { ...policy, authorizer: account.address, courtNetwork: 'studionet' as const };
  const originalContext: RefundContext = { ...context, payment: { ...context.payment, seller: account.address },
    court: { ...context.court, network: 'studionet' } };
  const checked = checkRefundEligibility(originalContext, workerPolicy);
  if (!checked.eligible) throw new Error('INVALID_WORKER_FIXTURE');
  const eligible = checked;
  let currentContext = originalContext;
  let observation: RefundObservation = { chainId: 84532, headBlockNumber: 101n, timestampSeconds: 1000,
    token: { hasCode: true, decimals: 6, name: 'USDC', version: '2' } };
  let balances = { token: 100000n, gas: 1000n };
  let consumed = false, revision = 0, active = 0, reads = 0;
  let persisted: StoredRefundState | null = null;
  let receipts: Readonly<Record<string, RefundReceipt>> = {};
  let signatures: readonly RefundAuthorization[] = [];
  let broadcasts: readonly SignedRefundAuthorization[] = [];
  let rejectStatus: RefundStatus | null = null;
  let mineOnBroadcast = false, failBroadcast = false, revokeOnSecondRead = false;
  let tail: Promise<unknown> = Promise.resolve();
  const deps: RefundWorkerDependencies = {
    policy: workerPolicy,
    loadEligibility: async () => {
      reads += 1;
      return revokeOnSecondRead && reads > 1
        ? { ...currentContext, court: { ...originalContext.court!, status: 'accepted' } } : currentContext;
    },
    signer: { address: account.address, signAuthorization: async authorization => {
      assert.equal(active, 1); signatures = [...signatures, authorization];
      return account.signTypedData(refundAuthorizationTypedData(authorization));
    } },
    withSignerLock: async (_authorizer, operation) => {
      const running = tail.then(async () => { active += 1; try { return await operation(); } finally { active -= 1; } });
      tail = running.then(() => undefined, () => undefined); return running;
    },
    store: {
      load: async () => persisted === null ? null : structuredClone(persisted),
      save: async (_id, expectedRevision, state) => {
        if (rejectStatus === state.status) { rejectStatus = null; return false; }
        if ((persisted?.revision ?? null) !== expectedRevision) return false;
        revision += 1; persisted = { revision: String(revision), state: structuredClone(state) }; return true;
      },
    },
    chain: {
      observation: async () => observation,
      balances: async () => balances,
      authorizationState: async (_from, _nonce, blockNumber) => { assert.equal(blockNumber, observation.headBlockNumber); return consumed; },
      authorizationHistory: async (_from, _nonce, fromBlock, toBlock) => {
        assert.equal(fromBlock, 0n); assert.equal(toBlock, observation.headBlockNumber);
        return Object.values(receipts).flatMap(receipt => receipt.status === 'success' ? [...receipt.logs] : []);
      },
      receipt: async transactionHash => receipts[transactionHash.toLowerCase()] ?? null,
      block: async number => ({ number, hash: h(21) }),
      broadcast: async authorization => {
        assert.equal(active, 1); assert.ok(persisted?.state.authorization);
        assert.equal(persisted.state.authorization.digest, authorization.digest);
        assert.equal(persisted.state.authorization.signature, authorization.signature);
        broadcasts = [...broadcasts, authorization];
        const transactionHash = h(19 + broadcasts.length);
        if (mineOnBroadcast) { consumed = true; receipts = { ...receipts, [transactionHash]: receiptForRefund(eligible, transactionHash) }; }
        if (failBroadcast) throw new Error('synthetic transport failure');
        return transactionHash;
      },
    },
  };
  return { deps, eligible, paymentId: eligible.paymentId, context: originalContext,
    observation: () => observation, signatures: () => signatures, broadcasts: () => broadcasts,
    stored: () => persisted === null ? null : structuredClone(persisted),
    lastHash: () => h(19 + broadcasts.length),
    setContext: (next: RefundContext) => { currentContext = next; },
    setObservation: (next: Partial<RefundObservation>) => { observation = { ...observation, ...next }; },
    setBalances: (next: { token: bigint; gas: bigint }) => { balances = next; },
    setConsumed: (next: boolean) => { consumed = next; },
    setReceipt: (receipt: RefundReceipt) => { receipts = { ...receipts, [receipt.transactionHash.toLowerCase()]: receipt }; },
    rejectNextSave: (status: RefundStatus) => { rejectStatus = status; },
    mineOnBroadcast: () => { mineOnBroadcast = true; },
    failBroadcast: (next: boolean) => { failBroadcast = next; },
    revokeOnSecondRead: () => { revokeOnSecondRead = true; },
  };
}
