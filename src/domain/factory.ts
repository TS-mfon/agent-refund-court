import { AgreementSchema, RUBRIC, BASE_CHAIN_ID, USDC_ADDRESS, type Agreement } from './schema.js';
import { hashContent } from './identity.js';
export function createAgreement(input: {serviceId?:'launch-plan-v1'|'agent-work-v1';buyer:string;seller:string;receiptSigner:string;origin:string;brief:string;now:number;price?:string;courtAddress?:string|null;courtNetwork?:'studionet'|'testnet-bradbury'}): Agreement {
  const serviceId=input.serviceId??'launch-plan-v1';
  const orderId=hashContent({nonce:globalThis.crypto.randomUUID(),buyer:input.buyer,now:input.now});
  return AgreementSchema.parse({
    schemaVersion:1,orderId,serviceId,origin:input.origin,
    resource:input.origin+'/api/v1/orders/'+orderId+'/delivery',
    buyer:input.buyer,seller:input.seller,receiptSigner:input.receiptSigner,
    chainId:BASE_CHAIN_ID,network:'eip155:84532',token:USDC_ADDRESS,amount:input.price??'10000',
    brief:input.brief,rubricId:serviceId,rubric:RUBRIC,
    refundPolicy:'Full paid principal for a material failure; preference and minor style differences do not qualify.',
    deliveryDeadlineSeconds:1800,disputeWindowSeconds:86400,createdAt:input.now,expiresAt:input.now+600,
    courtNetwork:input.courtNetwork??'studionet',courtAddress:input.courtAddress??null,publicEvidence:true,
  });
}
