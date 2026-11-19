import { createPublicClient,http } from 'viem';
import { createAccount } from 'genlayer-js';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { loadConfig } from './config.js';
import { BlobStateStore,MemoryStateStore } from './storage/index.js';
import { BaseUSDCProofVerifier,PaymentService } from './payments/index.js';
import { CourtClient } from './court/client.js';
import { createGeminiModel } from './agent/gemini.js';
import { createCaseProcessor } from './workflow/processor.js';
import { createRefundExecutor } from './workflow/refund-chain.js';
import { createApp } from './server/app.js';
import { CaseRepository } from './server/cases.js';
import { ApiError } from './server/types.js';
export function createRuntimeApp(env:Record<string,string|undefined>=process.env){
 const config=loadConfig(env);
 if(env.VERCEL&&!config.blobToken&&!config.blobStoreId)throw new Error('Production storage required');
 const store=config.blobToken||config.blobStoreId?new BlobStateStore({
  ...(config.blobToken?{token:config.blobToken}:{storeId:config.blobStoreId!}),
 }):new MemoryStateStore();
 const model=config.geminiApiKey?createGeminiModel({apiKey:config.geminiApiKey,model:config.model}):undefined;
 if(!config.seller)return createApp({config:{...config,canWrite:false},store,model});
 const client=createPublicClient({transport:http(config.baseRpc,{timeout:10000,retryCount:0}),cacheTime:0});
 const verifier=new BaseUSDCProofVerifier({client});
 const payments=new PaymentService({store,policy:{seller:config.seller,origin:config.origin,amount:config.price},
  facilitator:new HTTPFacilitatorClient({url:config.facilitator,timeoutMs:15000}),chainProof:verifier});
 let processCase;
 if(config.courtAddress&&config.registrarKey){
  const account=createAccount(config.registrarKey),cases=new CaseRepository(store);
  processCase=async(caseId:string)=>{
   const c=(await cases.get(caseId)).value,contractAddress=c.agreement.courtAddress;
   if(!contractAddress||c.agreement.courtNetwork!=='studionet')
    throw new ApiError('UNSUPPORTED_CASE_COURT',503,'The original case court is not supported by this worker.');
   // Original signed agreement owns the court binding across deployment upgrades.
   const court=new CourtClient({contractAddress,account,endpoint:config.courtRpc});
   const refund=config.sellerKey?createRefundExecutor({store,privateKey:config.sellerKey,rpcUrl:config.baseRpc,courtContractAddress:contractAddress}):undefined;
   return createCaseProcessor({store,court,payments,verifyPayment:async(context,hint)=>(await verifier.prove(context,hint)).proof,refund})(caseId);
  };
 }
 return createApp({config:{...config,canWrite:config.canWrite&&!!processCase&&!!config.sellerKey},store,payments,model,processCase});
}
