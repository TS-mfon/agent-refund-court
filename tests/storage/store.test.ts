import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore, StorageConflict } from '../../src/storage/index.js';

test('create-only state chooses one winner and stale CAS cannot overwrite it', async () => {
  const store = new MemoryStateStore();
  const results = await Promise.allSettled([
    store.create('state/a.json', { revision: 0, answer: 'first' }),
    store.create('state/a.json', { revision: 0, answer: 'second' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof StorageConflict));
  const before = (await store.get<{revision:number;answer:string}>('state/a.json'))!;
  const after = await store.compareAndSwap('state/a.json', { ...before.value, revision: 1 }, before.etag);
  await assert.rejects(store.compareAndSwap('state/a.json', { revision: 2 }, before.etag), StorageConflict);
  assert.deepEqual(await store.get('state/a.json'), after);
  before.value.answer = 'mutated client copy';
  assert.equal((await store.get<{answer:string}>('state/a.json'))!.value.answer, 'first');
});
