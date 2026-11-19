import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hashContent, canonicalJSON, paymentIdentity, refundIdentity, checkoutTypedData, verifyCheckout, parseUSDC, formatUSDC } from '../../src/domain/identity.js';
import { BASE_CHAIN_ID, USDC_ADDRESS } from '../../src/domain/schema.js';
describe('stable content and financial identity',()=>{
 it('hashes ordered objects without normalizing text',()=>{
  assert.equal(hashContent({b:2,a:'café'}),hashContent({a:'café',b:2}));
  assert.notEqual(hashContent('café'),hashContent('cafe\u0301'));
  assert.equal(canonicalJSON({z:[{b:1,a:2}],a:null}),'{"a":null,"z":[{"a":2,"b":1}]}');
 });
 it('rejects unsupported signed values',()=>{for(const v of [undefined,{x:undefined},NaN,Infinity,1n])assert.throws(()=>canonicalJSON(v));});
 it('binds original financial identity',()=>{
  const payer=privateKeyToAccount(generatePrivateKey()).address;
  const a={chainId:BASE_CHAIN_ID,token:USDC_ADDRESS,payer,nonce:'0x'+'11'.repeat(32)};
  assert.match(paymentIdentity(a),/^0x[0-9a-f]{64}$/);
  assert.notEqual(paymentIdentity(a),paymentIdentity({...a,nonce:'0x'+'22'.repeat(32)}));
  assert.notEqual(paymentIdentity(a),paymentIdentity({...a,chainId:1}));
  assert.equal(refundIdentity(paymentIdentity(a),payer),refundIdentity(paymentIdentity(a),payer));
 });
 it('uses exact six-decimal money',()=>{
  assert.equal(parseUSDC('0.01'),'10000');assert.equal(formatUSDC('10000'),'0.01');assert.equal(parseUSDC('1.000001'),'1000001');
  for(const v of ['-1','0.0000001','1e3','NaN','1.2.3'])assert.throws(()=>parseUSDC(v));
 });
 it('rejects changed checkout agreement and payer',async()=>{
  const buyer=privateKeyToAccount(generatePrivateKey()),seller=privateKeyToAccount(generatePrivateKey());
  const p={orderId:'0x'+'33'.repeat(32),agreementHash:'0x'+'44'.repeat(32),resourceHash:'0x'+'55'.repeat(32),authorizationDigest:'0x'+'66'.repeat(32),payer:buyer.address,seller:seller.address,amount:'10000',expiry:2000000000};
  const sig=await buyer.signTypedData(checkoutTypedData(p));
  assert.equal(await verifyCheckout(p,sig),true);
  assert.equal(await verifyCheckout({...p,agreementHash:'0x'+'77'.repeat(32)},sig),false);
  assert.equal(await verifyCheckout({...p,payer:seller.address},sig),false);
 });
});
