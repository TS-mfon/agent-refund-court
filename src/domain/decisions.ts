import { z } from 'zod';
import { bounded, CriterionIdSchema } from './primitives.js';
export const BuyerDecisionSchema = z.object({
  action: z.enum(['accept','dispute']), materialFailure: z.boolean(),
  criterionIds: z.array(CriterionIdSchema).max(3), reason: bounded(1200), quotes: z.array(bounded(500)).max(3),
}).strict().refine(v => v.action !== 'dispute' || (v.materialFailure && v.criterionIds.length > 0), 'Dispute needs a material criterion failure');
export type BuyerDecision = z.infer<typeof BuyerDecisionSchema>;
export const CourtDecisionSchema = z.object({
  decision: z.enum(['REFUND','NO_REFUND','INSUFFICIENT_EVIDENCE']), materialFailure: z.boolean(),
  reasoning: bounded(1500), failedCriteria: z.array(CriterionIdSchema).max(3),
}).strict().refine(v => v.decision !== 'REFUND' || (v.materialFailure && v.failedCriteria.length > 0), 'Refund must identify material failure');
export type CourtDecision = z.infer<typeof CourtDecisionSchema>;
