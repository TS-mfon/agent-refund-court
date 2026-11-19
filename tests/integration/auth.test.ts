import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadConfig } from '../../src/config.js';
import { MemoryStateStore, StorageConflict, type StateStore } from '../../src/storage/index.js';
import { createApp } from '../../src/server/app.js';
import { hashContent, recordTypedData } from '../../src/domain/identity.js';
import { SAMPLE_BRIEF } from '../../src/domain/schema.js';

function fixture(store: StateStore = new MemoryStateStore()) {
  const buyer = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  const seller = privateKeyToAccount(generatePrivateKey()), receiptKey = generatePrivateKey();
  const config = { ...loadConfig({ SELLER_ADDRESS: seller.address, RECEIPT_SIGNER_PRIVATE_KEY: receiptKey,
    GENLAYER_CONTRACT: '0x' + '22'.repeat(20), BLOB_READ_WRITE_TOKEN: 'unit-test-blob' }), canWrite: true };
  let time = 1800000000000;
  const makeApp = (configuration = config) => createApp({ config: configuration, store, now: () => time,
    payments: { async process() { throw new Error('No payment expected'); }, async recover() { throw new Error('No payment expected'); }, async getOrder() { return null; } },
    model: { async seller() { throw new Error('Generation must follow payment'); }, async defense() { return 'Defense'; } } });
  return { buyer, other, config, store, app: makeApp(), makeApp, advance: (ms: number) => { time += ms; } };
}

async function signIn(f: ReturnType<typeof fixture>, account = f.buyer) {
  const created = await request(f.app).post('/api/v1/auth/challenge').send({ address: account.address }).expect(201);
  const challenge = created.body.challenge;
  const signature = await account.signMessage({ message: challenge.message });
  const authenticated = await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(201);
  return { challenge, signature, session: authenticated.body.session, header: 'Bearer ' + authenticated.body.session.accessToken };
}

test('a buyer signs in with its own wallet and receives an expiring session without an operator token', async () => {
  const f = fixture(), signed = await signIn(f);
  assert.equal(f.config.accessToken, null);
  assert.equal(signed.session.address, f.buyer.address);
  assert.match(signed.session.accessToken, /^arc_[A-Za-z0-9_-]{43}$/);
  assert.equal(signed.challenge.expiresAt, 1800000300);
  assert.equal(signed.session.expiresAt, 1800001800);
  assert.match(signed.challenge.message, /URI: http:\/\/127\.0\.0\.1:3001/);
  assert.match(signed.challenge.message, /Chain ID: 84532/);
  assert.ok(signed.challenge.message.includes(f.buyer.address));
  assert.ok(signed.challenge.message.includes(signed.challenge.id));
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF }).expect(201);
  await request(f.app).get('/api/v1/orders/' + created.body.order.agreement.orderId).set('Authorization', signed.header).expect(200);
});

test('sign-in proof rejects another wallet and a message altered to another origin or network', async () => {
  const f = fixture();
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  for (const signature of [
    await f.other.signMessage({ message: challenge.message }),
    await f.buyer.signMessage({ message: challenge.message.replace(f.config.origin, 'https://evil.example') }),
    await f.buyer.signMessage({ message: challenge.message.replace('Chain ID: 84532', 'Chain ID: 1') }),
    '0x' + '00'.repeat(65),
  ]) {
    const rejected = await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(401);
    assert.equal(rejected.body.session, undefined);
  }
  const signature = await f.buyer.signMessage({ message: challenge.message });
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(201);
});

test('consumed and expired challenges cannot mint another session', async () => {
  const f = fixture(), signed = await signIn(f);
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: signed.challenge.id, signature: signed.signature }).expect(401);
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  const signature = await f.buyer.signMessage({ message: challenge.message });
  f.advance(300000);
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(401);
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: '00'.repeat(32), signature }).expect(401);
});

test('concurrent uses of one wallet proof mint exactly one session', async () => {
  const f = fixture();
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  const signature = await f.buyer.signMessage({ message: challenge.message });
  const responses = await Promise.all([0, 1].map(() => request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 401]);
  assert.equal(responses.filter(r => r.body.session?.accessToken).length, 1);
});

