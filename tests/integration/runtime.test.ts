import { privateKeyToAccount } from 'viem/accounts';
import { BlobStateStore, MemoryStateStore } from '../../src/storage/index.js';
import { CourtClient } from '../../src/court/client.js';
import { BaseUSDCProofVerifier } from '../../src/payments/proof.js';
import { PaymentService } from '../../src/payments/service.js';
import { type PaymentContext } from '../../src/payments/context.js';
import { hashContent, paymentIdentity } from '../../src/domain/identity.js';
import { type CaseManifest, type SealedEvidence } from '../../src/domain/schema.js';
import { sealCourtEvidence } from '../../src/court/evidence.js';
import { evidenceFixture } from '../court/fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createRuntimeApp } from '../../src/runtime.js';
test('unconfigured local viewer advertises disabled purchases and serves empty cases',async()=>{
 const app=createRuntimeApp({});
 const service=await request(app).get('/api/v1/service').expect(200);
 assert.equal(service.body.service.capabilities.purchase,false);
 assert.deepEqual((await request(app).get('/api/v1/cases').expect(200)).body,{cases:[]});
 await request(app).post('/api/v1/orders').send({}).expect(401);
});
test('hosted runtime cannot silently substitute in-memory storage',()=>{
 assert.throws(()=>createRuntimeApp({VERCEL:'1'}),/Production storage required/);
});

test('upgraded deployment routes old and new cases to each original agreement court', async t => {
 const store = new MemoryStateStore(), oldCourt = '0x1111111111111111111111111111111111111111';
 const currentCourt = '0x2222222222222222222222222222222222222222';
 const privateKey = ('0x' + '11'.repeat(32)) as `0x${string}`, seller = privateKeyToAccount(privateKey).address;
 const token = crypto.randomUUID();
 const evidenceByOrder = new Map<string, SealedEvidence>();
 const dispatched: string[] = [];
 t.mock.method(BlobStateStore.prototype, 'get', store.get.bind(store));
 t.mock.method(BlobStateStore.prototype, 'create', store.create.bind(store));
 t.mock.method(BlobStateStore.prototype, 'compareAndSwap', store.compareAndSwap.bind(store));
 t.mock.method(BlobStateStore.prototype, 'list', store.list.bind(store));
 t.mock.method(PaymentService.prototype, 'getOrder', async (orderId: string) => {
  const evidence = evidenceByOrder.get(orderId)!;
  return { state: 'paid', proof: evidence.payment, context: { agreement: evidence.agreement } } as never;
 });
 t.mock.method(BaseUSDCProofVerifier.prototype, 'prove', async (context: PaymentContext) => ({
  authorizationUsed: true, proof: evidenceByOrder.get(context.agreement.orderId)!.payment,
 }));
 t.mock.method(CourtClient.prototype, 'registerCase', async function(this: CourtClient, evidence: SealedEvidence) {
  dispatched.push(this.contractAddress);
  const sealed = sealCourtEvidence(evidence);
  return { caseId: evidence.caseId, evidenceHash: sealed.evidenceHash, transactionHash: hashContent(this.contractAddress), status: 'submitted' as const };
 });
 const app = createRuntimeApp({ SELLER_ADDRESS: seller, SELLER_PRIVATE_KEY: privateKey,
  RECEIPT_SIGNER_PRIVATE_KEY: privateKey, GENLAYER_REGISTRAR_PRIVATE_KEY: privateKey,
  GENLAYER_CONTRACT: currentCourt, DEMO_ACCESS_TOKEN: token, BLOB_READ_WRITE_TOKEN: 'unit-test-store' });
 for (const courtAddress of [oldCourt, currentCourt]) {
  const original = evidenceFixture();
  const agreement = { ...original.agreement, courtAddress: courtAddress as `0x${string}`, seller, receiptSigner: seller };
  const payment = { ...original.payment, seller, authorizationNonce: hashContent(courtAddress) };
  const caseId = paymentIdentity({ chainId: payment.chainId, token: payment.token, payer: payment.payer, nonce: payment.authorizationNonce });
  const evidence = { ...original, agreement, payment, caseId, agreementHash: hashContent(agreement) };
  const sealed = sealCourtEvidence(evidence);
  const c: CaseManifest = { schemaVersion: 1, id: caseId, mode: 'fixture', status: 'disputed',
   createdAt: '2026-11-19T12:00:00.000Z', updatedAt: '2026-11-19T12:00:00.000Z', agreement, payment,
   delivery: evidence.delivery, buyerClaim: evidence.buyerClaim, sellerDefense: evidence.sellerDefense,
   court: null, refund: null, evidenceHash: sealed.evidenceHash, events: [],
   provenance: { source: 'live', fixtureLabel: 'Original answer fixture', disclosure: 'Network adapters are explicit test doubles.' } };
  evidenceByOrder.set(agreement.orderId, evidence);
  await store.create('cases/' + caseId + '.json', c);
  await store.create('evidence/' + caseId + '.json', evidence);
  const response = await request(app).post('/api/v1/cases/' + caseId + '/process').set('Authorization', 'Bearer ' + token).send({}).expect(200);
  assert.equal(response.body.case.court.contractAddress, courtAddress);
  assert.equal(response.body.case.agreement.courtAddress, courtAddress);
 }
 assert.deepEqual(dispatched, [oldCourt, currentCourt]);
});

