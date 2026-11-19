import { decodeEventLog, parseAbi, type Address, type Hex } from 'viem';
import { BASE_CHAIN_ID, USDC_ADDRESS, PaymentProofSchema, RefundProofSchema, HashSchema, type RefundProof } from '../domain/schema.js';
import { paymentIdentity, refundIdentity } from '../domain/identity.js';
import type { EligibleRefund, RefundChain, RefundLog, RefundObservation, RefundPolicy, RefundReceipt, RefundStatus } from './types.js';

export const REFUND_EVENT_ABI = parseAbi([
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event AuthorizationCanceled(address indexed authorizer,bytes32 indexed nonce)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
type TokenEvent = { readonly kind: 'used' | 'canceled'; readonly authorizer: Address; readonly nonce: Hex }
  | { readonly kind: 'transfer'; readonly from: Address; readonly to: Address; readonly value: bigint };
function decode(log: RefundLog): TokenEvent | null {
  try {
    const event = decodeEventLog({ abi: REFUND_EVENT_ABI, topics: [...log.topics] as [] | [Hex, ...Hex[]], data: log.data, strict: true });
    if (event.eventName === 'AuthorizationUsed' || event.eventName === 'AuthorizationCanceled')
      return { kind: event.eventName === 'AuthorizationUsed' ? 'used' : 'canceled', authorizer: event.args.authorizer, nonce: event.args.nonce };
    return { kind: 'transfer', from: event.args.from, to: event.args.to, value: event.args.value };
  } catch { return null; } // An unrelated or malformed event cannot establish payment.
}
function relevant(event: TokenEvent | null, eligibility: EligibleRefund, kind: 'used' | 'canceled'): boolean {
  return event !== null && event.kind !== 'transfer' && event.kind === kind
    && eq(event.authorizer, eligibility.from) && eq(event.nonce, eligibility.nonce);
}
function logMatchesReceipt(log: RefundLog, receipt: RefundReceipt): boolean {
  return !log.removed && log.transactionHash !== null && log.blockHash !== null
    && log.blockNumber === receipt.blockNumber && eq(log.transactionHash, receipt.transactionHash)
    && eq(log.blockHash, receipt.blockHash) && Number.isSafeInteger(log.logIndex) && log.logIndex! >= 0;
}
function tokenLogs(receipt: RefundReceipt): readonly RefundLog[] | null {
  const logs = receipt.logs.filter(log => eq(log.address, USDC_ADDRESS));
  if (logs.some(log => !logMatchesReceipt(log, receipt)) || new Set(logs.map(log => log.logIndex)).size !== logs.length) return null;
  return [...logs].sort((a, b) => a.logIndex! - b.logIndex!);
}
function hasAction(receipt: RefundReceipt, eligibility: EligibleRefund, kind: 'used' | 'canceled'): boolean {
  const logs = tokenLogs(receipt);
  return receipt.status === 'success' && logs !== null && logs.some(log => relevant(decode(log), eligibility, kind));
}
function hasExactTransfer(receipt: RefundReceipt, eligibility: EligibleRefund): boolean {
  const logs = tokenLogs(receipt);
  if (receipt.status !== 'success' || logs === null || logs.some(log => relevant(decode(log), eligibility, 'canceled'))) return false;
  const pairs = logs.filter((log, index) => {
    if (!relevant(decode(log), eligibility, 'used')) return false;
    const following = logs[index + 1], transfer = following ? decode(following) : null;
    return transfer?.kind === 'transfer' && eq(transfer.from, eligibility.from)
      && eq(transfer.to, eligibility.to) && transfer.value === BigInt(eligibility.value);
  });
  // USDC emits AuthorizationUsed immediately before its Transfer. Pairing prevents
  // another transfer in the same transaction from being substituted for this nonce.
  return pairs.length === 1;
}
function validPrincipal(eligibility: EligibleRefund): boolean {
  try {
    const p = PaymentProofSchema.parse(eligibility.payment);
    return p.verified && eq(eligibility.from, p.seller) && eq(eligibility.to, p.payer)
      && eligibility.value === p.amount && BigInt(p.amount) < 2n ** 256n
      && eq(eligibility.paymentId, paymentIdentity({ chainId: p.chainId, token: p.token, payer: p.payer, nonce: p.authorizationNonce }))
      && eq(eligibility.nonce, refundIdentity(eligibility.paymentId, p.seller));
  } catch { return false; }
}
export interface RefundLogProofInput {
  readonly eligibility: EligibleRefund; readonly receipt: RefundReceipt; readonly chainId: number;
  readonly headBlockNumber: bigint; readonly observedBlock: { readonly number: bigint; readonly hash: Hex };
  readonly confirmations: number;
}
function canonical(input: RefundLogProofInput): boolean {
  const { receipt, observedBlock, headBlockNumber, confirmations } = input;
  return input.chainId === BASE_CHAIN_ID && receipt.status === 'success'
    && Number.isSafeInteger(confirmations) && confirmations >= 1 && receipt.blockNumber >= 0n
    && headBlockNumber >= receipt.blockNumber && headBlockNumber - receipt.blockNumber + 1n >= BigInt(confirmations)
    && observedBlock.number === receipt.blockNumber && eq(observedBlock.hash, receipt.blockHash);
}
export function verifyRefundLogProof(input: RefundLogProofInput): RefundProof | null {
  try {
    const { eligibility: e, receipt: r } = input;
    if (!validPrincipal(e) || !canonical(input) || r.blockNumber < BigInt(e.payment.blockNumber) || !hasExactTransfer(r, e)) return null;
    return RefundProofSchema.parse({ reason: e.reason, status: 'confirmed', authorizer: e.from, payer: e.to,
      token: USDC_ADDRESS, amount: e.value, authorizationNonce: e.nonce, transactionHash: r.transactionHash,
      blockNumber: String(r.blockNumber), blockHash: r.blockHash, verified: true });
  } catch { return null; }
}
export interface RefundReconciliation {
  readonly status: 'UNUSED' | RefundStatus; readonly proof: RefundProof | null;
  readonly transactionHashes: readonly Hex[]; readonly revertedTransactionHashes: readonly Hex[];
  readonly errorCode: string | null;
}
function unique(hashes: readonly Hex[]): readonly Hex[] {
  return [...new Map(hashes.map(hash => [hash.toLowerCase(), hash])).values()];
}
export async function reconcileRefund(input: {
  readonly eligibility: EligibleRefund; readonly policy: RefundPolicy; readonly chain: RefundChain;
  readonly observation: RefundObservation; readonly transactionHashes: readonly Hex[];
}): Promise<RefundReconciliation> {
  const { eligibility: e, policy, chain, observation: o } = input;
  if (!validPrincipal(e) || o.chainId !== BASE_CHAIN_ID) throw new Error('INVALID_REFUND_RECONCILIATION');
  const [consumed, history] = await Promise.all([
    chain.authorizationState(e.from, e.nonce, o.headBlockNumber),
    chain.authorizationHistory(e.from, e.nonce, 0n, o.headBlockNumber),
  ]);
  const historyHashes = history.flatMap(log => {
    const event = eq(log.address, USDC_ADDRESS) && !log.removed ? decode(log) : null;
    if (!log.transactionHash || (!relevant(event, e, 'used') && !relevant(event, e, 'canceled'))) return [];
    return [HashSchema.parse(log.transactionHash)];
  });
  const transactionHashes = unique([...input.transactionHashes.map(hash => HashSchema.parse(hash)), ...historyHashes]);
  const entries = await Promise.all(transactionHashes.map(async transactionHash => {
    const receipt = await chain.receipt(transactionHash);
    const block = receipt?.status === 'success' && receipt.blockNumber <= o.headBlockNumber
      ? await chain.block(receipt.blockNumber) : null;
    return { transactionHash, receipt, block };
  }));
  const revertedTransactionHashes = entries.filter(entry => entry.receipt?.status === 'reverted').map(entry => entry.transactionHash);
  const outcome = (status: RefundReconciliation['status'], errorCode: string | null = null, proof: RefundProof | null = null): RefundReconciliation =>
    ({ status, errorCode, proof, transactionHashes, revertedTransactionHashes });
  const proofs = entries.flatMap(entry => {
    if (!entry.receipt || !entry.block || !eq(entry.receipt.transactionHash, entry.transactionHash)) return [];
    const proof = verifyRefundLogProof({ eligibility: e, receipt: entry.receipt, observedBlock: entry.block,
      chainId: o.chainId, headBlockNumber: o.headBlockNumber, confirmations: policy.confirmations });
    return proof ? [proof] : [];
  });
  const canceled = entries.filter(entry => entry.receipt && entry.block
    && eq(entry.receipt.transactionHash, entry.transactionHash)
    && canonical({ eligibility: e, receipt: entry.receipt, observedBlock: entry.block, chainId: o.chainId,
      headBlockNumber: o.headBlockNumber, confirmations: policy.confirmations })
    && hasAction(entry.receipt, e, 'canceled'));
  if (proofs.length > 1 || (proofs.length > 0 && canceled.length > 0)) return outcome('CHAIN_RECONCILIATION_REQUIRED', 'CONFLICTING_AUTHORIZATION_HISTORY');
  if (proofs.length === 1) return consumed ? outcome('REFUND_CONFIRMED', null, proofs[0]!)
    : outcome('CHAIN_RECONCILIATION_REQUIRED', 'AUTHORIZATION_STATE_CONFLICT');
  if (canceled.length > 0) return consumed ? outcome('AUTHORIZATION_CANCELED', 'AUTHORIZATION_CANCELED')
    : outcome('CHAIN_RECONCILIATION_REQUIRED', 'AUTHORIZATION_STATE_CONFLICT');
  const observedAction = entries.some(entry => entry.receipt && entry.block
    && eq(entry.receipt.transactionHash, entry.transactionHash)
    && canonical({ eligibility: e, receipt: entry.receipt, observedBlock: entry.block, chainId: o.chainId,
      headBlockNumber: o.headBlockNumber, confirmations: 1 })
    && (hasExactTransfer(entry.receipt, e) || hasAction(entry.receipt, e, 'canceled')));
  if (observedAction) return consumed ? outcome('CONFIRMING', 'WAITING_CONFIRMATIONS')
    : outcome('CHAIN_RECONCILIATION_REQUIRED', 'AUTHORIZATION_STATE_CONFLICT');
  if (consumed) return outcome('CHAIN_RECONCILIATION_REQUIRED', 'CONSUMED_WITHOUT_VERIFIED_TRANSFER');
  const successfulWithoutProof = entries.some(entry => entry.receipt?.status === 'success' && entry.receipt.blockNumber <= o.headBlockNumber);
  if (successfulWithoutProof) return outcome('CHAIN_RECONCILIATION_REQUIRED', 'SUCCESSFUL_RECEIPT_WITHOUT_REFUND_PROOF');
  if (entries.some(entry => entry.receipt?.status === 'success' && entry.receipt.blockNumber > o.headBlockNumber)) return outcome('CONFIRMING', 'WAITING_HEAD');
  if (entries.some(entry => entry.receipt === null)) return outcome('BROADCAST', 'WAITING_RECEIPT');
  return outcome('UNUSED', revertedTransactionHashes.length > 0 ? 'TX_REVERTED' : null);
}
