import { loadPrivateEnvironment } from './private-config.js';
import { BlobStateStore } from '../src/storage/index.js';
import { HashSchema } from '../src/domain/schema.js';
import { createPublicClient,http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { refundTransferCall } from '../src/refunds/authorization.js';
import type { SignedRefundAuthorization } from '../src/refunds/types.js';
async function main(){
 const id=HashSchema.parse(process.argv[2]),env=await loadPrivateEnvironment();
 const state=await new BlobStateStore({token:env.BLOB_READ_WRITE_TOKEN}).get<{status:string;errorCode:string|null;transactionHashes:string[];authorization:SignedRefundAuthorization|null}>('refunds/'+id+'.json');
 if(!state){console.log('No refund state');return;}
 const s=state.value;
 console.log(JSON.stringify({caseId:id,status:s.status,errorCode:s.errorCode,transactionHashes:s.transactionHashes,authorizationPrepared:!!s.authorization,validBefore:s.authorization?.validBefore}));
 if(s.authorization){
  const client=createPublicClient({chain:baseSepolia,transport:http(env.BASE_RPC_URL,{timeout:10000,retryCount:0})});
  try{await client.simulateContract({...refundTransferCall(s.authorization),account:s.authorization.from});
   console.log(JSON.stringify({simulation:'success'}));
  }catch(error){
   const e=error as {name?:string;shortMessage?:string};
   console.log(JSON.stringify({simulation:'failed',type:e.name,reason:e.shortMessage?.slice(0,500)}));
  }
 }
}
main().then(()=>process.exit(0)).catch(()=>{console.error('Refund inspection failed without exposing credentials.');process.exit(1);});
