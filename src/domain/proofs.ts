import { z } from 'zod';
import { bounded, HashSchema, AddressSchema, AmountSchema, BASE_CHAIN_ID, BASE_NETWORK, USDC_ADDRESS } from './primitives.js';
import { CourtDecisionSchema } from './decisions.js';
export const PaymentProofSchema = z.object({
  chainId: z.literal(BASE_CHAIN_ID), network: z.literal(BASE_NETWORK), token: z.literal(USDC_ADDRESS),
  payer: AddressSchema, seller: AddressSchema, amount: AmountSchema, authorizationNonce: HashSchema,
  transactionHash: HashSchema, blockNumber: z.string().regex(/^[0-9]+$/), blockHash: HashSchema, verified: z.boolean(),
}).strict();
export type PaymentProof = z.infer<typeof PaymentProofSchema>;
export const CourtProofSchema = z.object({
  network: z.enum(['studionet','testnet-bradbury']), contractAddress: AddressSchema, caseId: HashSchema,
  evidenceHash: HashSchema, transactionHash: HashSchema.nullable(),
  status: z.enum(['not_submitted','pending','accepted','finalized','undetermined','failed']),
  result: CourtDecisionSchema.nullable(), verified: z.boolean(),
}).strict();
export type CourtProof = z.infer<typeof CourtProofSchema>;
export const RefundProofSchema = z.object({
  reason: z.enum(['quality','non_delivery']), status: z.enum(['not_due','awarded','pending','confirmed','failed','reserve_shortfall','canceled']),
  authorizer: AddressSchema, payer: AddressSchema, token: z.literal(USDC_ADDRESS), amount: AmountSchema,
  authorizationNonce: HashSchema, transactionHash: HashSchema.nullable(),
  blockNumber: z.string().regex(/^[0-9]+$/).nullable(), blockHash: HashSchema.nullable(), verified: z.boolean(),
}).strict();
export type RefundProof = z.infer<typeof RefundProofSchema>;
export const DeliverySchema = z.object({ text: bounded(3000), hash: HashSchema, committedAt: z.number().int().nonnegative() }).strict();
export type Delivery = z.infer<typeof DeliverySchema>;
