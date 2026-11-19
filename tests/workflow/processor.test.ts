import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore } from '../../src/storage/index.js';
import { hashContent, refundIdentity } from '../../src/domain/identity.js';
import { type CaseManifest, type CourtProof } from '../../src/domain/schema.js';
import { sealCourtEvidence } from '../../src/court/evidence.js';
import { evidenceFixture, courtAddress } from '../court/fixture.js';
import { createCaseProcessor, WorkflowError, type CaseProcessorOptions } from '../../src/workflow/processor.js';
const h = (n: string) => ('0x' + n.repeat(64)) as `0x${string}`;
async function fixture(refund?: CaseProcessorOptions['refund']) {
  const store = new MemoryStateStore(), evidence = evidenceFixture(), sealed = sealCourtEvidence(evidence);
  const c: CaseManifest = {
    schemaVersion: 1, id: evidence.caseId, mode: 'fixture', status: 'disputed',
    createdAt: '2026-11-19T12:00:00.000Z', updatedAt: '2026-11-19T12:00:00.000Z',
    agreement: evidence.agreement, delivery: evidence.delivery, buyerClaim: evidence.buyerClaim,
    sellerDefense: evidence.sellerDefense, payment: evidence.payment, court: null, refund: null,
    evidenceHash: sealed.evidenceHash, events: [],
    provenance: { source: 'live', fixtureLabel: 'Poor delivery', disclosure: 'Explicit fixture; transaction adapters are test doubles in this test.' },
  };
  await store.create('cases/' + c.id + '.json', c);
  await store.create('evidence/' + c.id + '.json', evidence);
  let registrations = 0, judgments = 0, verified = true, registrationStatus = 'registered' as 'registered' | 'pending' | 'failed' | 'undetermined';
  let decision = 'REFUND' as 'REFUND' | 'NO_REFUND';
  let proofStatus = 'finalized' as 'finalized' | 'accepted' | 'undetermined';
  const processor = createCaseProcessor({
    store, refund, payments: { getOrder: async () => ({ state: 'paid', proof: evidence.payment, context: { agreement: evidence.agreement } }) } as never,
    verifyPayment: async () => verified ? evidence.payment : null,
    court: {
      contractAddress: courtAddress,
      registerCase: async () => { registrations += 1; return { caseId: c.id, evidenceHash: sealed.evidenceHash, transactionHash: h('8'), status: 'submitted' }; },
      reconcileRegistration: async () => ({ caseId: c.id, evidenceHash: sealed.evidenceHash, transactionHash: h('8'), status: registrationStatus }),
      submitAdjudication: async () => { judgments += 1; return { caseId: c.id, evidenceHash: sealed.evidenceHash, transactionHash: h('9') }; },
      reconcile: async () => ({ network: 'studionet', contractAddress: courtAddress, caseId: c.id, evidenceHash: sealed.evidenceHash, transactionHash: h('9'),
        status: proofStatus, verified: proofStatus === 'finalized', result: proofStatus === 'undetermined' ? null : { decision, materialFailure: decision === 'REFUND', reasoning: 'Material criterion failure.', failedCriteria: decision === 'REFUND' ? ['relevance'] : [] } }) as CourtProof,
    },
  });
  return { store, c, evidence, sealed, processor, registrations: () => registrations, judgments: () => judgments,
    setVerified: (value: boolean) => { verified = value; }, setRegistration: (value: 'registered'|'pending'|'failed'|'undetermined') => { registrationStatus = value; },
    setDecision: (value: 'REFUND'|'NO_REFUND') => { decision = value; }, setProofStatus: (value: 'finalized'|'accepted'|'undetermined') => { proofStatus = value; } };
}
test('registration and adjudication advance once, only after registration finality', async () => {
  const f = await fixture();
  assert.equal((await f.processor(f.c.id)).status, 'court_pending');
  f.setRegistration('pending'); await f.processor(f.c.id); assert.equal(f.judgments(), 0);
  f.setRegistration('registered'); await f.processor(f.c.id); await f.processor(f.c.id);
  assert.equal(f.registrations(), 1); assert.equal(f.judgments(), 1);
  assert.equal((await f.processor(f.c.id)).status, 'court_finalized');
  await f.processor(f.c.id); assert.equal(f.judgments(), 1);
});
test('a provisional refund never invokes a refund executor', async () => {
  const f = await fixture(); f.setProofStatus('accepted');
  await f.processor(f.c.id); await f.processor(f.c.id); await f.processor(f.c.id);
  const c = await f.processor(f.c.id); assert.equal(c.status, 'court_provisional'); assert.equal(c.refund, null);
});
test('a no-refund ruling is terminal without payment return', async () => {
  const f = await fixture(); f.setDecision('NO_REFUND');
  for (let i = 0; i < 6; i += 1) await f.processor(f.c.id);
  const c = await f.processor(f.c.id); assert.equal(c.status, 'court_finalized'); assert.equal(c.refund, null); assert.equal(f.judgments(), 1);
});
test('unverified original payment blocks any court broadcast', async () => {
  const f = await fixture(); f.setVerified(false);
  await assert.rejects(f.processor(f.c.id), /ORIGINAL_PAYMENT_UNVERIFIED/); assert.equal(f.registrations(), 0);
});
test('changed delivery cannot replace the sealed evidence', async () => {
  const f = await fixture(); const row = await f.store.get<CaseManifest>('cases/' + f.c.id + '.json');
  assert.ok(row); const text = 'Substituted evidence';
  await f.store.compareAndSwap('cases/' + f.c.id + '.json', { ...row.value, delivery: { ...row.value.delivery!, text, hash: hashContent(text) } }, row.etag);
  await assert.rejects(f.processor(f.c.id), /EVIDENCE_BINDING_MISMATCH/); assert.equal(f.registrations(), 0);
});
test('competing processors claim a registration before the side effect', async () => {
  const f = await fixture();
  await Promise.allSettled([f.processor(f.c.id), f.processor(f.c.id)]);
  assert.equal(f.registrations(), 1);
});
test('unknown registration outcome does not create another transaction', async () => {
  const f = await fixture();
  await f.store.create('court-jobs/' + f.c.id + '.json', { schemaVersion: 1, caseId: f.c.id, evidenceHash: f.sealed.evidenceHash,
    phase: 'registering', registrationHash: null, transactionHash: null });
  await assert.rejects(f.processor(f.c.id), /COURT_SUBMISSION_RECONCILIATION_REQUIRED/);
  assert.equal(f.registrations(), 0);
});
test('a missing case fails explicitly', async () => {
  const f = await fixture(); await assert.rejects(f.processor(h('a')), WorkflowError);
});

