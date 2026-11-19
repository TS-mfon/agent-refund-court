import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  createAgreement, hashContent, recordTypedData, checkoutTypedData,
} from '../../src/domain/identity.js';
import { SAMPLE_BRIEF, PaymentProofSchema } from '../../src/domain/schema.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import {
  prepareCheckout, createPaymentRequired,
  type PaymentContext,
} from '../../src/payments/index.js';
import {
  PaymentService, type ChainProofVerifier, type PaymentFacilitator,
} from '../../src/payments/service.js';

const tx = ('0x' + '91'.repeat(32)) as `0x${string}`;
const blockHash = ('0x' + '92'.repeat(32)) as `0x${string}`;

async function fixture() {
  const buyer = privateKeyToAccount(generatePrivateKey());
  const seller = privateKeyToAccount(generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const agreement = createAgreement({
    buyer: buyer.address, seller: seller.address,
    receiptSigner: seller.address, origin: 'http://127.0.0.1:3001',
    brief: SAMPLE_BRIEF, now,
  });
  const sellerSignature = await seller.signTypedData(
    recordTypedData('agreement', hashContent(agreement)),
  );
  const buyerAcceptance = await buyer.signTypedData(
    recordTypedData('acceptance', hashContent(agreement)),
  );
  const policy = {
    seller: seller.address, origin: agreement.origin, amount: agreement.amount,
  };
  const context = await prepareCheckout({
    agreement, sellerSignature, buyerAcceptance,
    required: createPaymentRequired(agreement),
    signer: buyer, store: new MemoryStateStore(), policy,
  });
  return { buyer, seller, policy, context };
}

function proof(context: PaymentContext) {
  return PaymentProofSchema.parse({
    chainId: 84532, network: 'eip155:84532',
    token: context.payment.accepted.asset,
    payer: context.agreement.buyer, seller: context.agreement.seller,
    amount: context.agreement.amount,
    authorizationNonce: context.payment.payload.authorization.nonce,
    transactionHash: tx, blockNumber: '123', blockHash, verified: true,
  });
}

function harness(context: PaymentContext) {
  let confirmed = false;
  let verificationCalls = 0;
  let settlementCalls = 0;
  let settleFailure = false;
  let observedPayload: unknown;
  const chainProof: ChainProofVerifier = {
    async prove(original) {
      return {
        authorizationUsed: confirmed,
        proof: confirmed ? proof(original) : null,
      };
    },
  };
  const facilitator: PaymentFacilitator = {
    async verify(payload) {
      verificationCalls += 1;
      observedPayload = payload;
      return { isValid: true, payer: context.agreement.buyer };
    },
    async settle(payload) {
      settlementCalls += 1;
      observedPayload = payload;
      if (settleFailure) throw new Error('Simulated lost settlement response');
      confirmed = true;
      return {
        success: true, transaction: tx,
        network: 'eip155:84532', payer: context.agreement.buyer,
      };
    },
  };
  return {
    facilitator, chainProof,
    confirm() { confirmed = true; },
    failSettlement() { settleFailure = true; },
    calls() { return { verificationCalls, settlementCalls, observedPayload }; },
  };
}

test('settles the exact saved SDK authorization once and returns confirmed proof', async () => {
  const f = await fixture();
  const h = harness(f.context);
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy, ...h,
  });
  const first = await service.process(f.context);
  const repeated = await service.process(f.context);

  assert.equal(first.state, 'paid');
  assert.deepEqual(first.proof, proof(f.context));
  assert.deepEqual(repeated, first);
  assert.deepEqual(h.calls(), {
    verificationCalls: 1, settlementCalls: 1,
    observedPayload: f.context.payment,
  });
  assert.deepEqual((await service.getOrder(first.orderId))?.context, f.context);
});

