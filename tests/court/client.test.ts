import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionStatus, ExecutionResult, TransactionHashVariant } from 'genlayer-js/types';
import { createCourtClient, type CourtRpc } from '../../src/court/client.js';
import { sealCourtEvidence } from '../../src/court/evidence.js';
import { courtAddress, registrarAddress, evidenceFixture, transactionHash } from './fixture.js';
const refund={decision:'REFUND',materialFailure:true,reasoning:'The generic plan omits product-specific actions and useful feedback.',failedCriteria:['relevance','actionability']};
function setup() {
  const sealed=sealCourtEvidence(evidenceFixture());
  const baseState={schemaVersion:1,contractAddress:courtAddress,caseId:sealed.caseId,paymentId:sealed.paymentId,evidenceHash:sealed.evidenceHash,canonicalEvidence:sealed.canonicalEvidence,status:'DECIDED',result:refund};
  const baseTx={hash:transactionHash,statusName:TransactionStatus.FINALIZED,status:7,from_address:registrarAddress,to_address:courtAddress,txExecutionResultName:ExecutionResult.FINISHED_WITH_RETURN,data:{calldata:{readable:{method:'adjudicate',args:[sealed.caseId]}}}};
  const context={state:baseState as Record<string,unknown>,tx:baseTx as Record<string,unknown>,reads:[] as unknown[],writes:[] as unknown[],failWait:false};
  const rpc:CourtRpc={
    async readContract(args){context.reads.push(args);return context.state;},
    async writeContract(args){context.writes.push(args);return transactionHash;},
    async getTransaction(){return context.tx;},
    async waitForTransactionReceipt(){if(context.failWait)throw new Error('Timed out');return context.tx;},
  };
  const client=createCourtClient({contractAddress:courtAddress,registrar:registrarAddress,rpc});
  return {sealed,context,client,baseState,baseTx};
}
test('only successful FINALIZED adjudication and finalized matching terminal state verify', async () => {
  const {sealed,client,context}=setup();
  const p=await client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash});
  assert.equal(p.verified,true); assert.equal(p.status,'finalized'); assert.equal(p.result?.decision,'REFUND');
  assert.equal((context.reads[0] as {transactionHashVariant:unknown}).transactionHashVariant,TransactionHashVariant.LATEST_FINAL);
});
test('ACCEPTED is provisional even with a REFUND result',async()=>{
  const {sealed,client,context}=setup();
  context.tx={...context.tx,statusName:TransactionStatus.ACCEPTED,status:5};
  const p=await client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash});
  assert.equal(p.status,'accepted');assert.equal(p.verified,false);
});
test('failed, undetermined and pending transactions never create a monetary decision',async()=>{
  for(const status of [TransactionStatus.UNDETERMINED,TransactionStatus.PENDING,TransactionStatus.CANCELED]){
    const {sealed,client,context}=setup();context.tx={...context.tx,statusName:status};
    const p=await client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash});
    assert.equal(p.verified,false);assert.equal(p.result,null);
  }
  const {sealed,client,context}=setup();context.tx={...context.tx,txExecutionResultName:ExecutionResult.FINISHED_WITH_ERROR};
  assert.equal((await client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash})).status,'failed');
});
test('contract, signer, method, case, evidence, hash and leader-only mismatches reject',async()=>{
  const variants=[
    {to_address:'0x9999999999999999999999999999999999999999'},
    {from_address:'0x9999999999999999999999999999999999999999'},
    {hash:('0x'+'99'.repeat(32))},
    {data:{calldata:{readable:{method:'register_case',args:[]}}}},
    {data:{calldata:{readable:{method:'adjudicate',args:[('0x'+'99'.repeat(32))]}}}},
    {data:{leader_only:true,calldata:{readable:{method:'adjudicate',args:[]}}}},
  ];
  for(const variant of variants){
    const {sealed,client,context}=setup();context.tx={...context.tx,...variant};
    await assert.rejects(()=>client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash}));
  }
  for(const variant of [{caseId:('0x'+'99'.repeat(32))},{evidenceHash:('0x'+'99'.repeat(32))},{contractAddress:'0x9999999999999999999999999999999999999999'},{result:{...refund,materialFailure:false}},{status:'REGISTERED'}]){
    const {sealed,client,context}=setup();context.state={...context.state,...variant};
    await assert.rejects(()=>client.reconcile({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash}));
  }
});
test('registration reconciliation checks the entire original admission call',async()=>{
  const {sealed,client,context}=setup();
  context.state={...context.state,status:'REGISTERED',result:null};
  context.tx={...context.tx,data:{calldata:{readable:{method:'register_case',args:[sealed.caseId,sealed.canonicalEvidence,sealed.evidenceHash]}}}};
  assert.equal((await client.reconcileRegistration(sealed.evidence,transactionHash)).status,'registered');
  context.tx={...context.tx,data:{calldata:{readable:{method:'register_case',args:[sealed.caseId,'{}',sealed.evidenceHash]}}}};
  await assert.rejects(()=>client.reconcileRegistration(sealed.evidence,transactionHash));
});
test('adjudication waits for finalized registration and sends validator consensus calls',async()=>{
  const {sealed,client,context}=setup();
  context.state={...context.state,status:'REGISTERED',result:null};
  await client.submitAdjudication({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash});
  assert.equal((context.writes[0] as {leaderOnly:boolean}).leaderOnly,false);
  assert.equal((context.reads[0] as {transactionHashVariant:unknown}).transactionHashVariant,TransactionHashVariant.LATEST_FINAL);
  context.state={...context.state,status:'DECIDED',result:refund};
  await assert.rejects(()=>client.submitAdjudication({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash}));
});
test('bounded finality timeout returns the current provisional status',async()=>{
  const {sealed,client,context}=setup();context.failWait=true;
  context.tx={...context.tx,statusName:TransactionStatus.ACCEPTED,status:5};
  assert.equal((await client.waitForFinality({caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash})).status,'accepted');
});