test('a finalized material ruling returns only the exact original principal, then preserves confirmation on replay', async () => {
  let refunds = 0;
  const f = await fixture(async (id, load) => {
    const context = await load(id);
    if (context.alreadyConfirmedRefund) return { status: 'NOT_ELIGIBLE', code: 'ALREADY_CONFIRMED' };
    assert.equal(context.court?.verified, true); assert.equal(context.rulingBinding?.finalized, true); refunds += 1;
    const proof = { reason: 'quality' as const, status: 'confirmed' as const, authorizer: context.payment.seller,
      payer: context.payment.payer, token: context.payment.token, amount: context.payment.amount,
      authorizationNonce: refundIdentity(id, context.payment.seller), transactionHash: h('f'), blockNumber: '2', blockHash: h('d'), verified: true };
    return { status: 'REFUND_CONFIRMED', state: { paymentId: id, bindingHash: h('c'), reason: 'quality',
      authorizer: context.payment.seller, status: 'REFUND_CONFIRMED', authorization: null,
      transactionHashes: [h('f')], proof, errorCode: null } };
  });
  let c = f.c; for (let i = 0; i < 5; i += 1) c = await f.processor(f.c.id);
  assert.equal(c.status, 'refunded'); assert.equal(c.refund?.amount, f.c.payment!.amount);
  assert.equal(c.refund?.payer, f.c.payment!.payer); assert.equal(refunds, 1);
  await f.processor(f.c.id); assert.equal(refunds, 1);
});
test('a provisional ruling cannot trigger any refund callback', async () => {
  let refunds = 0; const f = await fixture(async () => { refunds += 1; return { status: 'NOT_ELIGIBLE', code:'test' }; });
  f.setProofStatus('accepted'); for (let i = 0; i < 6; i += 1) await f.processor(f.c.id);
  assert.equal(refunds,0);
});
test('refund reserve and gas failures remain visible, and never claim confirmed return', async () => {
  for (const status of ['RESERVE_SHORTFALL','GAS_SHORTFALL','BROADCAST'] as const) {
    const f = await fixture(async (id, load) => {
      const context = await load(id);
      return { status, state:{ paymentId:id,bindingHash:h('c'),reason:'quality',authorizer:context.payment.seller,
        status,authorization:null,transactionHashes:[],proof:null,errorCode:'WAITING' } };
    });
    let c = f.c; for(let i=0;i<5;i+=1)c=await f.processor(f.c.id);
    assert.equal(c.status,'refund_pending');assert.equal(c.refund?.verified,false);
    assert.equal(c.refund?.transactionHash,null);
    assert.equal(c.refund?.status,status==='RESERVE_SHORTFALL'?'reserve_shortfall':status==='GAS_SHORTFALL'?'failed':'pending');
  }
});
test('revoked refund eligibility is an explicit event without a fabricated transfer', async () => {
  const f=await fixture(async()=>({status:'NOT_ELIGIBLE',code:'WAITING_FINALITY'}));
  let c=f.c;for(let i=0;i<5;i+=1)c=await f.processor(f.c.id);
  assert.equal(c.refund,null);assert.ok(c.events.some(event=>event.id==='refund-WAITING_FINALITY'));
});
test('failed or undetermined evidence admission is unresolved and never adjudicates', async () => {
  for(const status of ['failed','undetermined'] as const) {
    const f=await fixture();f.setRegistration(status);await f.processor(f.c.id);
    const c=await f.processor(f.c.id);assert.equal(c.status,'unresolved');assert.equal(f.judgments(),0);
    await f.processor(f.c.id);assert.equal(f.registrations(),1);
  }
});
test('undetermined adjudication does not become an automatic refund', async () => {
  const f=await fixture();f.setProofStatus('undetermined');for(let i=0;i<5;i+=1)await f.processor(f.c.id);
  const c=await f.processor(f.c.id);assert.equal(c.status,'unresolved');assert.equal(c.refund,null);
});
test('an explicit simulation never verifies or broadcasts a real payment', async () => {
  const f=await fixture(),row=await f.store.get<CaseManifest>('cases/'+f.c.id+'.json');assert.ok(row);
  await f.store.compareAndSwap('cases/'+f.c.id+'.json',{...row.value,mode:'simulation',status:'simulation',payment:null,
    delivery:null,buyerClaim:null,sellerDefense:null,evidenceHash:null,provenance:{source:'simulation',fixtureLabel:null,disclosure:'No chain activity.'}},row.etag);
  f.setVerified(false);const c=await f.processor(f.c.id);assert.equal(c.mode,'simulation');assert.equal(f.registrations(),0);
});

