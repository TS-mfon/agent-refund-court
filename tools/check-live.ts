import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient,http,parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { loadConfig } from '../src/config.js';
import { USDC_ADDRESS } from '../src/domain/schema.js';
import { BlobStateStore,StorageConflict } from '../src/storage/index.js';
let phase='configuration';
async function main(){
 const config=loadConfig(),wallets=JSON.parse(await readFile(join(homedir(),'.config','agent-refund-court','wallets.json'),'utf8'));
 if(!process.argv.includes('--blob-only')){
 const base=createPublicClient({chain:baseSepolia,transport:http(config.baseRpc,{timeout:10000,retryCount:0})});
 phase='base';
 assert.equal(await base.getChainId(),84532);
 const abi=parseAbi(['function decimals() view returns(uint8)','function name() view returns(string)','function version() view returns(string)','function balanceOf(address) view returns(uint256)']);
 const [decimals,name,version,buyerUSDC,sellerUSDC,sellerGas]=await Promise.all([
  base.readContract({address:USDC_ADDRESS,abi,functionName:'decimals'}),
  base.readContract({address:USDC_ADDRESS,abi,functionName:'name'}),
  base.readContract({address:USDC_ADDRESS,abi,functionName:'version'}),
  base.readContract({address:USDC_ADDRESS,abi,functionName:'balanceOf',args:[wallets.buyer.address]}),
  base.readContract({address:USDC_ADDRESS,abi,functionName:'balanceOf',args:[wallets.seller.address]}),
  base.getBalance({address:wallets.seller.address}),
 ]);
 assert.equal(decimals,6);assert.equal(name,'USDC');assert.equal(version,'2');
 assert.ok(buyerUSDC>=BigInt(config.price));assert.ok(sellerGas>=1000000000000n);
 console.log(JSON.stringify({check:'Base Sepolia',passed:true,decimals,name,version,buyerUSDC:buyerUSDC.toString(),sellerUSDC:sellerUSDC.toString(),sellerGasWei:sellerGas.toString()}));
 phase='facilitator';
 const facilitator=new HTTPFacilitatorClient({url:config.facilitator,timeoutMs:15000});
 const supported=await facilitator.getSupported();assert.ok(supported.kinds.some(k=>k.network==='eip155:84532'&&k.scheme==='exact'));
 console.log(JSON.stringify({check:'x402 facilitator',passed:true}));
 phase='court';
 assert.ok(config.courtAddress);
 const court=createClient({chain:{...studionet,rpcUrls:{...studionet.rpcUrls,default:{http:[config.courtRpc??'https://studio.genlayer.com/api']}}}});
 const courtConfig=await court.readContract({address:config.courtAddress,functionName:'get_config',args:[],jsonSafeReturn:true,transactionHashVariant:TransactionHashVariant.LATEST_FINAL}) as Record<string,unknown>;
 assert.equal(courtConfig.network,'studionet');assert.equal(courtConfig.rubricVersion,'launch-plan-v1');
 console.log(JSON.stringify({check:'GenLayer court',passed:true,contract:config.courtAddress}));
 }
 phase='blob';
 const store=new BlobStateStore(config.blobToken?{token:config.blobToken}:{storeId:config.blobStoreId!}),key='verification/'+crypto.randomUUID()+'.json';
 const first=await store.create(key,{revision:1,padding:'x'.repeat(3000)});
 const fresh=await store.get<{revision:number}>(key);assert.ok(fresh);
 console.log(JSON.stringify({putETag:first.etag,getETag:fresh.etag,etagMatches:first.etag===fresh.etag}));
 await assert.rejects(store.create(key,{revision:2,padding:'x'.repeat(3000)}),StorageConflict);
 const second=await store.compareAndSwap(key,{revision:2,padding:'x'.repeat(3000)},fresh.etag);await assert.rejects(store.compareAndSwap(key,{revision:3},first.etag),StorageConflict);
 assert.equal((await store.get<{revision:number}>(key))?.value.revision,2);assert.notEqual(second.etag,first.etag);
 console.log(JSON.stringify({check:'Private Blob freshness and CAS',passed:true}));
 console.log('Live integration prerequisites passed');
}
main().catch(error=>{
 let message=error instanceof Error?error.message:'CHECK_FAILED';
 for(const name of ['GEMINI_API_KEY','DEMO_ACCESS_TOKEN','BLOB_READ_WRITE_TOKEN','SELLER_PRIVATE_KEY','RECEIPT_SIGNER_PRIVATE_KEY','GENLAYER_REGISTRAR_PRIVATE_KEY','VERCEL_OIDC_TOKEN','VERCEL_TOKEN']){
  const value=process.env[name];if(value)message=message.replaceAll(value,'[redacted]');
 }
 console.error(JSON.stringify({phase,error:error instanceof Error?error.name:'Error',message:message.slice(0,1200)}));process.exitCode=1;
});
