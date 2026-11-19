import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { BlobStateStore,StorageConflict } from '../../src/storage/index.js';
test('Blob adapter uses deterministic create, private fresh reads and conditional overwrite',async()=>{
  const calls:unknown[]=[];
  const transport={
    async put(key:string,body:string,options:unknown) { calls.push({key,body,options});return {etag:'new'}; },
    async get(key:string,options:unknown) {
      calls.push({key,options});
      return {statusCode:200,blob:{etag:'old',size:14},stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"revision":1}'));c.close();}})};
    },
    async list(options:unknown) {calls.push({options});return {blobs:[{pathname:'jobs/one.json'}],hasMore:false};},
  };
  const store=new BlobStateStore({token:'test-only',transport});
  await store.create('jobs/one.json',{revision:1});
  assert.deepEqual(calls[0],{key:'jobs/one.json',body:'{"revision":1}',options:{token:'test-only',access:'private',addRandomSuffix:false,contentType:'application/json',allowOverwrite:false}});
  assert.deepEqual(await store.get('jobs/one.json'),{value:{revision:1},etag:'old'});
  assert.deepEqual(calls[1],{key:'jobs/one.json',options:{token:'test-only',access:'private',useCache:false,headers:{'Accept-Encoding':'identity'}}});
  await store.compareAndSwap('jobs/one.json',{revision:2},'old');
  assert.deepEqual(calls[2],{key:'jobs/one.json',body:'{"revision":2}',options:{token:'test-only',access:'private',addRandomSuffix:false,contentType:'application/json',ifMatch:'old'}});
  assert.deepEqual(await store.list('jobs/'),['jobs/one.json']);
  transport.put=async()=>{throw new BlobPreconditionFailedError();};
  await assert.rejects(store.create('jobs/two.json',{}),StorageConflict);
  await assert.rejects(store.compareAndSwap('jobs/one.json',{},'old'),StorageConflict);
});
