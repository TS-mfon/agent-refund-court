import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore } from '../../src/storage/index.js';
import { createRefundStore, withRefundSignerLock } from '../../src/workflow/refund-store.js';
import { workerFixture } from '../refunds/worker-fixture.js';
import { runRefundWorker } from '../../src/refunds/worker.js';
test('durable refund adapter fences state with a real store ETag', async () => {
  const f = workerFixture(), store = new MemoryStateStore(), refunds = createRefundStore(store);
  const deps = { ...f.deps, store: refunds, withSignerLock: f.deps.withSignerLock,
    chain: { ...f.deps.chain, async broadcast(authorization: Parameters<typeof f.deps.chain.broadcast>[0]) {
      const persisted = await refunds.load(f.paymentId); assert.ok(persisted?.state.authorization);
      assert.equal(persisted.state.authorization.digest, authorization.digest);
      return ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    } } };
  const result = await runRefundWorker(f.paymentId, deps); assert.equal(result.status, 'BROADCAST');
  const row = await refunds.load(f.paymentId); assert.ok(row);
  assert.equal(await refunds.save(f.paymentId, null, row.state), false);
  assert.equal(await refunds.save(f.paymentId, row.revision, row.state), true);
});
test('distributed lock refuses a second caller and releases the exact owner', async () => {
  const store = new MemoryStateStore(), f = workerFixture(); let release: () => void = () => {};
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const first = withRefundSignerLock(store, f.eligible.from, async () => { await barrier; return 1; });
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(withRefundSignerLock(store, f.eligible.from, async () => 2), /SIGNER_LOCK_BUSY/);
  release(); assert.equal(await first, 1);
  assert.equal(await withRefundSignerLock(store, f.eligible.from, async () => 3), 3);
});
test('distributed lock releases after the protected operation fails', async () => {
  const store = new MemoryStateStore(), f = workerFixture();
  await assert.rejects(withRefundSignerLock(store, f.eligible.from, async () => { throw new Error('test operation failure'); }));
  assert.equal(await withRefundSignerLock(store, f.eligible.from, async () => 1), 1);
});

test('a signer guard rejects a lease near expiry and never releases another owner', async () => {
  const store=new MemoryStateStore(),f=workerFixture(),key='locks/refund-'+f.eligible.from.toLowerCase()+'.json';
  await withRefundSignerLock(store,f.eligible.from,async guard=>{
    await guard();const row=await store.get<{owner:string;expiresAt:number}>(key);assert.ok(row);
    await store.compareAndSwap(key,{...row.value,expiresAt:Date.now()+1000},row.etag);
    await assert.rejects(guard(),/SIGNER_LEASE_LOST/);
  });
  const row=await store.get<{owner:string|null;expiresAt:number}>(key);assert.equal(row?.value.owner,null);
  await withRefundSignerLock(store,f.eligible.from,async guard=>{
    const current=await store.get<{owner:string;expiresAt:number}>(key);assert.ok(current);
    await store.compareAndSwap(key,{owner:'replacement-owner',expiresAt:Date.now()+300000},current.etag);
    await assert.rejects(guard(),/SIGNER_LEASE_LOST/);
  });
  assert.equal((await store.get<{owner:string}>(key))?.value.owner,'replacement-owner');
});
