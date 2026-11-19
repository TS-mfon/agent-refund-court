import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { createAgreement,hashContent,recordTypedData } from '../../src/domain/identity.js';
import { SAMPLE_BRIEF } from '../../src/domain/schema.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import { createPaymentRequired,prepareCheckout,validateCheckout,authorizationDigest,checkoutHeaders } from '../../src/payments/index.js';
export async function fixture(){
 const buyer=privateKeyToAccount(generatePrivateKey()),seller=privateKeyToAccount(generatePrivateKey()),now=Math.floor(Date.now()/1000);
 const agreement=createAgreement({buyer:buyer.address,seller:seller.address,receiptSigner:seller.address,origin:'http://127.0.0.1:3001',brief:SAMPLE_BRIEF,now});
 const sellerSignature=await seller.signTypedData(recordTypedData('agreement',hashContent(agreement)));
 const buyerAcceptance=await buyer.signTypedData(recordTypedData('acceptance',hashContent(agreement)));
 const policy={seller:seller.address,origin:agreement.origin,amount:agreement.amount};
 const store=new MemoryStateStore();
 const context=await prepareCheckout({agreement,sellerSignature,buyerAcceptance,required:createPaymentRequired(agreement),signer:buyer,store,policy});
 return {buyer,seller,policy,store,context};
}
test('SDK exact upfront checkout binds original authorization and returns the same saved nonce',async()=>{
 const f=await fixture();
 const result=await validateCheckout(f.context,f.policy);
 assert.equal(result.paymentId.length,66);
 assert.equal(f.context.payment.accepted.extra.paymentFlow,'upfront');
 assert.equal(f.context.checkout.authorizationDigest,authorizationDigest(f.context.payment));
 const repeated=await prepareCheckout({...f.context,required:createPaymentRequired(f.context.agreement),signer:f.buyer,store:f.store,policy:f.policy});
 assert.deepEqual(repeated,f.context);
});
test('rejects modified order, resource, EIP3009 amount, network and unsigned agreement',async()=>{
 const f=await fixture(),c=f.context;
 const altered=[
  {...c,checkout:{...c.checkout,orderId:'0x'+'11'.repeat(32)}},
  {...c,payment:{...c.payment,resource:{url:'https://evil.example/delivery'}}},
  {...c,payment:{...c.payment,payload:{...c.payment.payload,authorization:{...(c.payment.payload.authorization as object),value:'20000'}}}},
  {...c,payment:{...c.payment,accepted:{...c.payment.accepted,network:'eip155:8453'}}},
  {...c,agreement:{...c.agreement,brief:'Changed signed brief'}},
 ];
 for(const bad of altered) await assert.rejects(validateCheckout(bad,f.policy));
});
test('SDK optional extensions survive signed checkout validation and payment headers unchanged',async()=>{
 const f=await fixture(),original=structuredClone(f.context);
 assert.equal(Object.hasOwn(f.context.payment,'extensions'),false);
 const empty={...f.context,payment:{...f.context.payment,extensions:{}}};
 const validated=await validateCheckout(empty,f.policy);
 const decoded=decodePaymentSignatureHeader(checkoutHeaders(empty)['PAYMENT-SIGNATURE']);
 assert.deepEqual(decoded,empty.payment);
 assert.deepEqual(validated.context,empty);
 assert.deepEqual(f.context,original);
});
test('rejects nonempty extensions and unknown critical payment fields instead of stripping them',async()=>{
 const f=await fixture(),payment=f.context.payment;
 const extensions=[null,[],true,'unsupported',{payTo:f.buyer.address},{builderCode:{dataSuffix:'0x1234'}}];
 for(const value of extensions) await assert.rejects(validateCheckout({...f.context,payment:{...payment,extensions:value}},f.policy));
 await assert.rejects(validateCheckout({...f.context,payment:{...payment,scheme:'upto'}},f.policy));
 await assert.rejects(validateCheckout({...f.context,payment:{...payment,payload:{...payment.payload,amount:'20000'}}},f.policy));
});