test('concurrent requests cannot execute duplicate verification or settlement', async () => {
  const f = await fixture();
  const h = harness(f.context);
  const store = new MemoryStateStore();
  const one = new PaymentService({ store, policy: f.policy, ...h });
  const two = new PaymentService({ store, policy: f.policy, ...h });

  await Promise.all([one.process(f.context), two.process(f.context)]);
  assert.equal(h.calls().verificationCalls, 1);
  assert.equal(h.calls().settlementCalls, 1);
  assert.equal((await one.recover(f.context)).state, 'paid');
});

test('lost settlement response recovers original proof without another facilitator call', async () => {
  const f = await fixture();
  const h = harness(f.context);
  h.failSettlement();
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy, ...h,
  });

  assert.equal((await service.process(f.context)).state, 'pending');
  assert.equal((await service.process(f.context)).state, 'pending');
  assert.equal(h.calls().settlementCalls, 1);

  h.confirm();
  const recovered = await service.recover(f.context);
  assert.equal(recovered.state, 'paid');
  assert.deepEqual(recovered.context, f.context);
  assert.equal(recovered.proof?.authorizationNonce,
    f.context.payment.payload.authorization.nonce);
  assert.equal(h.calls().verificationCalls, 1);
  assert.equal(h.calls().settlementCalls, 1);
});

test('modified checkout is rejected before reservation or facilitator access', async () => {
  const f = await fixture();
  const h = harness(f.context);
  const store = new MemoryStateStore();
  const service = new PaymentService({ store, policy: f.policy, ...h });
  const bad = {
    ...f.context,
    checkout: { ...f.context.checkout, orderId: '0x' + '11'.repeat(32) },
  };

  await assert.rejects(service.process(bad));
  assert.deepEqual(await store.list('payments/'), []);
  assert.equal(h.calls().verificationCalls, 0);
  assert.equal(h.calls().settlementCalls, 0);
});

test('a buyer cannot bind the same authorization to a second signed order', async () => {
  const f = await fixture();
  const h = harness(f.context);
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy, ...h,
  });
  await service.process(f.context);

  const orderId = ('0x' + '44'.repeat(32)) as `0x${string}`;
  const agreement = {
    ...f.context.agreement, orderId,
    resource: f.policy.origin + '/api/v1/orders/' + orderId + '/delivery',
  };
  const payment = {
    ...f.context.payment,
    resource: { ...f.context.payment.resource, url: agreement.resource },
  };
  const checkout = {
    ...f.context.checkout, orderId,
    agreementHash: hashContent(agreement),
    resourceHash: hashContent(agreement.resource),
  };
  const second = {
    ...f.context, agreement, payment, checkout,
    sellerSignature: await f.seller.signTypedData(
      recordTypedData('agreement', hashContent(agreement)),
    ),
    buyerAcceptance: await f.buyer.signTypedData(
      recordTypedData('acceptance', hashContent(agreement)),
    ),
    checkoutSignature: await f.buyer.signTypedData(checkoutTypedData(checkout)),
  };

  await assert.rejects(
    service.process(second),
    (error: unknown) => error instanceof Error &&
      'code' in error && error.code === 'PAYMENT_CONTEXT_CONFLICT',
  );
  assert.equal(h.calls().settlementCalls, 1);
});

test('an unverified or foreign chain proof never releases delivery', async () => {
  const f = await fixture();
  let settlements = 0;
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy,
    facilitator: {
      async verify() { return { isValid: true }; },
      async settle() { settlements += 1; return { success: false }; },
    },
    chainProof: {
      async prove() {
        return {
          authorizationUsed: true,
          proof: { ...proof(f.context), authorizationNonce:
            ('0x' + '77'.repeat(32)) as `0x${string}` },
        };
      },
    },
  });

  assert.equal((await service.process(f.context)).state, 'pending');
  assert.equal(settlements, 0);
});

