import { createAgreement, hashContent, paymentIdentity } from '../../src/domain/identity.js';
import { BASE_CHAIN_ID, USDC_ADDRESS, SAMPLE_BRIEF, type SealedEvidence } from '../../src/domain/schema.js';
export const courtAddress = '0x1111111111111111111111111111111111111111';
export const registrarAddress = '0xF3662F79ea1b2f5a6D175bf20b3ca1F8A410F27e';
export const buyer = '0x2222222222222222222222222222222222222222';
export const seller = '0x3333333333333333333333333333333333333333';
export const transactionHash = ('0x' + '44'.repeat(32)) as `0x${string}`;
export function evidenceFixture(): SealedEvidence {
  const agreement = createAgreement({ buyer, seller, receiptSigner:seller, origin:'https://demo.example', brief:SAMPLE_BRIEF, now:1800000000, courtAddress });
  const payment: SealedEvidence['payment'] = { chainId:BASE_CHAIN_ID, network:'eip155:84532' as const, token:USDC_ADDRESS, payer:buyer as `0x${string}`, seller:seller as `0x${string}`, amount:'10000', authorizationNonce:('0x'+'55'.repeat(32)) as `0x${string}`, transactionHash, blockNumber:'1', blockHash:('0x'+'66'.repeat(32)) as `0x${string}`, verified:true };
  const text = 'Promote your product on social media. Reach out to potential customers. Collect feedback and improve.';
  return { schemaVersion:1, caseId:paymentIdentity({chainId:payment.chainId, token:payment.token, payer:payment.payer, nonce:payment.authorizationNonce}), agreement, agreementHash:hashContent(agreement), delivery:{text,hash:hashContent(text),committedAt:1800000001}, buyerClaim:{action:'dispute',materialFailure:true,criterionIds:['relevance','actionability'],reason:'The plan never uses the product or the five-hour constraint.',quotes:['Promote your product on social media.']}, sellerDefense:'These are conventional promotion suggestions.', payment };
}
