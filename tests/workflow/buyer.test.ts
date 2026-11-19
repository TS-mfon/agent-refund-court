import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import { PaymentService } from '../../src/payments/service.js';
import { PaymentProofSchema, type BuyerDecision } from '../../src/domain/schema.js';
import { createBuyerWorkflow } from '../../src/workflow/buyer.js';
function fixture(action: 'accept'|'dispute', options: { fault?: string; discovery?: boolean; pending?: boolean; maxAttempts?: number } = {}) {
  const buyer = privateKeyToAccount(generatePrivateKey()), seller = privateKeyToAccount(generatePrivateKey());
  const store = new MemoryStateStore(), buyerStore = new MemoryStateStore(), accessToken = 'test-token-not-a-real-secret';
  const config = loadConfig({ SERVICE_ORIGIN: 'https://demo.example', SELLER_ADDRESS: seller.address,
    RECEIPT_SIGNER_PRIVATE_KEY: generatePrivateKey(), GENLAYER_CONTRACT: '0x' + '77'.repeat(20), DEMO_ACCESS_TOKEN: accessToken, BLOB_READ_WRITE_TOKEN: 'fixture' });
  let used = false, settlements = 0, modelCalls = 0, now = Date.now();
  const payments = new PaymentService({ store, now: () => now, policy: { seller: seller.address, origin: config.origin, amount: '10000' },
    facilitator: { verify: async () => ({ isValid: true }), settle: async () => { settlements += 1; used = !options.pending; return { success: true, network: 'eip155:84532', transaction: '0x'+'88'.repeat(32), payer: buyer.address }; } },
    chainProof: { prove: async c => ({ authorizationUsed: used, proof: used ? PaymentProofSchema.parse({
      chainId: 84532, network: 'eip155:84532', token: c.agreement.token, payer: buyer.address, seller: seller.address, amount: '10000',
      authorizationNonce: c.payment.payload.authorization.nonce, transactionHash: '0x'+'88'.repeat(32), blockNumber: '100', blockHash:'0x'+'99'.repeat(32), verified: true }) : null }) } });
  const app = createApp({ config, store, payments, now: () => now });
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname, method = (init?.method ?? 'GET').toLowerCase() as 'get'|'post';
    let req = request(app)[method](path);
    new Headers(init?.headers).forEach((value,key) => { req = req.set(key,value); });
    if (init?.body) req = req.send(JSON.parse(String(init.body)));
    const response = await req;
    if(path==='/api/v1/orders' && response.status===201) {
      if(options.fault==='quoteJSON') return new Response('{',{status:201});
      if(options.fault==='quoteLarge') return new Response('x'.repeat(65537),{status:201});
      if(options.fault==='wrongPrice') return Response.json({...response.body,order:{...response.body.order,agreement:{...response.body.order.agreement,amount:'20000'}}},{status:201});
      if(options.fault==='wrongBuyer') return Response.json({...response.body,order:{...response.body.order,agreement:{...response.body.order.agreement,buyer:seller.address}}},{status:201});
      if(options.fault==='preparing') await buyerStore.create('buyer/orders/'+response.body.order.agreement.orderId+'.json',{status:'PREPARING',context:null});
    }
    if(path.endsWith('/delivery') && response.status===402) {
      if(options.fault==='challengeStatus') return Response.json({}, {status:200});
      if(options.fault==='challengeHeader') return Response.json(response.body,{status:402});
    }
    if(path.endsWith('/delivery') && response.status===200 && options.fault==='deliverySignature')
      return Response.json({...response.body,deliverySignature:'0x'+'11'.repeat(65)});
    return new Response(JSON.stringify(response.body), { status: response.status, headers: response.headers });
  };
  const decision: BuyerDecision = action === 'accept' ? { action, materialFailure: false, criterionIds: [], reason: 'The plan fulfills the purpose.', quotes: [] } :
    { action, materialFailure: true, criterionIds: ['actionability'], reason: 'No specific work is described.', quotes: ['Build awareness'] };
  const workflow = createBuyerWorkflow({ origin: config.origin, token: accessToken, signer: buyer, store: buyerStore,
    expectedSeller: options.discovery ? undefined : seller.address, fetcher, maxDeliveryAttempts: options.maxAttempts, model: { buyer: async () => { modelCalls += 1; return options.fault==='quoteFabricated' ? {...decision,quotes:['Not in the delivered text']} : decision; } } });
  return { workflow, advanceTime: (seconds: number) => { now += seconds * 1000; }, calls: () => ({settlements,modelCalls}) };
}
test('buyer executes SDK payment and signs an independently evaluated dispute', async () => {
  const f = fixture('dispute'), c = await f.workflow({ scenario: 'bad' });
  assert.equal(c.status, 'disputed'); assert.equal(c.mode, 'fixture'); assert.equal(c.payment?.verified, true);
  assert.ok(c.evidenceHash); assert.deepEqual(f.calls(), { settlements: 1, modelCalls: 1 });
  const repeated = await f.workflow({ scenario: 'bad', resume: c.agreement.orderId });
  assert.equal(repeated.id, c.id); assert.deepEqual(f.calls(), { settlements: 1, modelCalls: 1 });
});
test('a buyer may accept; the workflow cannot force a refund case', async () => {
  const f = fixture('accept'), c = await f.workflow({ scenario: 'good' });
  assert.equal(c.status, 'accepted'); assert.equal(c.court, null); assert.equal(c.evidenceHash, null);
});

