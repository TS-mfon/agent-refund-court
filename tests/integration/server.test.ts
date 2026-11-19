import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../../src/config.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import { prepareCheckout, checkoutHeaders, PaymentService, type PaymentContext } from '../../src/payments/index.js';
import { hashContent, canonicalJSON, recordTypedData, verifyRecord } from '../../src/domain/identity.js';
import { SAMPLE_BRIEF, PaymentProofSchema, type CaseManifest } from '../../src/domain/schema.js';
import { createApp } from '../../src/server/app.js';

const token = randomBytes(24).toString('hex');
const court = '0x' + '22'.repeat(20);
const tx = '0x' + '91'.repeat(32);
const block = '0x' + '92'.repeat(32);
const decision = { action: 'dispute' as const, materialFailure: true, criterionIds: ['actionability' as const], reason: 'Generic work lacks concrete actions.', quotes: ['Build awareness'] };

function fixture(options: { pending?: boolean; failModel?: boolean; failDefense?: boolean; public?: boolean } = {}) {
  const buyer = privateKeyToAccount(generatePrivateKey()), seller = privateKeyToAccount(generatePrivateKey()), signerKey = generatePrivateKey();
  const store = new MemoryStateStore();
  const config = loadConfig({ SELLER_ADDRESS: seller.address, RECEIPT_SIGNER_PRIVATE_KEY: signerKey, GENLAYER_CONTRACT: court, DEMO_ACCESS_TOKEN: options.public ? undefined : token, BLOB_READ_WRITE_TOKEN: 'unit-test-blob', GEMINI_API_KEY: 'unit-test-model' });
  let generations = 0, settlements = 0, processing = 0, paid = false;
  const proof = (c: PaymentContext) => PaymentProofSchema.parse({ chainId: 84532, network: 'eip155:84532', token: c.agreement.token, payer: c.agreement.buyer, seller: c.agreement.seller, amount: c.agreement.amount, authorizationNonce: c.payment.payload.authorization.nonce, transactionHash: tx, blockNumber: '100', blockHash: block, verified: true });
  const payments = new PaymentService({ store, policy: { seller: seller.address, origin: config.origin, amount: config.price }, facilitator: {
    async verify() { return { isValid: true }; },
    async settle() { settlements += 1; paid = !options.pending; return { success: true, network: 'eip155:84532', payer: buyer.address, transaction: tx }; },
  }, chainProof: { async prove(c) { return { authorizationUsed: paid, proof: paid ? proof(c) : null }; } } });
  const app = createApp({ config, store, payments, model: {
    async seller() { generations += 1; if (options.failModel) throw new Error('apiKey=do-not-leak'); return 'Build awareness and stay consistent.'; },
    async defense() { if (options.failDefense) throw new Error('credential-bearing provider failure'); return 'The answer covers basic launch promotion.'; },
  }, processCase: async id => { processing += 1; return (await store.get<CaseManifest>('cases/' + id + '.json'))!.value; } });
  return { buyer, seller, config, store, app, calls: () => ({ generations, settlements, processing }) };
}

async function purchase(f: ReturnType<typeof fixture>, deliveryMode = 'live', accessToken = token, serviceId = 'launch-plan-v1') {
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer ' + accessToken).send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF, deliveryMode, serviceId }).expect(201);
  const order = created.body.order;
  const buyerAcceptance = await f.buyer.signTypedData(recordTypedData('acceptance', hashContent(order.agreement)));
  await request(f.app).post('/api/v1/orders/' + order.agreement.orderId + '/acceptance').set('Authorization', 'Bearer ' + accessToken).send({ buyerAcceptance }).expect(200);
  const unpaid = await request(f.app).get('/api/v1/orders/' + order.agreement.orderId + '/delivery').set('Authorization', 'Bearer ' + accessToken).expect(402);
  assert.ok(unpaid.headers['payment-required']);
  const context = await prepareCheckout({ agreement: order.agreement, sellerSignature: order.sellerSignature, buyerAcceptance, required: unpaid.body.paymentRequired, signer: f.buyer, store: new MemoryStateStore(), policy: { seller: f.seller.address, origin: f.config.origin, amount: f.config.price } });
  const path = '/api/v1/orders/' + order.agreement.orderId + '/delivery';
  const response = await request(f.app).get(path).set('Authorization', 'Bearer ' + accessToken).set(checkoutHeaders(context));
  return { order, context, path, response };
}

