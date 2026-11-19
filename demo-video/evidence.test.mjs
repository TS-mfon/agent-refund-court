import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCase, sceneText} from './evidence.mjs';
const hash='0x'+'11'.repeat(32),payer='0x'+'22'.repeat(20),seller='0x'+'33'.repeat(20),token='0x'+'44'.repeat(20);
const sample=()=>({id:hash,mode:'fixture',status:'refunded',evidenceHash:hash,agreement:{buyer:payer,seller,amount:'10000',token},
 delivery:{text:'Build awareness and stay consistent.'},buyerClaim:{action:'dispute',reason:'No practical tasks.',quotes:['Build awareness']},
 provenance:{disclosure:'Explicit test fixture.'},
 payment:{verified:true,payer,seller,token,amount:'10000',transactionHash:hash},
 court:{verified:true,status:'finalized',caseId:hash,evidenceHash:hash,transactionHash:hash,result:{decision:'REFUND',reasoning:'Material actionability failure.'}},
 refund:{verified:true,status:'confirmed',payer,authorizer:seller,token,amount:'10000',transactionHash:hash}});
test('video evidence requires real confirmed matching payment, ruling and refund',()=>{
 assert.equal(verifiedCase(sample()).status,'refunded');
 for(const change of [
  c=>({...c,mode:'simulation'}),
  c=>({...c,court:{...c.court,status:'accepted'}}),
  c=>({...c,refund:{...c.refund,amount:'20000'}}),
  c=>({...c,refund:{...c.refund,payer:seller}}),
  c=>({...c,payment:{...c.payment,verified:false}}),
  c=>({...c,payment:{...c.payment,verified:'yes'}}),
  c=>({...c,court:{...c.court,result:{...c.court.result,decision:'NO_REFUND'}}}),
  c=>({...c,refund:{...c.refund,transactionHash:'pending'}}),
 ])assert.throws(()=>verifiedCase(change(sample())));
});
test('short video excerpts are exact source text or visibly ellipsized',()=>{
 const c=sample();assert.equal(sceneText(c).quote,'Build awareness');
 const lengthy={...c,court:{...c.court,result:{...c.court.result,reasoning:'A'.repeat(600)}}};
 assert.equal(sceneText(lengthy).reasoning,'A'.repeat(220)+'…');
});