test('a paid order resumes its durable original checkout after quote expiry without asking for a new challenge', async () => {
  const f = fixture('dispute'), c = await f.workflow({ scenario: 'bad' });
  f.advanceTime(1800);
  const resumed = await f.workflow({ scenario: 'bad', resume: c.agreement.orderId });
  assert.equal(resumed.id, c.id); assert.deepEqual(f.calls(), { settlements: 1, modelCalls: 1 });
});

test('service discovery fixes the seller and bounded price before any signatures', async () => {
  const f=fixture('accept',{discovery:true}),c=await f.workflow({scenario:'good'});
  assert.equal(c.status,'accepted');assert.equal(c.agreement.amount,'10000');
});
test('malformed quotes, incomplete checkout, and changed payment policy stop before settlement', async () => {
  for(const fault of ['quoteJSON','quoteLarge','wrongPrice','wrongBuyer','preparing','challengeStatus','challengeHeader']) {
    const f=fixture('dispute',{fault});
    await assert.rejects(f.workflow({scenario:'bad'}));assert.deepEqual(f.calls(),{settlements:0,modelCalls:0});
  }
});
test('a replaced delivery signature cannot be evaluated as the original signed answer', async () => {
  const f=fixture('dispute',{fault:'deliverySignature'});
  await assert.rejects(f.workflow({scenario:'bad'}),/INVALID_ORIGINAL_DELIVERY/);
  assert.deepEqual(f.calls(),{settlements:1,modelCalls:0});
});
test('invented buyer excerpts cannot be signed or admitted as evidence', async () => {
  const f=fixture('dispute',{fault:'quoteFabricated'});
  await assert.rejects(f.workflow({scenario:'bad'}),/INVALID_BUYER_QUOTE/);assert.equal(f.calls().modelCalls,1);
});
test('a pending payment keeps one authorization and cannot release an answer', async () => {
  const f=fixture('dispute',{pending:true,maxAttempts:1});
  await assert.rejects(f.workflow({scenario:'bad'}),/PAYMENT_CONFIRMATION_PENDING_USE_RESUME/);
  assert.deepEqual(f.calls(),{settlements:1,modelCalls:0});
});
test('a missing local quote cannot be replaced with a fresh paid order', async () => {
  const f=fixture('dispute');
  await assert.rejects(f.workflow({scenario:'bad',resume:'0x'+'12'.repeat(32)}),/LOCAL_QUOTE_MISSING/);
  assert.deepEqual(f.calls(),{settlements:0,modelCalls:0});
});
