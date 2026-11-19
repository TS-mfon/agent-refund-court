import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { AddressSchema, AmountSchema, USDC_ADDRESS, BASE_CHAIN_ID } from './domain/schema.js';
import { LIGHTWEIGHT_MODEL_ID } from './agent/gemini.js';
const key=z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v=>v as `0x${string}`);
const remote=z.string().url().refine(v=>{const u=new URL(v);return !u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)));},'HTTPS endpoint required');
const origin=remote.refine(v=>{const u=new URL(v);return u.pathname==='/'&&!u.search&&!u.hash;},'Service origin required').transform(v=>new URL(v).origin);
export function loadConfig(env:Record<string,string|undefined>=process.env) {
 const seller=env.SELLER_ADDRESS?AddressSchema.parse(env.SELLER_ADDRESS):null;
 const receiptKey=env.RECEIPT_SIGNER_PRIVATE_KEY?key.parse(env.RECEIPT_SIGNER_PRIVATE_KEY):null;
 const sellerKey=env.SELLER_PRIVATE_KEY?key.parse(env.SELLER_PRIVATE_KEY):null;
 const registrarKey=env.GENLAYER_REGISTRAR_PRIVATE_KEY?key.parse(env.GENLAYER_REGISTRAR_PRIVATE_KEY):null;
 if(sellerKey&&seller&&privateKeyToAccount(sellerKey).address!==seller)throw new Error('Seller signer identity mismatch');
 const courtAddress=env.GENLAYER_CONTRACT?AddressSchema.parse(env.GENLAYER_CONTRACT):null;
 const courtNetwork=z.enum(['studionet','testnet-bradbury']).parse(env.GENLAYER_NETWORK??'studionet');
 const accessToken=env.DEMO_ACCESS_TOKEN?z.string().min(24).max(512).parse(env.DEMO_ACCESS_TOKEN):null;
 return {
  seller,sellerKey,registrarKey,receiptKey,receiptSigner:receiptKey?privateKeyToAccount(receiptKey).address:null,
  price:AmountSchema.parse(env.PRICE_BASE_UNITS??'10000'),origin:origin.parse(env.SERVICE_ORIGIN??'http://127.0.0.1:3001'),
  token:USDC_ADDRESS,chainId:BASE_CHAIN_ID,network:'eip155:84532' as const,
  facilitator:remote.parse(env.X402_FACILITATOR_URL??'https://x402.org/facilitator'),
  baseRpc:remote.parse(env.BASE_RPC_URL??'https://sepolia.base.org'),
  courtAddress,courtNetwork,courtRpc:env.GENLAYER_RPC_URL?remote.parse(env.GENLAYER_RPC_URL):undefined,
  accessToken,blobToken:env.BLOB_READ_WRITE_TOKEN??null,blobStoreId:env.BLOB_STORE_ID??null,
  model:z.enum(['gemini-2.5-flash-lite','gemini-3.1-flash-lite','gemini-3.5-flash-lite']).parse(env.MODEL_ID??LIGHTWEIGHT_MODEL_ID),
  geminiApiKey:env.GEMINI_API_KEY??null,
  canWrite:!!(seller&&receiptKey&&courtAddress&&accessToken&&(env.BLOB_READ_WRITE_TOKEN||env.BLOB_STORE_ID)),
 };
}
export type AppConfig=ReturnType<typeof loadConfig>;