async function publicSession(f: ReturnType<typeof fixture>, account = f.buyer) {
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: account.address }).expect(201)).body.challenge;
  const signature = await account.signMessage({ message: challenge.message });
  const session = (await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(201)).body.session;
  return session.accessToken as string;
}

test('public metadata works without credentials and private routes fail closed', async () => {
  const config = loadConfig({});
  const app = createApp({ config, store: new MemoryStateStore() });
  const service = await request(app).get('/api/v1/service').expect(200);
  assert.equal(service.body.service.capabilities.purchase, false);
  await request(app).get('/api/v1/health').expect(200);
  await request(app).get('/api/v1/cases').expect(200, { cases: [] });
  await request(app).post('/api/v1/orders').send({ buyer: court, brief: SAMPLE_BRIEF }).expect(401);
  await request(app).get('/api/v1/cases/not-an-id').expect(400);
  await request(app).get('/api/v1/missing').expect(404);
});

test('auth and cross-origin requests reject before any funded action', async () => {
  const f = fixture();
  await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer wrong').send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF }).expect(401);
  await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer ' + token).set('Origin', 'https://evil.example').send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF }).expect(403);
  await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer ' + token).send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF, seller: court }).expect(400);
  assert.deepEqual(f.calls(), { generations: 0, settlements: 0, processing: 0 });
});

test('signed quote, real SDK checkout, committed delivery and replay are wired end to end', async () => {
  const f = fixture(), p = await purchase(f);
  assert.equal(p.response.status, 200);
  const c = p.response.body.case;
  assert.equal(await verifyRecord('agreement', hashContent(p.order.agreement), p.order.sellerSignature, p.order.agreement.receiptSigner), true);
  assert.equal(c.payment.verified, true);
  assert.equal(c.delivery.hash, hashContent(c.delivery.text));
  assert.equal(c.id.length, 66);
  assert.equal(await verifyRecord('delivery', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), delivery: c.delivery }), p.response.body.deliverySignature, c.agreement.receiptSigner), true);
  const repeated = await request(f.app).get(p.path).set('Authorization', 'Bearer ' + token).set(checkoutHeaders(p.context)).expect(200);
  assert.deepEqual(repeated.body, p.response.body);
  assert.deepEqual(f.calls(), { generations: 1, settlements: 1, processing: 0 });
  const listing = await request(f.app).get('/api/v1/cases').expect(200);
  assert.equal(listing.body.cases.length, 1);
  const detail = await request(f.app).get('/api/v1/cases/' + c.id).expect(200);
  assert.deepEqual(detail.body.case, c);
  const serialized = JSON.stringify(listing.body);
  assert.equal(serialized.includes('buyerAcceptance'), false);
  assert.equal(serialized.includes(p.context.payment.payload.signature), false);
  await request(f.app).get('/api/v1/orders/' + p.order.agreement.orderId).expect(401);
  await request(f.app).get('/api/v1/cases/' + c.id + '/evidence').expect(404);
});

test('pending chain confirmation cannot generate or release an answer', async () => {
  const f = fixture({ pending: true }), p = await purchase(f);
  assert.equal(p.response.status, 202);
  assert.equal(p.response.body.case, null);
  assert.equal(p.response.body.payment.state, 'pending');
  assert.equal(f.calls().generations, 0);
  assert.equal(f.calls().settlements, 1);
});