test('a returned refund receipt cannot substitute its destination, amount, or financial nonce', async () => {
  for(const changed of ['payer','amount','nonce'] as const) {
    const f=await fixture(async(id,load)=>{
      const context=await load(id);
      const proof={reason:'quality' as const,status:'confirmed' as const,authorizer:context.payment.seller,
        payer:changed==='payer'?context.payment.seller:context.payment.payer,token:context.payment.token,
        amount:changed==='amount'?'99999':context.payment.amount,
        authorizationNonce:changed==='nonce'?h('e'):refundIdentity(id,context.payment.seller),
        transactionHash:h('f'),blockNumber:'2',blockHash:h('d'),verified:true};
      return {status:'REFUND_CONFIRMED',state:{paymentId:id,bindingHash:h('c'),reason:'quality',authorizer:context.payment.seller,
        status:'REFUND_CONFIRMED',authorization:null,transactionHashes:[h('f')],proof,errorCode:null}};
    });
    for(let i=0;i<4;i+=1)await f.processor(f.c.id);
    await assert.rejects(f.processor(f.c.id),/REFUND_PROOF_BINDING_MISMATCH/);
  }
});

test('refund diagnostics expose the validated worker code and distinguish a later failure stage', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  let code = 'CHAIN_UNAVAILABLE';
  const f = await fixture(async (id, load) => {
    const context = await load(id);
    return { status: 'CHAIN_RECONCILIATION_REQUIRED', state: {
      paymentId: id, bindingHash: h('c'), reason: 'quality', authorizer: context.payment.seller,
      status: 'CHAIN_RECONCILIATION_REQUIRED', authorization: null, transactionHashes: [], proof: null, errorCode: code,
    } };
  });
  let c = f.c;
  for (let i = 0; i < 5; i += 1) c = await f.processor(f.c.id);
  assert.ok(c.events.some(event => event.id === 'refund-CHAIN_RECONCILIATION_REQUIRED-CHAIN_UNAVAILABLE'
    && event.label === 'Refund: CHAIN_RECONCILIATION_REQUIRED: CHAIN_UNAVAILABLE'));
  assert.deepEqual(JSON.parse(errors.mock.calls[0].arguments[0] as string), {
    event: 'refund_worker_attention', caseId: f.c.id, status: 'CHAIN_RECONCILIATION_REQUIRED', code: 'CHAIN_UNAVAILABLE',
  });
  code = 'REFUND_STATE_WRITE_FAILED';
  c = await f.processor(f.c.id);
  assert.ok(c.events.some(event => event.label === 'Refund: CHAIN_RECONCILIATION_REQUIRED: REFUND_STATE_WRITE_FAILED'));
  assert.equal(c.refund?.verified, false);
});

test('refund diagnostic events and logs reject arbitrary SDK text and unknown uppercase codes', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  for (const errorCode of ['SDK error signature=PRIVATE_VALUE', 'PRIVATE_SECRET_TOKEN']) {
    const f = await fixture(async (id, load) => {
      const context = await load(id);
      return { status: 'CHAIN_RECONCILIATION_REQUIRED', state: {
        paymentId: id, bindingHash: h('c'), reason: 'quality', authorizer: context.payment.seller,
        status: 'CHAIN_RECONCILIATION_REQUIRED', authorization: null, transactionHashes: [], proof: null, errorCode,
      } };
    });
    let c = f.c;
    for (let i = 0; i < 5; i += 1) c = await f.processor(f.c.id);
    assert.ok(c.events.some(event => event.label === 'Refund: CHAIN_RECONCILIATION_REQUIRED: REFUND_DIAGNOSTIC_UNAVAILABLE'));
    assert.equal(JSON.stringify(c.events).includes('PRIVATE'), false);
  }
  assert.equal(JSON.stringify(errors.mock.calls.map(call => call.arguments)).includes('PRIVATE'), false);
});
