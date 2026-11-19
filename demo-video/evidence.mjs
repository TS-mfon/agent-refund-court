import assert from 'node:assert/strict';
const hash=v=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export function verifiedCase(c){
 assert.ok(c&&typeof c==='object','A real case is required');
 assert.ok(['live','fixture'].includes(c.mode)&&c.status==='refunded','Use a completed testnet case');
 assert.ok(hash(c.id)&&hash(c.evidenceHash),'Case and frozen evidence hashes are required');
 const p=c.payment,r=c.refund,j=c.court,a=c.agreement;
 assert.ok(p?.verified===true&&j?.verified===true&&r?.verified===true,'All three proofs must be verified');
 assert.equal(j.status,'finalized');assert.equal(j.result?.decision,'REFUND');assert.equal(r.status,'confirmed');
 assert.ok(same(c.id,j.caseId)&&same(c.evidenceHash,j.evidenceHash),'Court must judge this exact case');
 for(const tx of [p.transactionHash,j.transactionHash,r.transactionHash])assert.ok(hash(tx),'Actual transaction receipts required');
 assert.ok(same(p.payer,a.buyer)&&same(r.payer,p.payer)&&same(p.seller,a.seller)&&same(r.authorizer,p.seller),'Original buyer and seller required');
 assert.ok(same(p.token,a.token)&&same(r.token,p.token),'Original token required');
 assert.equal(p.amount,a.amount);assert.equal(r.amount,p.amount);
 assert.ok(c.delivery?.text&&c.buyerClaim?.action==='dispute','Original disputed answer required');
 return c;
}
export {sceneText} from './src/copy.mjs';
