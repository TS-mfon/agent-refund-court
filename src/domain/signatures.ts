import { verifyTypedData, type Address, type Hex } from 'viem';
import { AddressSchema, CheckoutSchema, HashSchema, BASE_CHAIN_ID, USDC_ADDRESS } from './schema.js';
const domain={name:'AgentRefundCourt',version:'1',chainId:BASE_CHAIN_ID,verifyingContract:USDC_ADDRESS} as const;
export function checkoutTypedData(input: unknown) {
  const p=CheckoutSchema.parse(input);
  return {domain,types:{Checkout:[
    {name:'orderId',type:'bytes32'},{name:'agreementHash',type:'bytes32'},{name:'resourceHash',type:'bytes32'},
    {name:'authorizationDigest',type:'bytes32'},{name:'payer',type:'address'},{name:'seller',type:'address'},
    {name:'amount',type:'uint256'},{name:'expiry',type:'uint256'},
  ]},primaryType:'Checkout' as const,message:{...p,amount:BigInt(p.amount),expiry:BigInt(p.expiry)}} as const;
}
export async function verifyCheckout(input: unknown, signature: string): Promise<boolean> {
  try { const p=CheckoutSchema.parse(input); return await verifyTypedData({...checkoutTypedData(p),address:p.payer,signature:signature as Hex}); }
  catch { return false; }
}
export function recordTypedData(kind: string, hash: string) {
  if (!['agreement','acceptance','delivery','dispute','recovery'].includes(kind)) throw new Error('Invalid record kind');
  return {domain,types:{Record:[{name:'kind',type:'string'},{name:'hash',type:'bytes32'}]},primaryType:'Record' as const,message:{kind,hash:HashSchema.parse(hash)}} as const;
}
export async function verifyRecord(kind: string, hash: string, signature: string, signer: string): Promise<boolean> {
  try { return await verifyTypedData({...recordTypedData(kind,hash),address:AddressSchema.parse(signer) as Address,signature:signature as Hex}); }
  catch { return false; }
}
