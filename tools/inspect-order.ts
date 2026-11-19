import { loadPrivateEnvironment } from './private-config.js';
import { BlobStateStore } from '../src/storage/index.js';
import { HashSchema } from '../src/domain/schema.js';
async function main(){
 const id=HashSchema.parse(process.argv[2]),env=await loadPrivateEnvironment();
 const r=await fetch(env.SERVICE_ORIGIN+'/api/v1/orders/'+id,{headers:{Authorization:'Bearer '+env.DEMO_ACCESS_TOKEN},signal:AbortSignal.timeout(20000)});
 const body=await r.json() as {order?:Record<string,unknown>;error?:{code?:string}};
 const o=body.order;
 const stored=await new BlobStateStore({token:env.BLOB_READ_WRITE_TOKEN}).get('orders/'+id+'.json');
 console.log(JSON.stringify({orderBlobETag:stored?.etag,orderBytes:stored?Buffer.byteLength(JSON.stringify(stored.value)):null}));
 console.log(JSON.stringify({status:r.status,code:body.error?.code,orderId:id,phase:o?.phase,buyerAccepted:!!o?.buyerAcceptance,caseId:o?.caseId,paymentVerified:!!o?.payment,delivered:!!o?.delivery}));
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Order inspection failed.');process.exit(1);});
