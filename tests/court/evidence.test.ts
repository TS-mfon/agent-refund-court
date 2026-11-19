import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealCourtEvidence } from '../../src/court/evidence.js';
import { hashContent } from '../../src/domain/identity.js';
import { evidenceFixture } from './fixture.js';
test('sealed evidence retains original text and derives payment case identity', () => {
  const e=evidenceFixture(), sealed=sealCourtEvidence(e);
  assert.equal(sealed.caseId,e.caseId);
  assert.equal(sealed.paymentId,e.caseId);
  assert.equal(sealed.evidenceHash,hashContent(sealed.canonicalEvidence));
  assert.deepEqual(JSON.parse(sealed.canonicalEvidence),e);
});
test('admission rejects mismatched immutable identities and unverified payment facts', () => {
  const e=evidenceFixture();
  for (const wrong of [
    {...e,caseId:hashContent('other payment')},
    {...e,agreementHash:hashContent('changed agreement')},
    {...e,delivery:{...e.delivery,text:'replacement'}},
    {...e,payment:{...e.payment,verified:false}},
    {...e,payment:{...e.payment,amount:'999'}},
    {...e,payment:{...e.payment,payer:e.agreement.seller}},
    {...e,buyerClaim:{...e.buyerClaim,quotes:['This is not in the original answer.']}},
    {...e,buyerClaim:{...e.buyerClaim,action:'accept'}},
    {...e,buyerClaim:{...e.buyerClaim,criterionIds:['grounding','grounding']}},
  ]) assert.throws(()=>sealCourtEvidence(wrong));
});
test('UTF-8 boundaries, unsafe timestamps and unsupported court are rejected', () => {
  const e=evidenceFixture();
  assert.throws(()=>sealCourtEvidence({...e,delivery:{...e.delivery,text:'é'.repeat(1501)}}));
  assert.throws(()=>sealCourtEvidence({...e,delivery:{...e.delivery,committedAt:9007199254740992}}));
  const agreement={...e.agreement,courtNetwork:'testnet-bradbury'};
  assert.throws(()=>sealCourtEvidence({...e,agreement,agreementHash:hashContent(agreement)}));
});
