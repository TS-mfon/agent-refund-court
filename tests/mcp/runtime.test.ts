import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import { PayloadSchema } from '../../src/payments/context.js';
import { PaymentService } from '../../src/payments/service.js';
import { PaymentProofSchema } from '../../src/domain/schema.js';
import { hashContent } from '../../src/domain/identity.js';
import { createAgentRuntime } from '../../src/mcp/runtime.js';
import { MandateSchema } from '../../src/mcp/mandate.js';
function fixture(options: { pending?: boolean; budget?: string; quoteGate?: Promise<void>; preflightFaultOnce?: boolean; quoteOutcomeUnknown?: boolean } = {}) {
  const buyer = privateKeyToAccount(generatePrivateKey()), seller = privateKeyToAccount(generatePrivateKey()), store = new MemoryStateStore();
  const local = new MemoryStateStore(), origin = 'https://merchant.example';
  const config = { ...loadConfig({ SERVICE_ORIGIN: origin, SELLER_ADDRESS: seller.address,
    RECEIPT_SIGNER_PRIVATE_KEY: generatePrivateKey(), GENLAYER_CONTRACT: '0x'+'77'.repeat(20), BLOB_READ_WRITE_TOKEN: 'fixture' }), canWrite:true };
  let used = false, settlements = 0, paymentSignatures = 0, quotes = 0, preflightFailed = false;
  const payments = new PaymentService({ store, policy: { seller: seller.address, origin, amount: '10000' },
    facilitator: { verify: async () => ({ isValid: true }), settle: async context => {
      settlements += 1; used = !options.pending;
      return { success: true, network: 'eip155:84532', transaction: '0x'+'88'.repeat(32), payer: PayloadSchema.parse(context).payload.authorization.from };
    } },
    chainProof: { prove: async c => ({ authorizationUsed: used, proof: used ? PaymentProofSchema.parse({
      chainId:84532, network:'eip155:84532', token:c.agreement.token, payer:c.agreement.buyer, seller:seller.address, amount:'10000',
      authorizationNonce:c.payment.payload.authorization.nonce, transactionHash:'0x'+'88'.repeat(32), blockNumber:'100', blockHash:'0x'+'99'.repeat(32), verified:true,
    }) : null }) },
  });
  const app = createApp({ config, store, payments, model: {
    seller: async () => 'Build awareness. The requested deliverable was not supplied.',
    defense: async () => 'The seller maintains this response was useful.',
  } });
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/auth/challenge" && options.preflightFaultOnce && !preflightFailed) {
      preflightFailed = true; throw new Error("Transient preflight outage");
    }
    if (path === '/api/v1/orders') { quotes += 1; await options.quoteGate; }
    const method = (init?.method ?? 'GET').toLowerCase() as 'get'|'post';
    let req = request(app)[method](path);
    new Headers(init?.headers).forEach((value,name) => { req = req.set(name,value); });
    if (init?.body) req = req.send(JSON.parse(String(init.body)));
    const response = await req;
    if (path === "/api/v1/orders" && options.quoteOutcomeUnknown) throw new Error("Lost submitted quote response");
    return new Response(JSON.stringify(response.body), { status:response.status, headers:response.headers });
  };
  const signer = { ...buyer, async signTypedData(input: Parameters<typeof buyer.signTypedData>[0]) {
    if (input.primaryType === 'TransferWithAuthorization') paymentSignatures += 1;
    return buyer.signTypedData(input);
  } };
  const mandate = MandateSchema.parse({ allowedOrigins:[origin], maxPerPurchaseBaseUnits:'10000', dailyBudgetBaseUnits:options.budget ?? '20000' });
  const make = (wallet = signer) => createAgentRuntime({ signer:wallet, store:local, mandate, fetcher, maxDeliveryAttempts:1 });
  return { runtime:make(), make, local, buyer, origin, counts:()=>({quotes,settlements,paymentSignatures}) };
}
const brief = 'Write a concise implementation plan for my inventory reporting application.';
test('an independent wallet buys its own brief and submits its own material review without a model key', async () => {
  const f = fixture(), result = await f.runtime.purchase({ origin:f.origin, serviceId:'agent-work-v1', brief });
  assert.equal(result.case.status,'delivered');
  assert.equal(result.case.agreement.brief,brief);
  assert.equal(result.case.agreement.serviceId,'agent-work-v1');
  assert.equal(result.case.agreement.buyer,f.buyer.address);
  const reviewed = await f.runtime.review({ caseId:result.case.id, action:'dispute', materialFailure:true,
    criterionIds:['actionability'], reason:'The answer contains no implementation plan.', quotes:['Build awareness.'] });
  assert.equal(reviewed.status,'disputed');
  assert.ok(reviewed.evidenceHash);
  assert.deepEqual(f.counts(),{quotes:1,settlements:1,paymentSignatures:1});
  await f.make().resume(result.purchaseId);
  assert.deepEqual(f.counts(),{quotes:1,settlements:1,paymentSignatures:1});
});
test('a repeated task reuses its durable request, and another wallet cannot read or review the case', async () => {
  const f = fixture(), input = { origin:f.origin, serviceId:'agent-work-v1' as const, brief };
  const first = await f.runtime.purchase(input), second = await f.make().purchase(input);
  assert.equal(first.purchaseId,second.purchaseId);
  assert.equal(first.case.id,second.case.id);
  const other = f.make(privateKeyToAccount(generatePrivateKey()));
  await assert.rejects(other.getCase(first.case.id), /LOCAL_CASE_MISSING/);
  await assert.rejects(other.resume(first.purchaseId), /LOCAL_PURCHASE_MISSING/);
  await assert.rejects(other.review({caseId:first.case.id,action:'accept',materialFailure:false,criterionIds:[],reason:'Accepted',quotes:[]}), /LOCAL_CASE_MISSING/);
  assert.deepEqual(f.counts(),{quotes:1,settlements:1,paymentSignatures:1});
});
test('unknown payment outcomes reuse one nonce across restarts and retain the reserved budget', async () => {
  const f = fixture({ pending:true, budget:'10000' }), input = {origin:f.origin,serviceId:'agent-work-v1' as const,brief};
  const purchaseId = hashContent({wallet:f.buyer.address.toLowerCase(),...input});
  await assert.rejects(f.runtime.purchase(input), /PAYMENT_CONFIRMATION_PENDING_USE_RESUME/);
  await assert.rejects(f.make().resume(purchaseId), /PAYMENT_CONFIRMATION_PENDING_USE_RESUME/);
  await assert.rejects(f.runtime.purchase({...input,brief:brief+' Include a timeline.'}), /DAILY_BUDGET_EXCEEDED/);
  assert.equal(f.counts().paymentSignatures,1);
  assert.equal(f.counts().settlements,1);
});
test('concurrent processes cannot sign multiple checkouts while a quote outcome is unknown', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release=resolve;}), f = fixture({quoteGate:gate});
  const input = {origin:f.origin,serviceId:'agent-work-v1' as const,brief};
  const first = f.runtime.purchase(input); first.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,30));
  const second = f.make().purchase(input);
  release();
  const results = await Promise.allSettled([first,second]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(f.counts().paymentSignatures,1);
  assert.equal(f.counts().quotes,1);
});
test('unauthorized origins and multibyte oversized briefs cause no signatures or HTTP quotes', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.purchase({origin:'https://evil.example',serviceId:'agent-work-v1',brief}), /ORIGIN_NOT_AUTHORIZED/);
  await assert.rejects(f.runtime.purchase({origin:f.origin,serviceId:'agent-work-v1',brief:'é'.repeat(601)}));
  assert.deepEqual(f.counts(),{quotes:0,settlements:0,paymentSignatures:0});
});

