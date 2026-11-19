import type { Hex } from 'viem';
import { AddressSchema, HashSchema, RefundProofSchema, BASE_CHAIN_ID } from '../domain/schema.js';
import { hashContent } from '../domain/identity.js';
import { checkRefundEligibility, validateRefundPolicy } from './eligibility.js';
import { assertSignedRefundAuthorization, buildRefundAuthorization, signRefundAuthorization } from './authorization.js';
import { reconcileRefund, type RefundReconciliation } from './reconcile.js';
import type { EligibleRefund, RefundObservation, RefundPolicy, RefundState, RefundStatus, RefundWorkerDependencies, RefundWorkerResult, StoredRefundState } from './types.js';

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const unique = (hashes: readonly Hex[]): readonly Hex[] => [...new Map(hashes.map(hash => [hash.toLowerCase(), hash])).values()];
class WorkerFailure extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RefundWorkerFailure'; }
}
function changed(state: RefundState, status: RefundStatus, errorCode: string | null, changes: Partial<RefundState> = {}): RefundState {
  return { ...state, ...changes, status, errorCode, proof: status === 'REFUND_CONFIRMED' ? changes.proof ?? null : null };
}
function result(state: RefundState): RefundWorkerResult { return { status: state.status, state }; }
function observationError(o: RefundObservation, policy: RefundPolicy): string | null {
  if (o.chainId !== BASE_CHAIN_ID) return 'WRONG_CHAIN';
  if (typeof o.headBlockNumber !== 'bigint' || o.headBlockNumber < 0n
    || !Number.isSafeInteger(o.timestampSeconds) || o.timestampSeconds < 1) return 'INVALID_CHAIN_OBSERVATION';
  if (!o.token.hasCode || o.token.decimals !== 6 || o.token.name !== policy.usdcDomain.name
    || o.token.version !== policy.usdcDomain.version) return 'USDC_DOMAIN_MISMATCH';
  return null;
}
function balanceError(balances: { readonly token: bigint; readonly gas: bigint }, e: EligibleRefund, policy: RefundPolicy): { status: RefundStatus; code: string } | null {
  if (typeof balances.token !== 'bigint' || typeof balances.gas !== 'bigint' || balances.token < 0n || balances.gas < 0n)
    throw new WorkerFailure('INVALID_BALANCE_OBSERVATION');
  if (balances.token < BigInt(e.value)) return { status: 'RESERVE_SHORTFALL', code: 'INSUFFICIENT_USDC' };
  if (balances.gas < BigInt(policy.minimumGasBalanceWei)) return { status: 'GAS_SHORTFALL', code: 'INSUFFICIENT_GAS' };
  return null;
}
function storedStateMatches(state: RefundState, e: EligibleRefund): boolean {
  try {
    const statuses: readonly RefundStatus[] = ['AUTHORIZATION_PREPARED','BROADCAST','CONFIRMING','REFUND_CONFIRMED',
      'RESERVE_SHORTFALL','GAS_SHORTFALL','TX_FAILED','AUTHORIZATION_CANCELED','CHAIN_RECONCILIATION_REQUIRED'];
    HashSchema.parse(state.paymentId); HashSchema.parse(state.bindingHash); AddressSchema.parse(state.authorizer);
    if (state.proof !== null) RefundProofSchema.parse(state.proof);
    return eq(state.paymentId, e.paymentId) && eq(state.bindingHash, e.bindingHash) && eq(state.authorizer, e.from)
      && statuses.includes(state.status) && ['quality','non_delivery'].includes(state.reason)
      && Array.isArray(state.transactionHashes) && state.transactionHashes.every(hash => HashSchema.safeParse(hash).success);
  } catch { return false; }
}
async function executeRefund(paymentId: Hex, deps: RefundWorkerDependencies): Promise<RefundWorkerResult> {
  let context;
  try { context = await deps.loadEligibility(paymentId); }
  catch { return { status: 'NOT_ELIGIBLE', code: 'ELIGIBILITY_UNAVAILABLE' }; }
  if (!eq(context.paymentId, paymentId)) return { status: 'NOT_ELIGIBLE', code: 'REQUESTED_PAYMENT_MISMATCH' };
  // Even stored confirmations are origin-reconciled. They never replace token evidence.
  const checked = checkRefundEligibility({ ...context, alreadyConfirmedRefund: null }, deps.policy);
  if (!checked.eligible) return { status: 'NOT_ELIGIBLE', code: checked.code };
  const eligible: EligibleRefund = checked;
  const base: RefundState = { paymentId: eligible.paymentId, bindingHash: eligible.bindingHash, reason: eligible.reason,
    authorizer: eligible.from, status: 'AUTHORIZATION_PREPARED', authorization: null,
    transactionHashes: [], proof: null, errorCode: null };
  let stored: StoredRefundState | null;
  try { stored = await deps.store.load(paymentId); }
  catch { return result(changed(base, 'CHAIN_RECONCILIATION_REQUIRED', 'REFUND_STORE_UNAVAILABLE')); }
  if (stored && !storedStateMatches(stored.state, eligible))
    return result(changed(base, 'CHAIN_RECONCILIATION_REQUIRED', 'STORED_BINDING_MISMATCH'));
  if (stored?.state.authorization) {
    try { await assertSignedRefundAuthorization(stored.state.authorization, eligible, deps.policy); }
    catch { return result(changed(base, 'CHAIN_RECONCILIATION_REQUIRED', 'STORED_AUTHORIZATION_INVALID')); }
  }
  const previousStatus = stored?.state.status;
  let state: RefundState = stored ? { ...stored.state, reason: eligible.reason, proof: null } : base;
  const claimed = context.alreadyConfirmedRefund;
  if (claimed?.verified && claimed.status === 'confirmed') {
    if (!claimed.transactionHash || !eq(claimed.authorizationNonce, eligible.nonce)
      || !eq(claimed.authorizer, eligible.from) || !eq(claimed.payer, eligible.to) || claimed.amount !== eligible.value)
      return result(changed(state, 'CHAIN_RECONCILIATION_REQUIRED', 'INVALID_EXISTING_REFUND_PROOF'));
    state = { ...state, transactionHashes: unique([...state.transactionHashes, claimed.transactionHash]) };
  }
  let stage = 'CHAIN_UNAVAILABLE';
  async function checkpoint(next: RefundState): Promise<void> {
    // Preserve a known hash in the returned failure result if persistence fails
    // after broadcast. No existing object is mutated.
    state = next;
    let saved: boolean;
    try { saved = await deps.store.save(paymentId, stored?.revision ?? null, next); }
    catch { throw new WorkerFailure('REFUND_STATE_WRITE_FAILED'); }
    if (!saved) throw new WorkerFailure('REFUND_STORE_FENCE_LOST');
    let refreshed: StoredRefundState | null;
    try { refreshed = await deps.store.load(paymentId); }
    catch { throw new WorkerFailure('REFUND_STATE_READ_FAILED'); }
    if (!refreshed || hashContent(refreshed.state) !== hashContent(next)) throw new WorkerFailure('REFUND_STORE_FENCE_LOST');
    stored = refreshed; state = refreshed.state;
  }
  async function stop(status: RefundStatus, errorCode: string | null, changes: Partial<RefundState> = {}): Promise<RefundWorkerResult> {
    await checkpoint(changed(state, status, errorCode, changes));
    return result(state);
  }
  async function reconcile(observation: RefundObservation): Promise<RefundReconciliation> {
    return reconcileRefund({ eligibility: eligible, policy: deps.policy, chain: deps.chain, observation, transactionHashes: state.transactionHashes });
  }
  async function stopIfConsumed(reconciliation: RefundReconciliation, timestampSeconds: number): Promise<RefundWorkerResult | null> {
    state = { ...state, transactionHashes: reconciliation.transactionHashes };
    if (reconciliation.status === 'UNUSED') return null;
    // WAITING_RECEIPT occurs only after authorizationState is false. An expired
    // authorization cannot execute; renewal retains its fixed financial nonce.
    // PREPARED also recovers a crash between renewal persistence and broadcast.
    if (reconciliation.status === 'BROADCAST' && reconciliation.errorCode === 'WAITING_RECEIPT' && state.authorization
      && (BigInt(state.authorization.validBefore) <= BigInt(timestampSeconds) || state.status === 'AUTHORIZATION_PREPARED')) return null;
    return stop(reconciliation.status, reconciliation.errorCode, { proof: reconciliation.proof });
  }
  try {
    let observation = await deps.chain.observation();
    const firstObservationError = observationError(observation, deps.policy);
    if (firstObservationError) return await stop('CHAIN_RECONCILIATION_REQUIRED', firstObservationError);
    const initial = await reconcile(observation);
    const initialResult = await stopIfConsumed(initial, observation.timestampSeconds);
    if (initialResult) return initialResult;
    if (previousStatus === 'REFUND_CONFIRMED') return await stop('CHAIN_RECONCILIATION_REQUIRED', 'CONFIRMED_PROOF_NO_LONGER_CANONICAL');
    if (initial.revertedTransactionHashes.length > 0 && (previousStatus === 'BROADCAST' || previousStatus === 'CONFIRMING'))
      return await stop('TX_FAILED', 'TX_REVERTED');
    let shortfall = balanceError(await deps.chain.balances(eligible.from), eligible, deps.policy);
    if (shortfall) return await stop(shortfall.status, shortfall.code);
    if (!state.authorization || BigInt(state.authorization.validBefore) <= BigInt(observation.timestampSeconds)) {
      stage = 'REFUND_SIGNER_UNAVAILABLE';
      const unsigned = buildRefundAuthorization(eligible, deps.policy, observation.timestampSeconds);
      const signed = await signRefundAuthorization(unsigned, deps.signer);
      await checkpoint(changed(state, 'AUTHORIZATION_PREPARED', null, { authorization: signed }));
    }
    stage = 'ELIGIBILITY_RECHECK_UNAVAILABLE';
    const latestContext = await deps.loadEligibility(paymentId);
    if (!eq(latestContext.paymentId, paymentId)) return { status: 'NOT_ELIGIBLE', code: 'REQUESTED_PAYMENT_MISMATCH' };
    const latestEligible = checkRefundEligibility({ ...latestContext, alreadyConfirmedRefund: null }, deps.policy);
    if (!latestEligible.eligible) return { status: 'NOT_ELIGIBLE', code: latestEligible.code };
    if (!eq(latestEligible.bindingHash, eligible.bindingHash) || !eq(latestEligible.nonce, eligible.nonce))
      return await stop('CHAIN_RECONCILIATION_REQUIRED', 'ELIGIBILITY_BINDING_CHANGED');
    stage = 'CHAIN_UNAVAILABLE';
    observation = await deps.chain.observation();
    const finalObservationError = observationError(observation, deps.policy);
    if (finalObservationError) return await stop('CHAIN_RECONCILIATION_REQUIRED', finalObservationError);
    const finalReconciliation = await reconcile(observation);
    const finalResult = await stopIfConsumed(finalReconciliation, observation.timestampSeconds);
    if (finalResult) return finalResult;
    if (!state.authorization) throw new WorkerFailure('MISSING_DURABLE_AUTHORIZATION');
    if (BigInt(state.authorization.validBefore) <= BigInt(observation.timestampSeconds)) return await stop('TX_FAILED', 'AUTHORIZATION_EXPIRED');
    if (BigInt(state.authorization.validAfter) >= BigInt(observation.timestampSeconds)) return await stop('TX_FAILED', 'AUTHORIZATION_NOT_YET_VALID');
    shortfall = balanceError(await deps.chain.balances(eligible.from), eligible, deps.policy);
    if (shortfall) return await stop(shortfall.status, shortfall.code);
    // Final CAS verifies the refund-state fence before a financial broadcast.
    await checkpoint(changed(state, 'AUTHORIZATION_PREPARED', null));
    const authorization = state.authorization;
    if (!authorization) throw new WorkerFailure('MISSING_DURABLE_AUTHORIZATION');
    let transactionHash: Hex;
    try { transactionHash = HashSchema.parse(await deps.chain.broadcast(authorization)); }
    catch { return await stop('TX_FAILED', 'BROADCAST_OUTCOME_UNKNOWN'); }
    await checkpoint(changed(state, 'BROADCAST', null, { transactionHashes: unique([...state.transactionHashes, transactionHash]) }));
    return result(state);
  } catch (error) {
    return result(changed(state, 'CHAIN_RECONCILIATION_REQUIRED', error instanceof WorkerFailure ? error.code : stage));
  }
}
export async function runRefundWorker(inputPaymentId: Hex, deps: RefundWorkerDependencies): Promise<RefundWorkerResult> {
  let paymentId: Hex;
  let authorizer;
  try {
    paymentId = HashSchema.parse(inputPaymentId.toLowerCase());
    validateRefundPolicy(deps.policy); authorizer = AddressSchema.parse(deps.policy.authorizer);
    if (!eq(AddressSchema.parse(deps.signer.address), authorizer)) return { status: 'NOT_ELIGIBLE', code: 'SIGNER_MISMATCH' };
  } catch { return { status: 'NOT_ELIGIBLE', code: 'INVALID_REFUND_CONFIGURATION' }; }
  try { return await deps.withSignerLock(authorizer, () => executeRefund(paymentId, deps)); }
  catch { return { status: 'NOT_ELIGIBLE', code: 'SIGNER_LOCK_UNAVAILABLE' }; }
}
