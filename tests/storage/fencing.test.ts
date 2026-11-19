import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore,StorageConflict,acquireLease,commitArtifact,type FencedState } from '../../src/storage/index.js';
test('expired generator cannot commit after a new fence and winner artifact remains immutable',async()=>{
  const store=new MemoryStateStore();
  await store.create('state/a.json',{revision:0,fence:0,lease:null,artifactKey:null,status:'PAID'} satisfies FencedState);
  const old=await acquireLease(store,'state/a.json',{owner:'worker-one',now:1000,ttlMs:100});
  await assert.rejects(acquireLease(store,'state/a.json',{owner:'worker-two',now:1050,ttlMs:100}),StorageConflict);
  const fresh=await acquireLease(store,'state/a.json',{owner:'worker-two',now:1101,ttlMs:100});
  assert.equal(fresh.lease.generation,2);
  await assert.rejects(commitArtifact(store,'state/a.json',old,'deliveries/old.json',{text:'old'},1102),StorageConflict);
  await commitArtifact(store,'state/a.json',fresh,'deliveries/new.json',{text:'winner'},1102);
  assert.equal((await store.get<FencedState>('state/a.json'))!.value.artifactKey,'deliveries/new.json');
  await assert.rejects(store.create('deliveries/new.json',{text:'replacement'}),StorageConflict);
  await assert.rejects(acquireLease(store,'state/a.json',{owner:'worker-three',now:5000,ttlMs:100}),StorageConflict);
});
test('terminal operational refund invalidates a generation fence',async()=>{
  const store=new MemoryStateStore();
  await store.create('state/a.json',{revision:0,fence:0,lease:null,artifactKey:null,status:'PAID'} satisfies FencedState);
  const grant=await acquireLease(store,'state/a.json',{owner:'worker',now:1,ttlMs:100});
  const current=(await store.get<FencedState>('state/a.json'))!;
  await store.compareAndSwap('state/a.json',{...current.value,status:'OPERATIONAL_REFUND_APPROVED',fence:2,lease:null,revision:2},current.etag);
  await assert.rejects(commitArtifact(store,'state/a.json',grant,'deliveries/late.json',{text:'late'},2),StorageConflict);
});
