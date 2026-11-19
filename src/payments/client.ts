import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodePaymentSignatureHeader,decodePaymentRequiredHeader,encodePaymentRequiredHeader,encodePaymentResponseHeader } from '@x402/core/http';
import { type StateStore,StorageConflict } from '../storage/index.js';
import { AgreementSchema,type Agreement } from '../domain/schema.js';
import { checkoutTypedData,hashContent,verifyRecord } from '../domain/identity.js';
import { PaymentError,PayloadSchema,assertAgreementPolicy,validateRequired,validateCheckout,authorizationDigest,type PaymentContext,type PaymentPolicy } from './context.js';
export type PaymentSigner=ConstructorParameters<typeof ExactEvmScheme>[0];
type SavedCheckout={agreementHash:string;status:'PREPARING'|'READY';context:PaymentContext|null};
export async function prepareCheckout(input:{
  agreement:Agreement;sellerSignature:PaymentContext['sellerSignature'];buyerAcceptance:PaymentContext['buyerAcceptance'];
  required:unknown;signer:PaymentSigner;store:StateStore;policy:PaymentPolicy
}):Promise<PaymentContext> {
  const g=AgreementSchema.parse(input.agreement);assertAgreementPolicy(g,input.policy);
  const agreementHash=hashContent(g),key='buyer/orders/'+g.orderId+'.json';
  if(input.signer.address.toLowerCase()!==g.buyer.toLowerCase())throw new PaymentError('UNAUTHORIZED_PARTICIPANT');
  const saved=await input.store.get<SavedCheckout>(key);
  if(saved) {
    if(saved.value.agreementHash!==agreementHash)throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
    if(!saved.value.context)throw new PaymentError('CHECKOUT_PREPARING');
    await validateCheckout(saved.value.context,input.policy,{allowExpired:true});
    return saved.value.context;
  }
  const required=validateRequired(input.required,g);
  if(!await verifyRecord('agreement',agreementHash,input.sellerSignature,g.receiptSigner)||
    !await verifyRecord('acceptance',agreementHash,input.buyerAcceptance,g.buyer))throw new PaymentError('INVALID_SIGNATURE');
  let reservation;
  try {reservation=await input.store.create<SavedCheckout>(key,{agreementHash,status:'PREPARING',context:null});}
  catch(error) {if(error instanceof StorageConflict)throw new PaymentError('CHECKOUT_PREPARING');throw error;}
  const client=new x402Client().register('eip155:84532',new ExactEvmScheme(input.signer));
  const payment=PayloadSchema.parse(await client.createPaymentPayload(required));
  const expiry=Number(payment.payload.authorization.validBefore);
  const checkout={orderId:g.orderId,agreementHash,resourceHash:hashContent(g.resource),authorizationDigest:authorizationDigest(payment),
    payer:g.buyer,seller:g.seller,amount:g.amount,expiry};
  const checkoutSignature=await input.signer.signTypedData(checkoutTypedData(checkout));
  const context:PaymentContext={schemaVersion:1,agreement:g,sellerSignature:input.sellerSignature,
    buyerAcceptance:input.buyerAcceptance,payment,checkout,checkoutSignature};
  await validateCheckout(context,input.policy);
  await input.store.compareAndSwap<SavedCheckout>(key,{agreementHash,status:'READY',context},reservation.etag);
  return context;
}
export function checkoutHeaders(context:PaymentContext) {
  return {'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(context.payment),
    'X-ARC-CHECKOUT':Buffer.from(JSON.stringify(context)).toString('base64')};
}
export function decodeRequiredHeader(header:string) {
  if(!header||header.length>8192)throw new PaymentError('VALIDATION_ERROR');
  return decodePaymentRequiredHeader(header);
}
export {encodePaymentRequiredHeader,encodePaymentResponseHeader};
