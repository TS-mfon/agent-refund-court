import { z } from 'zod';
import { hashTypedData,verifyTypedData,type Hex } from 'viem';
import type { PaymentPayload,PaymentRequired,PaymentRequirements } from '@x402/core/types';
import { AgreementSchema,CheckoutSchema,AddressSchema,HashSchema,SignatureSchema,AmountSchema,
  BASE_CHAIN_ID,BASE_NETWORK,USDC_ADDRESS,type Agreement } from '../domain/schema.js';
import { hashContent,paymentIdentity,verifyCheckout,verifyRecord } from '../domain/identity.js';
export class PaymentError extends Error {
  constructor(readonly code:string,message=code){super(message);this.name='PaymentError';}
}
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/).max(78).refine(v=>BigInt(v)<2n**256n);
export const AuthorizationSchema=z.object({
  from:AddressSchema,to:AddressSchema,value:uint,validAfter:uint,validBefore:uint,nonce:HashSchema,
}).strict();
const resource=z.object({url:z.string().url().max(500),description:z.string().max(200).optional(),mimeType:z.string().max(100).optional()}).strict();
export const RequirementsSchema=z.object({
  scheme:z.literal('exact'),network:z.literal(BASE_NETWORK),asset:z.literal(USDC_ADDRESS),
  amount:AmountSchema.pipe(z.string().max(78)),payTo:AddressSchema,maxTimeoutSeconds:z.number().int().min(1).max(300),
  extra:z.object({name:z.literal('USDC'),version:z.literal('2'),assetTransferMethod:z.literal('eip3009'),paymentFlow:z.literal('upfront')}).strict(),
}).strict();
const SDKPayloadSchema=z.object({
  x402Version:z.literal(2),resource,accepted:RequirementsSchema,
  payload:z.object({authorization:AuthorizationSchema,signature:SignatureSchema}).strict(),
  // Only an empty extension object is supported by this exact USDC flow.
  extensions:z.object({}).strict().optional(),
}).strict();
export const PayloadSchema=SDKPayloadSchema.transform((payment):z.infer<typeof SDKPayloadSchema>=>{
  // The SDK creates an own undefined key; omit it before canonical hashing.
  const {extensions,...fields}=payment;
  return extensions===undefined?fields:{...fields,extensions};
});
export const PaymentContextSchema=z.object({
  schemaVersion:z.literal(1),agreement:AgreementSchema,sellerSignature:SignatureSchema,buyerAcceptance:SignatureSchema,
  payment:PayloadSchema,checkout:CheckoutSchema,checkoutSignature:SignatureSchema,
}).strict();
export type PaymentContext=z.infer<typeof PaymentContextSchema>;
export type PaymentPolicy={seller:string;origin:string;amount:string};
const authorizationTypes={TransferWithAuthorization:[
  {name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},
  {name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'},
]} as const;
export function authorizationTypedData(payment:unknown) {
  const p=PayloadSchema.parse(payment),a=p.payload.authorization;
  return {domain:{name:'USDC',version:'2',chainId:BASE_CHAIN_ID,verifyingContract:USDC_ADDRESS},
    types:authorizationTypes,primaryType:'TransferWithAuthorization' as const,
    message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)}};
}
export function authorizationDigest(payment:unknown):Hex {return hashTypedData(authorizationTypedData(payment));}
export function assertAgreementPolicy(agreement:Agreement,policy:PaymentPolicy) {
  const seller=AddressSchema.parse(policy.seller),amount=AmountSchema.parse(policy.amount);
  const origin=new URL(policy.origin);
  if(origin.origin!==policy.origin||(origin.protocol!=='https:'&&
    !(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname))))throw new PaymentError('INVALID_SERVICE_ORIGIN');
  if(agreement.origin!==policy.origin||agreement.seller!==seller||agreement.amount!==amount||
    agreement.resource!==policy.origin+'/api/v1/orders/'+agreement.orderId+'/delivery')
    throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
}
export function createPaymentRequired(input:Agreement,now=Math.floor(Date.now()/1000)):PaymentRequired {
  const agreement=AgreementSchema.parse(input);
  const timeout=Math.min(300,agreement.expiresAt-now);
  if(timeout<1)throw new PaymentError('QUOTE_EXPIRED');
  const accepted:PaymentRequirements={scheme:'exact',network:BASE_NETWORK,asset:USDC_ADDRESS,
    amount:agreement.amount,payTo:agreement.seller,maxTimeoutSeconds:timeout,
    extra:{name:'USDC',version:'2',assetTransferMethod:'eip3009',paymentFlow:'upfront'}};
  return {x402Version:2,resource:{url:agreement.resource,description:'Agreed first-week launch plan',mimeType:'application/json'},accepts:[accepted]};
}
export function validateRequired(required:unknown,agreement:Agreement):PaymentRequired {
  const r=z.object({x402Version:z.literal(2),resource,accepts:z.array(RequirementsSchema).length(1)}).strict().parse(required);
  const a=r.accepts[0];
  if(r.resource.url!==agreement.resource||a.payTo!==agreement.seller||a.amount!==agreement.amount)
    throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
  return r;
}
export async function validateCheckout(input:unknown,policy:PaymentPolicy,options:{now?:number;allowExpired?:boolean}={}) {
  const c=PaymentContextSchema.parse(input),a=c.payment.payload.authorization,now=options.now??Math.floor(Date.now()/1000);
  assertAgreementPolicy(c.agreement,policy);
  const p=c.payment.accepted,g=c.agreement,b=c.checkout;
  if(Buffer.byteLength(JSON.stringify(c),'utf8')>16_384)throw new PaymentError('VALIDATION_ERROR');
  if(c.payment.resource.url!==g.resource||p.payTo!==g.seller||p.amount!==g.amount||
    a.from!==g.buyer||a.to!==g.seller||a.value!==g.amount||
    b.orderId!==g.orderId||b.agreementHash!==hashContent(g)||b.resourceHash!==hashContent(g.resource)||
    b.authorizationDigest!==authorizationDigest(c.payment)||b.payer!==a.from||b.seller!==a.to||b.amount!==a.value||
    BigInt(b.expiry)!==BigInt(a.validBefore)||BigInt(a.validBefore)>BigInt(g.expiresAt)||
    BigInt(a.validAfter)>=BigInt(a.validBefore))throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
  if(!options.allowExpired&&(g.createdAt>now||g.expiresAt<=now||BigInt(a.validBefore)<=BigInt(now)||
    BigInt(a.validAfter)>=BigInt(now)))throw new PaymentError('QUOTE_EXPIRED');
  const checks=await Promise.all([
    verifyRecord('agreement',hashContent(g),c.sellerSignature,g.receiptSigner),
    verifyRecord('acceptance',hashContent(g),c.buyerAcceptance,g.buyer),
    verifyCheckout(b,c.checkoutSignature),
    verifyTypedData({...authorizationTypedData(c.payment),address:a.from,signature:c.payment.payload.signature}),
  ]);
  if(checks.some(v=>!v))throw new PaymentError('INVALID_SIGNATURE');
  return {context:c,paymentId:paymentIdentity({chainId:BASE_CHAIN_ID,token:USDC_ADDRESS,payer:a.from,nonce:a.nonce}),
    contextHash:hashContent(c),authorizationDigest:b.authorizationDigest};
}
export function paymentPayload(context:PaymentContext):PaymentPayload{return context.payment;}