test('checkout header mismatch and altered agreement fail before model and settlement', async () => {
  const f = fixture(), p = await purchase(f);
  await request(f.app).get(p.path).set('Authorization', 'Bearer ' + token).set('PAYMENT-SIGNATURE', 'wrong').set('X-ARC-CHECKOUT', checkoutHeaders(p.context)['X-ARC-CHECKOUT']).expect(400);
  await request(f.app).get(p.path).set('Authorization', 'Bearer ' + token).set('PAYMENT-SIGNATURE', checkoutHeaders(p.context)['PAYMENT-SIGNATURE']).set('X-ARC-CHECKOUT', 'not base64').expect(400);
  const altered = { ...p.context, agreement: { ...p.context.agreement, brief: 'Changed brief' } };
  await request(f.app).get(p.path).set('Authorization', 'Bearer ' + token).set(checkoutHeaders(altered)).expect(409);
  assert.deepEqual(f.calls(), { generations: 1, settlements: 1, processing: 0 });
});

test('signed dispute seals original evidence and retries cannot change the claim', async () => {
  const f = fixture(), p = await purchase(f), c = p.response.body.case;
  const payload = { caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision };
  const signature = await f.buyer.signTypedData(recordTypedData('dispute', hashContent(payload)));
  const path = '/api/v1/orders/' + c.agreement.orderId + '/decision';
  const disputed = await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision, signature }).expect(200);
  assert.equal(disputed.body.case.status, 'disputed');
  assert.ok(disputed.body.case.evidenceHash);
  const original = await request(f.app).get('/api/v1/cases/' + c.id + '/evidence').expect(200);
  assert.equal(original.body.evidence.delivery.text, c.delivery.text);
  await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision, signature }).expect(200);
  await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision: { ...decision, reason: 'different claim' }, signature }).expect(403);
  const changed = { ...decision, reason: 'different claim' };
  const changedSig = await f.buyer.signTypedData(recordTypedData('dispute', hashContent({ ...payload, decision: changed })));
  await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision: changed, signature: changedSig }).expect(409);
  await request(f.app).post('/api/v1/cases/' + c.id + '/process').set('Authorization', 'Bearer ' + token).send({}).expect(200);
  assert.equal(f.calls().processing, 1);
});

test('a forged buyer claim or invented excerpt cannot admit evidence', async () => {
  const f = fixture(), p = await purchase(f), c = p.response.body.case;
  const signature = await f.seller.signTypedData(recordTypedData('dispute', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision })));
  await request(f.app).post('/api/v1/orders/' + c.agreement.orderId + '/decision').set('Authorization', 'Bearer ' + token).send({ decision, signature }).expect(403);
  const fabricated = { ...decision, quotes: ['Never delivered'] };
  const buyerSig = await f.buyer.signTypedData(recordTypedData('dispute', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision: fabricated })));
  await request(f.app).post('/api/v1/orders/' + c.agreement.orderId + '/decision').set('Authorization', 'Bearer ' + token).send({ decision: fabricated, signature: buyerSig }).expect(400);
});

test('model failure is redacted and preserves the paid order for recovery', async () => {
  const f = fixture({ failModel: true }), p = await purchase(f);
  assert.equal(p.response.status, 503);
  assert.equal(JSON.stringify(p.response.body).includes('apiKey'), false);
  const saved = await f.store.get<any>('orders/' + p.order.agreement.orderId + '.json');
  assert.equal(saved!.value.phase, 'paid');
  assert.equal(saved!.value.payment.verified, true);
});

test('generic fixture delivery stays explicitly labelled and never fabricates chain claims', async () => {
  const f = fixture(), p = await purchase(f, 'generic');
  assert.equal(p.response.status, 200);
  assert.equal(p.response.body.case.mode, 'fixture');
  assert.match(p.response.body.case.provenance.disclosure, /fixture/i);
  assert.equal(p.response.body.case.payment.transactionHash, tx);
  assert.equal(f.calls().generations, 0);
});