test('verification rejection cannot reach settlement', async () => {
  const f = await fixture();
  let settlements = 0;
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy,
    facilitator: {
      async verify() { return { isValid: false, invalidReason: 'invalid_signature' }; },
      async settle() { settlements += 1; return { success: false }; },
    },
    chainProof: {
      async prove() { return { authorizationUsed: false, proof: null }; },
    },
  });

  assert.equal((await service.process(f.context)).state, 'rejected');
  assert.equal((await service.process(f.context)).state, 'rejected');
  assert.equal(settlements, 0);
});
test('retries a transient verification failure with the same original authorization and one settlement', async () => {
  const f = await fixture(), h = harness(f.context);
  const verify = h.facilitator.verify;
  let attempts = 0;
  const facilitator: PaymentFacilitator = {
    ...h.facilitator,
    async verify(payment, requirements) {
      attempts += 1;
      if (attempts === 1) throw new Error('Simulated verification timeout');
      return verify(payment, requirements);
    },
  };
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy,
    facilitator, chainProof: h.chainProof,
  });
  assert.equal((await service.process(f.context)).state, 'pending');
  assert.equal(h.calls().settlementCalls, 0);
  const retried = await service.process(f.context);
  assert.equal(retried.state, 'paid');
  assert.deepEqual(retried.context, f.context);
  assert.equal(attempts, 2);
  assert.equal(h.calls().settlementCalls, 1);
  assert.equal((await service.process(f.context)).state, 'paid');
  assert.equal(attempts, 2);
  assert.equal(h.calls().settlementCalls, 1);
});
test('checks the original authorization on chain before retrying verification', async () => {
  const f = await fixture(), h = harness(f.context);
  let attempts = 0, chainAvailable = true;
  const verify = h.facilitator.verify;
  const service = new PaymentService({
    store: new MemoryStateStore(), policy: f.policy,
    facilitator: {
      ...h.facilitator,
      async verify(payment, requirements) {
        attempts += 1;
        if (attempts === 1) throw new Error('Simulated verification timeout');
        return verify(payment, requirements);
      },
    },
    chainProof: {
      async prove(context, hint) {
        if (!chainAvailable) throw new Error('Simulated RPC outage');
        return h.chainProof.prove(context, hint);
      },
    },
  });
  assert.equal((await service.process(f.context)).state, 'pending');
  chainAvailable = false;
  const paused = await service.process(f.context);
  assert.equal(paused.code, 'CHAIN_UNAVAILABLE');
  assert.equal(attempts, 1);
  assert.equal(h.calls().settlementCalls, 0);
  chainAvailable = true;
  assert.equal((await service.process(f.context)).state, 'paid');
  assert.equal(attempts, 2);
  assert.equal(h.calls().settlementCalls, 1);
});

for (const outcome of ['paid', 'pending'] as const) {
  test('late verification failure preserves concurrently recovered ' + outcome + ' state', async () => {
    const f = await fixture(), store = new MemoryStateStore();
    let enter: () => void = () => {};
    let rejectVerification: (reason?: unknown) => void = () => {};
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const verification = new Promise<unknown>((_resolve, reject) => {
      rejectVerification = reject;
    });
    let authorizationUsed = false, settlements = 0;
    const options = {
      store, policy: f.policy,
      facilitator: {
        async verify() {
          enter();
          return verification;
        },
        async settle() {
          settlements += 1;
          return { success: false };
        },
      },
      chainProof: {
        async prove(context: PaymentContext) {
          return {
            authorizationUsed,
            proof: authorizationUsed && outcome === 'paid' ? proof(context) : null,
          };
        },
      },
    };
    const one = new PaymentService(options), two = new PaymentService(options);
    const first = one.process(f.context);
    await entered;
    authorizationUsed = true;
    const recovered = await two.recover(f.context);
    assert.equal(recovered.state, outcome);
    rejectVerification(new Error('Simulated late verification timeout'));
    assert.deepEqual(await first, recovered);
    assert.deepEqual(await two.getOrder(f.context.agreement.orderId), recovered);
    assert.equal(settlements, 0);
  });
}