test('runtime rejects unsupported original court networks before any chain processing', async t => {
 const store = new MemoryStateStore(), evidence = evidenceFixture();
 const privateKey = ('0x' + '11'.repeat(32)) as `0x${string}`, seller = privateKeyToAccount(privateKey).address;
 const token = crypto.randomUUID();
 t.mock.method(BlobStateStore.prototype, 'get', store.get.bind(store));
 t.mock.method(BlobStateStore.prototype, 'create', store.create.bind(store));
 t.mock.method(BlobStateStore.prototype, 'compareAndSwap', store.compareAndSwap.bind(store));
 t.mock.method(BlobStateStore.prototype, 'list', store.list.bind(store));
 let processed = 0;
 t.mock.method(CourtClient.prototype, 'registerCase', async () => { processed += 1; throw new Error('Must not reach chain'); });
 const c: CaseManifest = { schemaVersion: 1, id: evidence.caseId, mode: 'fixture', status: 'disputed',
  createdAt: '2026-11-19T12:00:00.000Z', updatedAt: '2026-11-19T12:00:00.000Z',
  agreement: { ...evidence.agreement, courtNetwork: 'testnet-bradbury' }, payment: evidence.payment,
  delivery: evidence.delivery, buyerClaim: evidence.buyerClaim, sellerDefense: evidence.sellerDefense,
  court: null, refund: null, evidenceHash: hashContent(evidence), events: [],
  provenance: { source: 'live', fixtureLabel: 'Original answer fixture', disclosure: 'Network adapters are explicit test doubles.' } };
 await store.create('cases/' + c.id + '.json', c);
 const app = createRuntimeApp({ SELLER_ADDRESS: seller, SELLER_PRIVATE_KEY: privateKey,
  RECEIPT_SIGNER_PRIVATE_KEY: privateKey, GENLAYER_REGISTRAR_PRIVATE_KEY: privateKey,
  GENLAYER_CONTRACT: '0x' + '22'.repeat(20), DEMO_ACCESS_TOKEN: token, BLOB_READ_WRITE_TOKEN: 'unit-test-store' });
 const response = await request(app).post('/api/v1/cases/' + c.id + '/process').set('Authorization', 'Bearer ' + token).send({}).expect(503);
 assert.equal(response.body.error.code, 'UNSUPPORTED_CASE_COURT');
 assert.equal(processed, 0);
});