test('buyer acceptance must be signed and cannot change an accepted order', async () => {
  const f = fixture();
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer ' + token).send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF }).expect(201);
  const order = created.body.order, path = '/api/v1/orders/' + order.agreement.orderId;
  await request(f.app).get(path + '/delivery').set('Authorization', 'Bearer ' + token).expect(409);
  const forged = await f.seller.signTypedData(recordTypedData('acceptance', hashContent(order.agreement)));
  await request(f.app).post(path + '/acceptance').set('Authorization', 'Bearer ' + token).send({ buyerAcceptance: forged }).expect(403);
  const buyerAcceptance = await f.buyer.signTypedData(recordTypedData('acceptance', hashContent(order.agreement)));
  await request(f.app).post(path + '/acceptance').set('Authorization', 'Bearer ' + token).send({ buyerAcceptance }).expect(200);
  await request(f.app).post(path + '/acceptance').set('Authorization', 'Bearer ' + token).send({ buyerAcceptance }).expect(200);
});

test('an accepted answer does not admit court evidence and inconsistent acceptance is rejected', async () => {
  const f = fixture(), p = await purchase(f), c = p.response.body.case;
  const accepted = { action: 'accept', materialFailure: false, criterionIds: [], reason: 'The agreed work is complete.', quotes: [] };
  const path = '/api/v1/orders/' + c.agreement.orderId + '/decision';
  const inconsistent = { ...accepted, materialFailure: true, criterionIds: ['actionability'] };
  const badSignature = await f.buyer.signTypedData(recordTypedData('acceptance', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision: inconsistent })));
  await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision: inconsistent, signature: badSignature }).expect(400);
  const signature = await f.buyer.signTypedData(recordTypedData('acceptance', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision: accepted })));
  const response = await request(f.app).post(path).set('Authorization', 'Bearer ' + token).send({ decision: accepted, signature }).expect(200);
  assert.equal(response.body.case.status, 'accepted');
  assert.equal(response.body.case.evidenceHash, null);
  assert.equal(await f.store.get('evidence/' + c.id + '.json'), null);
});

test('a missing seller defense is explicit and cannot prevent a valid dispute', async () => {
  const f = fixture({ failDefense: true }), p = await purchase(f), c = p.response.body.case;
  const signature = await f.buyer.signTypedData(recordTypedData('dispute', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision })));
  const response = await request(f.app).post('/api/v1/orders/' + c.agreement.orderId + '/decision').set('Authorization', 'Bearer ' + token).send({ decision, signature }).expect(200);
  assert.equal(response.body.case.sellerDefense, null);
  assert.ok(response.body.case.events.some((e: { id: string }) => e.id === 'defense-unavailable'));
  assert.equal(JSON.stringify(response.body).includes('credential-bearing'), false);
});

test('request body limits and storage exceptions produce safe errors', async () => {
  const f = fixture();
  await request(f.app).post('/api/v1/orders').set('Authorization', 'Bearer ' + token).send({ buyer: f.buyer.address, brief: 'x'.repeat(25000) }).expect(413);
  const app = createApp({ config: f.config, store: { ...f.store, async get() { throw new Error('secret in upstream headers'); }, async list() { throw new Error('secret in upstream headers'); }, async create() { throw new Error('private'); }, async compareAndSwap() { throw new Error('private'); } } });
  const response = await request(app).get('/api/v1/cases').expect(503);
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});

test('a stored order cannot be read under another order identifier', async () => {
  const f = fixture(), p = await purchase(f);
  const order = await f.store.get<any>('orders/' + p.order.agreement.orderId + '.json');
  const otherId = '0x' + '99'.repeat(32);
  await f.store.create('orders/' + otherId + '.json', order!.value);
  await request(f.app).get('/api/v1/orders/' + otherId).set('Authorization', 'Bearer ' + token).expect(503);
});

test('a changed evidence payload is never published as the original court case', async () => {
  const f = fixture(), p = await purchase(f), c = p.response.body.case;
  const signature = await f.buyer.signTypedData(recordTypedData('dispute', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision })));
  await request(f.app).post('/api/v1/orders/' + c.agreement.orderId + '/decision').set('Authorization', 'Bearer ' + token).send({ decision, signature }).expect(200);
  const row = await f.store.get<any>('evidence/' + c.id + '.json');
  await f.store.compareAndSwap('evidence/' + c.id + '.json', { ...row!.value, sellerDefense: 'Altered after sealing' }, row!.etag);
  await request(f.app).get('/api/v1/cases/' + c.id + '/evidence').expect(503);
});

