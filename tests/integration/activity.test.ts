import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStateStore, type StateStore } from '../../src/storage/index.js';
import { type CaseManifest } from '../../src/domain/schema.js';
import { hashContent, paymentIdentity } from '../../src/domain/identity.js';
import { evidenceFixture } from '../court/fixture.js';

function fixture(process?: (caseId: string) => Promise<CaseManifest>, store: StateStore = new MemoryStateStore()) {
  let now = 1800000000000, purchases = 0;
  const config = { ...loadConfig({}), canWrite: true };
  const makeApp = () => createApp({ config, store, now: () => now, processCase: process,
    payments: { async process() { purchases += 1; throw new Error('Visitors cannot purchase'); },
      async recover() { throw new Error('Visitors cannot recover buyer purchases'); }, async getOrder() { return null; } },
    model: { async seller() { purchases += 1; throw new Error('Visitors cannot generate work'); }, async defense() { return ''; } } });
  return { store, config, app: makeApp(), makeApp, purchases: () => purchases, advance: (ms: number) => { now += ms; } };
}
async function seed(store: StateStore, overrides: Partial<CaseManifest> = {}) {
  const e = evidenceFixture();
  const nonce = hashContent(e.agreement.orderId);
  const payment = { ...e.payment, authorizationNonce: nonce };
  const id = paymentIdentity({ chainId: payment.chainId, token: payment.token, payer: payment.payer, nonce });
  const c: CaseManifest = { schemaVersion: 1, id, mode: 'fixture', status: 'disputed',
    createdAt: '2026-11-19T12:00:00.000Z', updatedAt: '2026-11-19T12:00:00.000Z',
    agreement: e.agreement, delivery: e.delivery, buyerClaim: e.buyerClaim, sellerDefense: e.sellerDefense,
    payment, court: null, refund: null, evidenceHash: hashContent({ ...e, payment, caseId: id }), events: [],
    provenance: { source: 'live', fixtureLabel: 'Fixture answer', disclosure: 'Processor is an explicit test double.' }, ...overrides };
  await store.create('cases/' + id + '.json', c);
  return c;
}

