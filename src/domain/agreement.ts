import { z } from 'zod';
import { HashSchema, AddressSchema, AmountSchema, bounded, CriterionIdSchema, BASE_CHAIN_ID, BASE_NETWORK, USDC_ADDRESS } from './primitives.js';
export const RUBRIC = [
  { id: 'relevance', text: 'Materially use the product, intended audience, and available resources.' },
  { id: 'actionability', text: 'Give practical things to create, show, or do, and a useful feedback method.' },
  { id: 'grounding', text: 'Do not rely on invented capabilities, customers, results, or excluded resources.' },
] as const;
export const SAMPLE_BRIEF = 'TraceLite converts HTTP request logs into a searchable local timeline, helping backend developers investigate intermittent API failures. It runs locally. A solo builder has a working prototype but no customers. The builder has five hours and no advertising budget for its first week of promotion. Produce a short launch plan with three practical actions and a way to collect useful feedback. Do not invent customers, benchmarks, integrations, or product capabilities.';
export const CriterionSchema = z.object({ id: CriterionIdSchema, text: bounded(400) }).strict();
export const AgreementSchema = z.object({
  schemaVersion: z.literal(1), orderId: HashSchema, serviceId: z.enum(['launch-plan-v1', 'agent-work-v1']),
  origin: z.string().url(), resource: z.string().min(1).max(500),
  buyer: AddressSchema, seller: AddressSchema, receiptSigner: AddressSchema,
  chainId: z.literal(BASE_CHAIN_ID), network: z.literal(BASE_NETWORK), token: z.literal(USDC_ADDRESS),
  amount: AmountSchema, brief: bounded(1200), rubricId: z.enum(['launch-plan-v1', 'agent-work-v1']),
  rubric: z.array(CriterionSchema).length(3).refine(v => JSON.stringify(v) === JSON.stringify(RUBRIC), 'Unexpected rubric'),
  refundPolicy: z.literal('Full paid principal for a material failure; preference and minor style differences do not qualify.'),
  deliveryDeadlineSeconds: z.number().int().min(60).max(86400),
  disputeWindowSeconds: z.number().int().min(60).max(86400),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  courtNetwork: z.enum(['studionet', 'testnet-bradbury']), courtAddress: AddressSchema.nullable(),
  publicEvidence: z.literal(true),
}).strict().refine(v => v.expiresAt > v.createdAt, 'Quote must expire after creation')
  .refine(v => v.serviceId === v.rubricId, 'Service and rubric must match');
export type Agreement = z.infer<typeof AgreementSchema>;
export const CheckoutSchema = z.object({
  orderId: HashSchema, agreementHash: HashSchema, resourceHash: HashSchema, authorizationDigest: HashSchema,
  payer: AddressSchema, seller: AddressSchema, amount: AmountSchema, expiry: z.number().int().positive(),
}).strict();
export type Checkout = z.infer<typeof CheckoutSchema>;