test('resuming a saved canonical checkout accepts equivalent payment header key order', async () => {
  const f = fixture(), p = await purchase(f);
  const persisted = JSON.parse(canonicalJSON(p.context));
  assert.equal(hashContent(persisted.payment), hashContent(p.context.payment));
  const repeated = await request(f.app).get(p.path).set('Authorization', 'Bearer ' + token).set(checkoutHeaders(persisted)).expect(200);
  assert.deepEqual(repeated.body, p.response.body);
  assert.deepEqual(f.calls(), { generations: 1, settlements: 1, processing: 0 });
});

test('public wallet sessions retain confirmed-payment delivery and signed buyer-only case processing', async () => {
  const f = fixture({ public: true }), buyerToken = await publicSession(f), otherToken = await publicSession(f, f.seller);
  assert.equal(f.config.accessToken, null);
  const p = await purchase(f, 'live', buyerToken), c = p.response.body.case;
  assert.equal(p.response.status, 200);
  assert.equal(c.agreement.buyer, f.buyer.address);
  assert.equal(c.payment.verified, true);
  const privatePath = '/api/v1/orders/' + c.agreement.orderId;
  await request(f.app).get(privatePath).set('Authorization', 'Bearer ' + otherToken).expect(404);
  await request(f.app).get(p.path).set('Authorization', 'Bearer ' + otherToken).set(checkoutHeaders(p.context)).expect(404);
  const signature = await f.buyer.signTypedData(recordTypedData('dispute', hashContent({ caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision })));
  await request(f.app).post(privatePath + '/decision').set('Authorization', 'Bearer ' + otherToken).send({ decision, signature }).expect(404);
  await request(f.app).post(privatePath + '/decision').set('Authorization', 'Bearer ' + buyerToken).send({ decision, signature }).expect(200);
  await request(f.app).post('/api/v1/cases/' + c.id + '/process').set('Authorization', 'Bearer ' + otherToken).send({}).expect(404);
  assert.equal(f.calls().processing, 0);
  await request(f.app).post('/api/v1/cases/' + c.id + '/process').set('Authorization', 'Bearer ' + buyerToken).send({}).expect(200);
  const replayed = await request(f.app).get(p.path).set('Authorization', 'Bearer ' + buyerToken).set(checkoutHeaders(p.context)).expect(200);
  assert.equal(replayed.body.case.delivery.hash, c.delivery.hash);
  assert.deepEqual(f.calls(), { generations: 1, settlements: 1, processing: 1 });
  await request(f.app).get('/api/v1/cases/' + c.id + '/evidence').expect(200);
});

test('a public wallet session cannot release or generate work before its payment is confirmed', async () => {
  const f = fixture({ public: true, pending: true }), buyerToken = await publicSession(f), p = await purchase(f, 'live', buyerToken);
  assert.equal(p.response.status, 202);
  assert.equal(p.response.body.case, null);
  const saved = await request(f.app).get('/api/v1/orders/' + p.order.agreement.orderId).set('Authorization', 'Bearer ' + buyerToken).expect(200);
  assert.equal(saved.body.order.delivery, null);
  assert.equal(saved.body.order.payment, null);
  assert.deepEqual(f.calls(), { generations: 0, settlements: 1, processing: 0 });
});

test('live custom-work receipts describe the requested service without a fictional launch-plan disclosure', async () => {
  const f = fixture(), p = await purchase(f, 'live', token, 'agent-work-v1');
  assert.equal(p.response.status, 200);
  assert.equal(p.response.body.case.agreement.serviceId, 'agent-work-v1');
  assert.equal(p.response.body.case.mode, 'live');
  assert.doesNotMatch(p.response.body.case.provenance.disclosure, /fictional TraceLite/);
});
