import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {AgreementSchema,BuyerDecisionSchema,CaseManifestSchema,RUBRIC,SAMPLE_BRIEF} from '../../src/domain/schema.js';
import {createAgreement} from '../../src/domain/identity.js';
import {loadConfig} from '../../src/config.js';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
describe('agreement and evidence boundaries',()=>{
 it('freezes criteria, price and policy',()=>{
  const addr=()=>privateKeyToAccount(generatePrivateKey()).address;
  const a=createAgreement({buyer:addr(),seller:addr(),receiptSigner:addr(),origin:'https://demo.example',brief:SAMPLE_BRIEF,now:1700000000});
  assert.equal(AgreementSchema.parse(a).amount,'10000');assert.deepEqual(a.rubric,RUBRIC);assert.equal(a.deliveryDeadlineSeconds,1800);
  for(const changed of [{...a,amount:'-100'},{...a,brief:'😀'.repeat(400)},{...a,token:'0x'+'00'.repeat(20)}])assert.throws(()=>AgreementSchema.parse(changed));
 });
 it('validates bounded agent decisions',()=>{
  assert.equal(BuyerDecisionSchema.parse({action:'accept',materialFailure:false,criterionIds:[],reason:'Concrete steps.',quotes:[]}).action,'accept');
  assert.throws(()=>BuyerDecisionSchema.parse({action:'refund',materialFailure:true,criterionIds:[],reason:'Refund now',quotes:[]}));
  assert.throws(()=>BuyerDecisionSchema.parse({action:'dispute',materialFailure:true,criterionIds:['fake'],reason:'Wrong',quotes:[]}));
 });
 it('rejects invented live proofs',()=>assert.throws(()=>CaseManifestSchema.parse({status:'refunded',mode:'live'})));
 it('allows viewing without signing secrets',()=>{
  assert.equal(loadConfig({}).canWrite,false);assert.equal(loadConfig({}).price,'10000');
  for(const config of [{SELLER_ADDRESS:'bad'},{PRICE_BASE_UNITS:'-1'},{SERVICE_ORIGIN:'http://evil.example'}])assert.throws(()=>loadConfig(config));
 });
});

describe('custom paid work agreements', () => {
 it('binds the exact custom brief to its service and fixed rubric', () => {
  const address = '0x' + '11'.repeat(20);
  const brief = 'Compare SQLite and Postgres for a solo-built scheduling app.';
  const custom = createAgreement({ buyer: address, seller: address, receiptSigner: address,
   origin: 'https://demo.example', brief, now: 1700000000, serviceId: 'agent-work-v1' });
  assert.equal(custom.serviceId, 'agent-work-v1');
  assert.equal(custom.rubricId, 'agent-work-v1');
  assert.equal(custom.brief, brief);
  assert.deepEqual(custom.rubric, RUBRIC);
  assert.equal(AgreementSchema.parse(custom).serviceId, 'agent-work-v1');
  assert.throws(() => AgreementSchema.parse({ ...custom, rubricId: 'launch-plan-v1' }));
  assert.throws(() => AgreementSchema.parse({ ...custom, serviceId: 'unknown-service' }));
 });
 it('preserves the original launch-plan agreement by default', () => {
  const address = '0x' + '11'.repeat(20);
  const legacy = createAgreement({ buyer: address, seller: address, receiptSigner: address,
   origin: 'https://demo.example', brief: SAMPLE_BRIEF, now: 1700000000 });
  assert.equal(legacy.serviceId, 'launch-plan-v1');
  assert.equal(legacy.rubricId, 'launch-plan-v1');
  assert.throws(() => AgreementSchema.parse({ ...legacy, rubricId: 'agent-work-v1' }));
 });
});