test('wallet sessions survive a server restart and expire at their recorded boundary', async () => {
  const f = fixture(), signed = await signIn(f);
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ brief: SAMPLE_BRIEF }).expect(201);
  const path = '/api/v1/orders/' + created.body.order.agreement.orderId;
  await request(f.makeApp()).get(path).set('Authorization', signed.header).expect(200);
  f.advance(1800000);
  const response = await request(f.makeApp()).get(path).set('Authorization', signed.header).expect(401);
  assert.equal(response.headers['www-authenticate'], 'Bearer');
  await request(f.app).get(path).set('Authorization', 'Bearer arc_' + 'a'.repeat(43)).expect(401);
  await request(f.app).get(path).set('Authorization', signed.header + 'x'.repeat(1024)).expect(401);
});

test('a wallet session cannot quote, read, accept, pay, or decide another buyer order', async () => {
  const f = fixture(), owner = await signIn(f), other = await signIn(f, f.other);
  await request(f.app).post('/api/v1/orders').set('Authorization', other.header).send({ buyer: f.buyer.address, brief: SAMPLE_BRIEF }).expect(404);
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', owner.header).send({ brief: SAMPLE_BRIEF }).expect(201);
  const order = created.body.order, path = '/api/v1/orders/' + order.agreement.orderId;
  const buyerAcceptance = await f.buyer.signTypedData(recordTypedData('acceptance', hashContent(order.agreement)));
  await request(f.app).get(path).set('Authorization', other.header).expect(404);
  await request(f.app).post(path + '/acceptance').set('Authorization', other.header).send({ buyerAcceptance }).expect(404);
  await request(f.app).get(path + '/delivery').set('Authorization', other.header).expect(404);
  await request(f.app).post(path + '/decision').set('Authorization', other.header).send({}).expect(404);
  await request(f.app).post(path + '/acceptance').set('Authorization', owner.header).send({ buyerAcceptance }).expect(200);
  await request(f.app).get(path + '/delivery').set('Authorization', owner.header).expect(402);
});

test('sign-in routes enforce origin and bounded strict inputs without issuing credentials', async () => {
  const f = fixture();
  await request(f.app).post('/api/v1/auth/challenge').set('Origin', 'https://evil.example').send({ address: f.buyer.address }).expect(403);
  await request(f.app).post('/api/v1/auth/challenge').send({ address: 'invalid' }).expect(400);
  await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address, network: 'eip155:1' }).expect(400);
  await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address, padding: 'x'.repeat(2100) }).expect(413);
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: '../private', signature: '0x' + '00'.repeat(65) }).expect(400);
  const signed = await signIn(f);
  await request(f.app).post('/api/v1/auth/session').set('Origin', 'https://evil.example').send({ challengeId: signed.challenge.id, signature: signed.signature }).expect(403);
  await request(f.app).get('/api/v1/orders/' + '0x' + '11'.repeat(32)).set('Authorization', signed.header).set('Origin', 'https://evil.example').expect(403);
  const disabled = f.makeApp({ ...f.config, canWrite: false });
  await request(disabled).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(503);
  await request(disabled).post('/api/v1/auth/session').send({ challengeId: signed.challenge.id, signature: signed.signature }).expect(503);
});

test('wallet sign-in quotas are durable across instances and reset after their window', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++)
    await request(i % 2 ? f.app : f.makeApp()).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201);
  const blocked = await request(f.makeApp()).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(429);
  assert.equal(blocked.headers['retry-after'], '60');
  await request(f.app).post('/api/v1/auth/challenge').send({ address: f.other.address }).expect(201);
  f.advance(60000);
  await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201);
});

test('an IP cannot evade the onboarding quota by rotating wallets or forwarded headers', async () => {
  const f = fixture();
  for (let i = 1; i <= 20; i++)
    await request(f.makeApp()).post('/api/v1/auth/challenge').set('X-Forwarded-For', '192.0.2.' + i).send({ address: '0x' + i.toString(16).padStart(40, '0') }).expect(201);
  await request(f.app).post('/api/v1/auth/challenge').set('X-Forwarded-For', '192.0.2.99').send({ address: f.buyer.address }).expect(429);
});

test('failed sign-in attempts consume wallet quota without consuming a valid ownership proof', async () => {
  const f = fixture();
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  const wrong = await f.other.signMessage({ message: challenge.message });
  for (let i = 0; i < 10; i++)
    await request(f.makeApp()).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature: wrong }).expect(401);
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature: wrong }).expect(429);
  f.advance(60000);
  const signature = await f.buyer.signMessage({ message: challenge.message });
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(201);
});

