import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobStateStore,type BlobTransport,StorageConflict } from '../../src/storage/index.js';
const raw='{"n":1}';
function transport(metadata?:{etag:string;size:number}):BlobTransport{
 return {get:async(_key,options)=>{
  assert.deepEqual(options.headers,{'Accept-Encoding':'identity'});
  return {statusCode:200,blob:{etag:'W/"old"',size:null},stream:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(raw));c.close();}})};
 },put:async()=>({etag:'"new"'}),list:async()=>({blobs:[],hasMore:false}),
 ...(metadata?{head:async()=>metadata}:{})};
}
test('compressed GET version can be used for CAS only with matching authoritative metadata',async()=>{
 const store=new BlobStateStore({transport:transport({etag:'"old"',size:7})});
 const row=await store.get<{n:number}>('orders/one.json');
 assert.deepEqual(row,{value:{n:1},etag:'"old"'});
 await store.compareAndSwap('orders/one.json',{n:2},row!.etag);
});
test('metadata race, wrong size, weak metadata and missing metadata fail closed',async()=>{
 for(const metadata of [undefined,{etag:'"new"',size:7},{etag:'"old"',size:8},{etag:'W/"old"',size:7}])
  await assert.rejects(new BlobStateStore({transport:transport(metadata)}).get('orders/one.json'));
});
test('caller weak ETags never reach the conditional write API',async()=>{
 let writes=0;
 const store=new BlobStateStore({transport:{...transport(),put:async()=>{writes+=1;return{etag:'"new"'};}}});
 await assert.rejects(store.compareAndSwap('orders/one.json',{n:2},'W/"old"'),StorageConflict);
 assert.equal(writes,0);
});
