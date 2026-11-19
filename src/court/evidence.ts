import { canonicalJSON, hashContent, paymentIdentity } from '../domain/identity.js';
import { SealedEvidenceSchema, type SealedEvidence } from '../domain/schema.js';
export const COURT_PAYLOAD_LIMIT = 16 * 1024;
export const COURT_RUNNER = 'py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6';
export type CourtEvidence = {
  caseId: SealedEvidence['caseId']; paymentId: SealedEvidence['caseId'];
  evidenceHash: SealedEvidence['caseId']; canonicalEvidence: string; evidence: SealedEvidence;
};
function equalHex(a:string,b:string):boolean { return a.toLowerCase()===b.toLowerCase(); }
function checkNumbers(value:unknown):void {
  if(typeof value==='number' && (!Number.isSafeInteger(value) || value<0)) throw new Error('Court evidence requires safe unsigned integers');
  if(typeof value==='string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('Invalid Unicode evidence');
  if(Array.isArray(value)) value.forEach(checkNumbers);
  else if(value && typeof value==='object') Object.values(value).forEach(checkNumbers);
}
/** Admission facts are verified by the trusted registrar before this envelope is submitted. */
export function sealCourtEvidence(input:unknown):CourtEvidence {
  const evidence=SealedEvidenceSchema.parse(input);
  checkNumbers(evidence);
  const {payment,agreement,delivery,buyerClaim}=evidence;
  const paymentId=paymentIdentity({chainId:payment.chainId,token:payment.token,payer:payment.payer,nonce:payment.authorizationNonce});
  if(!payment.verified || !equalHex(evidence.caseId,paymentId)) throw new Error('Unverified payment or case identity mismatch');
  if(!equalHex(payment.payer,agreement.buyer) || !equalHex(payment.seller,agreement.seller) || payment.amount!==agreement.amount) throw new Error('Payment and agreement mismatch');
  if(!equalHex(evidence.agreementHash,hashContent(agreement)) || !equalHex(delivery.hash,hashContent(delivery.text))) throw new Error('Original evidence hash mismatch');
  if(agreement.courtNetwork!=='studionet' || !agreement.courtAddress) throw new Error('Configured StudioNet court required');
  if(buyerClaim.action!=='dispute' || !buyerClaim.materialFailure || new Set(buyerClaim.criterionIds).size!==buyerClaim.criterionIds.length) throw new Error('Material dispute required');
  if(buyerClaim.quotes.some(quote=>!delivery.text.includes(quote))) throw new Error('Claim quote missing from original delivery');
  const canonicalEvidence=canonicalJSON(evidence);
  if(new TextEncoder().encode(canonicalEvidence).length>COURT_PAYLOAD_LIMIT) throw new Error('Court payload exceeds byte limit');
  return {caseId:paymentId,paymentId,evidenceHash:hashContent(canonicalEvidence),canonicalEvidence,evidence};
}
