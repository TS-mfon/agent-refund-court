import { z } from 'zod';
import { bounded, HashSchema } from './primitives.js';
import { AgreementSchema } from './agreement.js';
import { BuyerDecisionSchema } from './decisions.js';
import { PaymentProofSchema, CourtProofSchema, RefundProofSchema, DeliverySchema } from './proofs.js';
export * from './primitives.js';
export * from './agreement.js';
export * from './decisions.js';
export * from './proofs.js';
export const CaseManifestSchema = z.object({
  schemaVersion: z.literal(1), id: HashSchema, mode: z.enum(['live','fixture','simulation']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  status: z.enum(['simulation','awaiting_payment','delivered','accepted','disputed','court_pending','court_provisional','court_finalized','refund_pending','refunded','unresolved']),
  agreement: AgreementSchema, delivery: DeliverySchema.nullable(),
  buyerClaim: BuyerDecisionSchema.nullable(), sellerDefense: bounded(1200).nullable(),
  payment: PaymentProofSchema.nullable(), court: CourtProofSchema.nullable(), refund: RefundProofSchema.nullable(),
  evidenceHash: HashSchema.nullable(),
  events: z.array(z.object({ id:z.string().min(1).max(100),kind:z.string().min(1).max(60),at:z.string().datetime(),label:bounded(200) }).strict()).max(100),
  provenance: z.object({ source:z.enum(['recorded','live','simulation']),fixtureLabel:z.string().max(200).nullable(),disclosure:bounded(500) }).strict(),
}).strict().superRefine((v,ctx) => {
  if (v.mode === 'simulation' && (v.payment || v.court || v.refund)) ctx.addIssue({code:'custom',message:'Simulation cannot carry transaction proof'});
  if (v.status === 'refunded') {
    if (!v.payment?.verified || !v.refund?.verified || v.refund.status !== 'confirmed' || !v.refund.transactionHash) ctx.addIssue({code:'custom',message:'Confirmed transfer proof required'});
    if (v.refund?.reason === 'quality' && (!v.court?.verified || v.court.status !== 'finalized' || v.court.result?.decision !== 'REFUND')) ctx.addIssue({code:'custom',message:'Finalized quality ruling required'});
  }
});
export type CaseManifest = z.infer<typeof CaseManifestSchema>;
export const SealedEvidenceSchema = z.object({
  schemaVersion:z.literal(1),caseId:HashSchema,agreement:AgreementSchema,agreementHash:HashSchema,
  delivery:DeliverySchema,buyerClaim:BuyerDecisionSchema,sellerDefense:bounded(1200).nullable(),
  payment:PaymentProofSchema,
}).strict();
export type SealedEvidence = z.infer<typeof SealedEvidenceSchema>;