test('session credentials are hashed in private storage and corruption cannot authenticate', async () => {
  const f = fixture(), signed = await signIn(f);
  const keys = await f.store.list('auth/sessions/');
  assert.equal(keys.length, 1);
  assert.equal(keys[0], 'auth/sessions/' + createHash('sha256').update(signed.session.accessToken).digest('hex') + '.json');
  const saved = await f.store.get<any>(keys[0]);
  assert.equal(JSON.stringify(saved).includes(signed.session.accessToken), false);
  await f.store.compareAndSwap(keys[0], { ...saved!.value, origin: 'https://elsewhere.example' }, saved!.etag);
  await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ brief: SAMPLE_BRIEF }).expect(401);
});

test('sign-in fails closed when durable storage or nonce compare-and-swap fails', async () => {
  const inner = new MemoryStateStore();
  const storage: StateStore = {
    get: key => inner.get(key), list: (prefix, limit) => inner.list(prefix, limit),
    create: (key, value) => inner.create(key, value),
    compareAndSwap: async (key, value, etag) => {
      if (key.startsWith('auth/challenges/')) throw new StorageConflict(key);
      return inner.compareAndSwap(key, value, etag);
    },
  };
  const f = fixture(storage);
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  const signature = await f.buyer.signMessage({ message: challenge.message });
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(401);
  const unavailable = fixture({ ...storage, async get() { throw new Error('upstream credential headers'); } });
  const response = await request(unavailable.app).post('/api/v1/auth/challenge').send({ address: unavailable.buyer.address }).expect(503);
  assert.equal(JSON.stringify(response.body).includes('credential'), false);
});

test('metadata describes public wallet onboarding and custom work quotes bind the requested service', async () => {
  const f = fixture(), signed = await signIn(f);
  const metadata = (await request(f.app).get('/api/v1/service').expect(200)).body.service;
  assert.equal(metadata.id, 'agent-work-v1');
  assert.equal(metadata.authentication.method, 'eip191');
  assert.equal(metadata.authentication.limits.challengeTtlSeconds, 300);
  assert.equal(metadata.authentication.limits.sessionTtlSeconds, 1800);
  const created = await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ serviceId: 'agent-work-v1', brief: 'Compare the practical tradeoffs of SQLite and Postgres for a small scheduling app.' }).expect(201);
  assert.equal(created.body.order.agreement.serviceId, 'agent-work-v1');
  assert.equal(created.body.order.agreement.rubricId, 'agent-work-v1');
  assert.equal(created.body.order.agreement.buyer, f.buyer.address);
  await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ serviceId: 'agent-work-v1' }).expect(400);
  await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ serviceId: 'unsupported', brief: 'Example' }).expect(400);
  await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ serviceId: 'agent-work-v1', brief: '   ' }).expect(400);
});

test('a proof that expires during durable consumption cannot issue a session', async () => {
  const inner = new MemoryStateStore();
  const storage: StateStore = {
    get: key => inner.get(key), list: (prefix, limit) => inner.list(prefix, limit),
    create: (key, value) => inner.create(key, value),
    compareAndSwap: async (key, value, etag) => {
      if (key.startsWith('auth/challenges/')) f.advance(300000);
      return inner.compareAndSwap(key, value, etag);
    },
  };
  const f = fixture(storage);
  const challenge = (await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201)).body.challenge;
  const signature = await f.buyer.signMessage({ message: challenge.message });
  await request(f.app).post('/api/v1/auth/session').send({ challengeId: challenge.id, signature }).expect(401);
});

test('daily wallet onboarding quotas persist across minute windows and report the remaining wait', async () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) {
    await request(f.makeApp()).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201);
    f.advance(60000);
  }
  const limited = await request(f.makeApp()).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(429);
  const wait = Number(limited.headers['retry-after']);
  assert.ok(wait > 60 && wait <= 86400);
  f.advance(wait * 1000);
  await request(f.app).post('/api/v1/auth/challenge').send({ address: f.buyer.address }).expect(201);
});

test('a session signed for another service deployment cannot cross the configured origin boundary', async () => {
  const f = fixture(), signed = await signIn(f);
  const otherApp = f.makeApp({ ...f.config, origin: 'https://another.example' });
  await request(otherApp).post('/api/v1/orders').set('Authorization', signed.header).send({ brief: SAMPLE_BRIEF }).expect(401);
});

test('a quote rejects a blank custom brief before asking the buyer to pay', async () => {
  const f = fixture(), signed = await signIn(f);
  await request(f.app).post('/api/v1/orders').set('Authorization', signed.header).send({ brief: '   ' }).expect(400);
});