test('public catalog exposes both bounded services with disabled live capabilities when unconfigured', async () => {
  const app = createApp({ config: loadConfig({}), store: new MemoryStateStore() });
  const response = await request(app).get('/api/v1/services').expect(200);
  assert.deepEqual(response.body.services.map((service: { id: string }) => service.id), ['agent-work-v1', 'launch-plan-v1']);
  for (const service of response.body.services) {
    assert.equal(service.priceBaseUnits, '10000');
    assert.equal(service.network, 'eip155:84532');
    assert.equal(service.symbol, 'USDC');
    assert.deepEqual(service.capabilities, { purchase: false, generation: false });
    assert.equal(service.limits.briefBytes, 1200);
    assert.equal(service.limits.deliveryBytes, 3000);
    assert.equal(service.rubric.length, 3);
    assert.ok(service.title && service.description);
  }
});
test('catalog and discovery advertise the same enabled purchase and generation capabilities', async () => {
  const f = fixture();
  const discovery = (await request(f.app).get('/api/v1/service').expect(200)).body.service;
  const catalog = (await request(f.app).get('/api/v1/services').expect(200)).body.services;
  assert.deepEqual(discovery.capabilities, { purchase: true, generation: true });
  assert.ok(catalog.every((service: { capabilities: unknown }) => JSON.stringify(service.capabilities) === JSON.stringify(discovery.capabilities)));
  assert.equal(f.purchases(), 0);
});
test('public status describes disabled automation without exposing configuration or touching purchases', async () => {
  const app = createApp({ config: loadConfig({ DEMO_ACCESS_TOKEN: 'private-unit-test-token-value' }), store: new MemoryStateStore() });
  const response = await request(app).get('/api/v1/activity/status').expect(200);
  assert.equal(response.body.status, 'disabled');
  assert.equal(response.body.automation.enabled, false);
  assert.equal(JSON.stringify(response.body).includes('private-unit-test-token-value'), false);
  await request(app).post('/api/v1/activity/wake').send({}).expect(503);
});
test('a visitor wake advances one existing dispute and records durable safe activity metadata', async () => {
  let calls = 0;
  const f = fixture(async id => { calls += 1; return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  const c = await seed(f.store);
  const before = await request(f.app).get('/api/v1/activity/status').expect(200);
  assert.equal(before.body.pendingCases, 1); assert.equal(before.body.lastRunAt, null); assert.equal(calls, 0);
  const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(response.body.status, 'processed');
  assert.equal(response.body.caseId, c.id);
  assert.equal(response.body.automation.maxCasesPerWake, 1);
  assert.equal(calls, 1); assert.equal(f.purchases(), 0);
  const status = (await request(f.makeApp()).get('/api/v1/activity/status').expect(200)).body;
  assert.equal(status.lastWakeAt, '2027-01-15T08:00:00.000Z');
  assert.equal(status.lastRunAt, '2027-01-15T08:00:00.000Z');
  assert.equal(status.errorCode, null);
  const cooldown = (await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200)).body;
  assert.equal(cooldown.status, 'cooldown'); assert.equal(calls, 1);
  f.advance(60000);
  await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(calls, 2);
});
test('concurrent visitors across app instances share a single durable wake', async () => {
  let calls = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async id => { calls += 1; entered(); await gate; return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  await seed(f.store);
  const first = request(f.app).post('/api/v1/activity/wake').send({}).then(response => { assert.equal(response.status, 200); return response; });
  await Promise.race([started, first.then(() => { throw new Error('Expected an active worker step'); })]);
  const second = await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(second.body.status, 'cooldown'); assert.equal(calls, 1);
  const running = await request(f.makeApp()).get('/api/v1/activity/status').expect(200);
  assert.equal(running.body.status, 'running');
  release(); assert.equal((await first).status, 200); assert.equal(f.purchases(), 0);
});
test('wake never processes accepted, simulated, unpaid or terminal no-refund cases', async () => {
  let calls = 0;
  const f = fixture(async id => { calls += 1; return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  await seed(f.store, { status: 'accepted', buyerClaim: { action: 'accept', materialFailure: false, criterionIds: [], reason: 'Work satisfies the brief.', quotes: [] } });
  await seed(f.store, { mode: 'simulation', status: 'simulation', payment: null, court: null, refund: null, buyerClaim: null });
  await seed(f.store, { payment: { ...evidenceFixture().payment, verified: false } });
  await seed(f.store, { status: 'court_finalized', court: { network: 'studionet', contractAddress: evidenceFixture().agreement.courtAddress!,
    caseId: evidenceFixture().caseId, evidenceHash: hashContent('case'), transactionHash: hashContent('ruling'), status: 'finalized', verified: true,
    result: { decision: 'NO_REFUND', materialFailure: false, failedCriteria: [], reasoning: 'Work fulfills its purpose.' } } });
  const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(response.body.status, 'idle'); assert.equal(response.body.pendingCases, 0);
  assert.equal(calls, 0); assert.equal(f.purchases(), 0);
});
test('worker failures remain visible and redacted while a later wake can resume the existing job', async () => {
  let broken = true, calls = 0;
  const f = fixture(async id => { calls += 1; if (broken) throw new Error('PRIVATE_UPSTREAM_CREDENTIAL');
    return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  await seed(f.store);
  const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(response.body.status, 'failed'); assert.equal(response.body.errorCode, 'WORKER_STEP_FAILED');
  assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false);
  const recorded = (await request(f.makeApp()).get('/api/v1/activity/status').expect(200)).body;
  assert.equal(recorded.status, 'failed'); assert.equal(recorded.errorCode, 'WORKER_STEP_FAILED');
  broken = false; f.advance(60000);
  const resumed = await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(resumed.body.status, 'processed'); assert.equal(resumed.body.errorCode, null);
  assert.equal(calls, 2); assert.equal(f.purchases(), 0);
});
test('wake rejects foreign origins and arbitrary arguments before processing existing work', async () => {
  let calls = 0;
  const f = fixture(async id => { calls += 1; return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  await seed(f.store);
  await request(f.app).post('/api/v1/activity/wake').set('Origin', 'https://foreign.example').send({}).expect(403);
  await request(f.app).post('/api/v1/activity/wake').send({ buyer: evidenceFixture().agreement.buyer }).expect(400);
  assert.equal(calls, 0); assert.equal(f.purchases(), 0);
});
test('durable wake failures cannot silently process work without a recorded cooldown', async () => {
  let calls = 0;
  const store = new MemoryStateStore();
  const broken: StateStore = { get: path => store.get(path), list: (prefix, limit) => store.list(prefix, limit),
    compareAndSwap: (path, value, etag) => store.compareAndSwap(path, value, etag),
    async create() { throw new Error('PRIVATE_STORAGE_CREDENTIAL'); } };
  const f = fixture(async () => { calls += 1; throw new Error('No processing allowed'); }, broken);
  const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(503);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false); assert.equal(calls, 0);
});
test('round-robin wake lets a second existing dispute progress while the first remains pending', async () => {
  const observed: string[] = [];
  const f = fixture(async id => { observed.push(id); return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
  const cases = [await seed(f.store), await seed(f.store)];
  await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
  f.advance(60000);
  await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
  assert.equal(new Set(observed).size, 2);
  assert.deepEqual([...observed].sort(), cases.map(c => c.id).sort());
});

test('an interrupted wake retains its claim until expiry and resumes the existing dispute after expiry', async () => {
 let calls = 0;
 const f = fixture(async id => { calls += 1; return (await f.store.get<CaseManifest>('cases/' + id + '.json'))!.value; });
 const c = await seed(f.store);
 await f.store.create('activity/visitor-wake.json', { schemaVersion: 1, status: 'running',
  runId: '00000000-0000-4000-8000-000000000000', leaseExpiresAt: 1800000120000, nextWakeAt: 1800000060000,
  lastWakeAt: 1800000000000, lastRunAt: null, lastCaseId: c.id, errorCode: null });
 const held = await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200);
 assert.equal(held.body.status, 'cooldown'); assert.equal(held.body.retryAfterSeconds, 120); assert.equal(calls, 0);
 f.advance(120000);
 const interrupted = (await request(f.makeApp()).get('/api/v1/activity/status').expect(200)).body;
 assert.equal(interrupted.status, 'interrupted');
 const resumed = await request(f.makeApp()).post('/api/v1/activity/wake').send({}).expect(200);
 assert.equal(resumed.body.status, 'processed'); assert.equal(resumed.body.caseId, c.id); assert.equal(calls, 1);
});

test('invalid stored activity metadata fails closed before any worker action', async () => {
 let calls = 0;
 const f = fixture(async () => { calls += 1; throw new Error('Must not process'); });
 await seed(f.store);
 await f.store.create('activity/visitor-wake.json', { schemaVersion: 1, credential: 'PRIVATE_STORAGE_SECRET' });
 const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(503);
 assert.equal(response.body.error.code, 'ACTIVITY_STATE_UNAVAILABLE');
 assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false); assert.equal(calls, 0);
});

test('a wake response no longer counts its completed terminal case as pending', async () => {
 const f = fixture(async id => {
  const row = (await f.store.get<CaseManifest>('cases/' + id + '.json'))!;
  const next: CaseManifest = { ...row.value, status: 'unresolved' };
  await f.store.compareAndSwap('cases/' + id + '.json', next, row.etag);
  return next;
 });
 await seed(f.store);
 const response = await request(f.app).post('/api/v1/activity/wake').send({}).expect(200);
 assert.equal(response.body.pendingCases, 0);
 assert.equal((await request(f.app).get('/api/v1/activity/status').expect(200)).body.pendingCases, 0);
});