test("a failed sign-in before quote submission remains retryable without a duplicate purchase", async () => {
  const f = fixture({preflightFaultOnce:true}), input = {origin:f.origin,serviceId:"agent-work-v1" as const,brief};
  await assert.rejects(f.runtime.purchase(input));
  assert.deepEqual(f.counts(),{quotes:0,settlements:0,paymentSignatures:0});
  const recovered = await f.make().purchase(input);
  assert.equal(recovered.case.status,"delivered");
  assert.deepEqual(f.counts(),{quotes:1,settlements:1,paymentSignatures:1});
});
test("an uncertain submitted quote retains its original identity and never starts another quote", async () => {
  const f = fixture({quoteOutcomeUnknown:true}), input = {origin:f.origin,serviceId:"agent-work-v1" as const,brief};
  await assert.rejects(f.runtime.purchase(input));
  await assert.rejects(f.make().purchase(input),/QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL/);
  assert.deepEqual(f.counts(),{quotes:1,settlements:0,paymentSignatures:0});
});
test("pending purchase failures expose only durable public recovery identifiers", async () => {
  const f = fixture({pending:true}), input = {origin:f.origin,serviceId:"agent-work-v1" as const,brief};
  const purchaseId = hashContent({wallet:f.buyer.address.toLowerCase(),...input});
  await assert.rejects(f.runtime.purchase(input), error => {
    assert.ok(error instanceof Error && "recovery" in error);
    const recovery = error.recovery as {purchaseId:string;orderId:string|null;caseId:string|null};
    assert.equal(recovery.purchaseId,purchaseId);
    assert.match(recovery.orderId!,/^0x[0-9a-f]{64}$/);
    assert.equal(recovery.caseId,null);
    assert.deepEqual(Object.keys(recovery).sort(),["caseId","orderId","purchaseId"]);
    return true;
  });
});
