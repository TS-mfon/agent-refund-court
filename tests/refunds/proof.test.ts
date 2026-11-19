import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from 'viem';
import { USDC_ADDRESS, BASE_CHAIN_ID } from '../../src/domain/schema.js';
import { checkRefundEligibility } from '../../src/refunds/eligibility.js';
import { buildRefundAuthorization } from '../../src/refunds/authorization.js';
import { verifyRefundLogProof } from '../../src/refunds/reconcile.js';
import type { RefundReceipt } from '../../src/refunds/types.js';
import { context, policy, h, seller, payer } from './fixtures.js';
const abi = parseAbi(['event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)','event Transfer(address indexed from, address indexed to, uint256 value)']);
const eligible = checkRefundEligibility(context, policy);
if (!eligible.eligible) throw new Error('Invalid fixture');
export const refund = eligible;
export function receiptFor(tx = h(20)): RefundReceipt {
  const meta = { address: USDC_ADDRESS, transactionHash: tx, blockNumber: 100n, blockHash: h(21), removed: false };
  return { transactionHash: tx, status: 'success' as const, blockNumber: 100n, blockHash: h(21), logs: [
    { ...meta, logIndex: 0, topics: encodeEventTopics({ abi, eventName: 'AuthorizationUsed', args: { authorizer:seller,nonce:refund.nonce } }) as readonly Hex[], data: '0x' as const },
    { ...meta, logIndex: 1, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from:seller,to:payer } }) as readonly Hex[], data: encodeAbiParameters([{type:'uint256'}],[10000n]) },
  ] };
}
const proofInput = { eligibility: refund, receipt: receiptFor(), chainId: BASE_CHAIN_ID, headBlockNumber: 101n, observedBlock: {number:100n,hash:h(21)}, confirmations:2 };
test('authorization window changes retain the fixed financial refund nonce and principal', () => {
  const a = buildRefundAuthorization(refund, policy, 1000), b = buildRefundAuthorization(refund, policy, 2000);
  assert.equal(a.nonce,b.nonce); assert.equal(a.value,'10000'); assert.equal(a.to,payer);
  assert.equal(a.validBefore,'1600'); assert.equal(b.validBefore,'2600');
});
test('successful same-transaction authorization and exact transfer produce confirmed proof', () => {
  const proof = verifyRefundLogProof(proofInput);
  assert.equal(proof?.verified,true); assert.equal(proof?.transactionHash,h(20)); assert.equal(proof?.amount,'10000');
});
test('wrong token, payee, value, transaction, block, cancellation, or insufficient confirmations cannot prove refund', () => {
  const original = receiptFor();
  const transfer = original.logs[1]!;
  const wrongRecipient = encodeEventTopics({abi,eventName:'Transfer',args:{from:seller,to:'0x4444444444444444444444444444444444444444'}}) as readonly Hex[];
  const badReceipts: RefundReceipt[] = [
    { ...original,status:'reverted' as const },
    { ...original,logs:original.logs.slice(1) },
    { ...original,logs:original.logs.map(l=>({...l,address:'0x4444444444444444444444444444444444444444' as const})) },
    { ...original,logs:[original.logs[0]!,{...transfer,topics:wrongRecipient}] },
    { ...original,logs:[original.logs[0]!,{...transfer,data:encodeAbiParameters([{type:'uint256'}],[9999n])}] },
    { ...original,logs:[original.logs[0]!,{...transfer,transactionHash:h(99)}] },
    { ...original,logs:[original.logs[0]!,{...transfer,blockHash:h(99)}] },
    { ...original,logs:[original.logs[0]!,{...transfer,removed:true}] },
    { ...original,logs:[original.logs[0]!,{...transfer,data:'0x' as const}] },
  ];
  for (const receipt of badReceipts) assert.equal(verifyRefundLogProof({...proofInput,receipt}),null);
  assert.equal(verifyRefundLogProof({...proofInput,chainId:1}),null);
  assert.equal(verifyRefundLogProof({...proofInput,headBlockNumber:100n}),null);
  assert.equal(verifyRefundLogProof({...proofInput,observedBlock:{number:100n,hash:h(99)}}),null);
});
