import { readFile,stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
const directory=join(homedir(),'.config','agent-refund-court');
const key=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
async function privateJSON(name:string) {
 const path=join(directory,name),info=await stat(path);
 if(!info.isFile()||(info.mode&0o077)!==0)throw new Error('Private config permissions required');
 return JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
}
export async function loadPrivateEnvironment() {
 const wallets=await privateJSON('wallets.json') as Record<string,{privateKey:string;address:string}>;
 for(const role of ['buyer','seller','registrar','receiptSigner']){
  const w=wallets[role];if(!w||privateKeyToAccount(key.parse(w.privateKey) as `0x${string}`).address.toLowerCase()!==w.address.toLowerCase())throw new Error('Private wallet identity mismatch');
 }
 const model=await privateJSON('model.json') as {apiKey:string;model:string};
 const deployment=z.object({contractAddress:z.string().regex(/^0x[0-9a-fA-F]{40}$/)}).parse(JSON.parse(await readFile(new URL('../docs/deployment.json',import.meta.url),'utf8')));
 let runtime:Record<string,string>={};
 try{runtime=await privateJSON('runtime.json') as Record<string,string>;}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 let local:Record<string,string>={};
 try{local=Object.fromEntries(Object.entries(parseEnv(await readFile('.env.local','utf8'))).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 return {...local,
  SERVICE_ORIGIN:runtime.SERVICE_ORIGIN??'https://agent-refund-court.vercel.app',
  GENLAYER_CONTRACT:runtime.GENLAYER_CONTRACT??deployment.contractAddress,
  GENLAYER_NETWORK:'studionet',GENLAYER_RPC_URL:'https://studio.genlayer.com/api',
  SELLER_ADDRESS:wallets.seller.address,SELLER_PRIVATE_KEY:wallets.seller.privateKey,
  RECEIPT_SIGNER_PRIVATE_KEY:wallets.receiptSigner.privateKey,
  GENLAYER_REGISTRAR_PRIVATE_KEY:wallets.registrar.privateKey,
  GEMINI_API_KEY:model.apiKey,MODEL_ID:runtime.MODEL_ID??model.model,
  DEMO_ACCESS_TOKEN:runtime.DEMO_ACCESS_TOKEN,
  BLOB_STORE_ID:'store_Qmk1EpxSdanisqWm',
  BASE_RPC_URL:'https://sepolia.base.org',PRICE_BASE_UNITS:'10000',X402_FACILITATOR_URL:'https://x402.org/facilitator',
 } as Record<string,string>;
}
export {directory as privateDirectory};
