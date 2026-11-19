import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobError } from '@vercel/blob';
import { BlobStateStore,StorageConflict,type BlobTransport } from '../../src/storage/index.js';
function transport(overrides:Partial<BlobTransport>={}):BlobTransport{
 return {get:async()=>null,put:async()=>({etag:'new'}),list:async()=>({blobs:[],hasMore:false}),...overrides};
}
test('real SDK duplicate-create error becomes a storage conflict while unrelated failures stay failures',async()=>{
 const duplicate=new BlobError('This blob already exists, use allowOverwrite to replace it.');
 const store=new BlobStateStore({transport:transport({put:async()=>{throw duplicate;}})});
 await assert.rejects(store.create('orders/one.json',{n:1}),StorageConflict);
 const outage=new BlobError('Storage authentication unavailable');
 const unavailable=new BlobStateStore({transport:transport({put:async()=>{throw outage;}})});
 await assert.rejects(unavailable.create('orders/one.json',{n:1}),e=>e===outage);
 await assert.rejects(store.compareAndSwap('orders/one.json',{n:2},'old'),e=>e===duplicate);
});
test('fresh private read refuses oversized, invalid UTF-8 and stale responses',async()=>{
 for(const value of [
  {statusCode:304,blob:{etag:'old',size:1},stream:null},
  {statusCode:200,blob:{etag:'old',size:65537},stream:new ReadableStream()},
  {statusCode:200,blob:{etag:'old',size:null},stream:new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close();}})},
  {statusCode:200,blob:{etag:'old',size:null},stream:new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));c.close();}})},
 ])await assert.rejects(new BlobStateStore({transport:transport({get:async()=>value})}).get('orders/one.json'));
 assert.equal(await new BlobStateStore({transport:transport()}).get('orders/one.json'),null);
});
test('private list rejects escaped namespaces and broken pagination',async()=>{
 await assert.rejects(new BlobStateStore({transport:transport({list:async()=>({blobs:[{pathname:'elsewhere/one.json'}],hasMore:false})})}).list('orders/'));
 await assert.rejects(new BlobStateStore({transport:transport({list:async()=>({blobs:[],hasMore:true})})}).list('orders/'));
 const store=new BlobStateStore({transport:transport()});
 await assert.rejects(store.create('../escape.json',{}));
 await assert.rejects(store.compareAndSwap('orders/one.json',{},''));
 await assert.rejects(store.create('orders/one.json',undefined));
});
