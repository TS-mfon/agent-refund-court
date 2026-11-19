import { z } from 'zod';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  HashSchema, PaymentProofSchema, BASE_CHAIN_ID, BASE_NETWORK, USDC_ADDRESS,
} from '../domain/schema.js';
import { hashContent, paymentIdentity } from '../domain/identity.js';
import { type StateStore, type Stored, StorageConflict } from '../storage/index.js';
import {
  PaymentError, PaymentContextSchema, validateCheckout, authorizationDigest,
  type PaymentContext, type PaymentPolicy,
} from './context.js';

export type VerifiedPaymentProof = z.infer<typeof PaymentProofSchema>;
export interface PaymentFacilitator {
  verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<unknown>;
  settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<unknown>;
}
export interface ChainProofVerifier {
  prove(context: PaymentContext, transactionHint?: string | null): Promise<{
    authorizationUsed: boolean;
    proof: VerifiedPaymentProof | null;
  }>;
}
const phase = z.enum([
  'RESERVED', 'VERIFYING', 'SETTLING', 'PENDING', 'PAID', 'REJECTED',
]);
const RecordSchema = z.object({
  schemaVersion: z.literal(1),
  paymentId: HashSchema, orderId: HashSchema,
  contextHash: HashSchema, agreementHash: HashSchema,
  resourceHash: HashSchema, authorizationDigest: HashSchema,
  context: PaymentContextSchema,
  phase, transactionHint: HashSchema.nullable(),
  proof: PaymentProofSchema.nullable(),
  code: z.string().max(80).nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((value, ctx) => {
  if ((value.phase === 'PAID') !== (value.proof !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Paid state requires proof' });
  }
});
const IndexSchema = z.object({
  schemaVersion: z.literal(1), orderId: HashSchema,
  paymentId: HashSchema, contextHash: HashSchema,
}).strict();
const VerificationSchema = z.object({
  isValid: z.boolean(), payer: z.string().optional(),
});
const SettlementSchema = z.object({
  success: z.boolean(), transaction: z.string().optional(),
  network: z.string().optional(), payer: z.string().optional(),
});
const RecoverySchema = z.object({
  authorizationUsed: z.boolean(), proof: PaymentProofSchema.nullable(),
});
type PaymentRecord = z.infer<typeof RecordSchema>;
type PaymentSnapshot = Stored<PaymentRecord>;
type PaymentPatch = Partial<Pick<
  PaymentRecord, 'phase' | 'proof' | 'transactionHint' | 'code'
>>;
export type PaymentResult = {
  state: 'paid' | 'pending' | 'rejected';
  paymentId: string; orderId: string;
  context: PaymentContext; proof: VerifiedPaymentProof | null;
  code: string | null;
};

function paymentKey(id: string) {
  return 'payments/' + HashSchema.parse(id) + '.json';
}
function orderKey(id: string) {
  return 'payment-orders/' + HashSchema.parse(id) + '.json';
}
function result(value: PaymentRecord): PaymentResult {
  const state = value.phase === 'PAID' ? 'paid' :
    value.phase === 'REJECTED' ? 'rejected' : 'pending';
  return {
    state, paymentId: value.paymentId, orderId: value.orderId,
    context: value.context, proof: value.proof,
    code: state === 'paid' ? null : value.code ?? 'PAYMENT_PENDING',
  };
}
function sameAddress(one: string, two: string) {
  return one.toLowerCase() === two.toLowerCase();
}
function proofMatches(context: PaymentContext, proof: VerifiedPaymentProof) {
  const a = context.payment.payload.authorization;
  return proof.verified &&
    proof.chainId === BASE_CHAIN_ID && proof.network === BASE_NETWORK &&
    proof.token === USDC_ADDRESS &&
    sameAddress(proof.payer, a.from) && sameAddress(proof.seller, a.to) &&
    proof.amount === a.value && proof.authorizationNonce === a.nonce;
}

export class PaymentService {
  private readonly now: () => number;
  constructor(private readonly options: {
    store: StateStore; policy: PaymentPolicy;
    facilitator: PaymentFacilitator; chainProof: ChainProofVerifier;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
  }

  async process(input: unknown): Promise<PaymentResult> {
    const validated = await validateCheckout(input, this.options.policy, {
      allowExpired: true, now: Math.floor(this.now() / 1000),
    });
    const saved = await this.reserve(validated);
    return this.advance(saved, true);
  }

  /** This method never calls the facilitator or creates a new authorization. */
  async recover(input: unknown, transactionHint?: unknown): Promise<PaymentResult> {
    const validated = await validateCheckout(input, this.options.policy, {
      allowExpired: true, now: Math.floor(this.now() / 1000),
    });
    const hint = transactionHint === undefined ?
      undefined : HashSchema.parse(transactionHint);
    const saved = await this.reserve(validated);
    return this.advance(saved, false, hint);
  }

  async getOrder(orderId: string): Promise<PaymentResult | null> {
    const index = await this.options.store.get(orderKey(orderId));
    if (!index) return null;
    const binding = IndexSchema.parse(index.value);
    const saved = await this.load(binding.paymentId);
    if (saved.value.orderId !== binding.orderId ||
        saved.value.contextHash !== binding.contextHash) {
      throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
    }
    await validateCheckout(saved.value.context, this.options.policy, {
      allowExpired: true, now: Math.floor(this.now() / 1000),
    });
    return result(saved.value);
  }

  private async load(paymentId: string): Promise<PaymentSnapshot> {
    const saved = await this.options.store.get(paymentKey(paymentId));
    if (!saved) throw new PaymentError('PAYMENT_STORAGE_UNAVAILABLE');
    const value = RecordSchema.parse(saved.value);
    const context = value.context, checkout = context.checkout;
    const a = context.payment.payload.authorization;
    const actualId = paymentIdentity({
      chainId: BASE_CHAIN_ID, token: USDC_ADDRESS, payer: a.from, nonce: a.nonce,
    });
    if (value.paymentId !== paymentId || value.paymentId !== actualId ||
        value.orderId !== context.agreement.orderId ||
        value.contextHash !== hashContent(context) ||
        value.agreementHash !== checkout.agreementHash ||
        value.resourceHash !== checkout.resourceHash ||
        value.authorizationDigest !== authorizationDigest(context.payment) ||
        (value.proof !== null && !proofMatches(context, value.proof))) {
      throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
    }
    return { value, etag: saved.etag };
  }

  private async reserve(validated: Awaited<ReturnType<typeof validateCheckout>>) {
    const { context, paymentId, contextHash } = validated;
    const now = this.now();
    const initial: PaymentRecord = {
      schemaVersion: 1, paymentId, contextHash,
      orderId: context.agreement.orderId,
      agreementHash: context.checkout.agreementHash,
      resourceHash: context.checkout.resourceHash,
      authorizationDigest: validated.authorizationDigest,
      context, phase: 'RESERVED', transactionHint: null, proof: null, code: null,
      revision: 0, createdAt: now, updatedAt: now,
    };
    try {
      await this.options.store.create(paymentKey(paymentId), initial);
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
    }
    const saved = await this.load(paymentId);
    if (saved.value.contextHash !== contextHash ||
        saved.value.orderId !== context.agreement.orderId) {
      throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
    }
    const binding = {
      schemaVersion: 1 as const, paymentId, contextHash,
      orderId: context.agreement.orderId,
    };
    try {
      await this.options.store.create(orderKey(binding.orderId), binding);
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      const existing = await this.options.store.get(orderKey(binding.orderId));
      if (!existing ||
          hashContent(IndexSchema.parse(existing.value)) !== hashContent(binding)) {
        throw new PaymentError('PAYMENT_CONTEXT_CONFLICT');
      }
    }
    return this.load(paymentId);
  }

  private async write(saved: PaymentSnapshot, patch: PaymentPatch) {
    const next = RecordSchema.parse({
      ...saved.value, ...patch,
      revision: saved.value.revision + 1, updatedAt: this.now(),
    });
    return this.options.store.compareAndSwap(
      paymentKey(next.paymentId), next, saved.etag,
    );
  }

  private async updateOrCurrent(saved: PaymentSnapshot, patch: PaymentPatch) {
    try {
      return await this.write(saved, patch);
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      return this.load(saved.value.paymentId);
    }
  }

  private async pending(saved: PaymentSnapshot, code: string) {
    const updated = await this.updateOrCurrent(saved, { phase: 'PENDING', code });
    return result(updated.value);
  }

  private async advance(
    snapshot: PaymentSnapshot, maySettle: boolean, hint?: string,
  ): Promise<PaymentResult> {
    const saved = await this.load(snapshot.value.paymentId);
    if (saved.value.phase === 'PAID') return result(saved.value);
    let recovery: z.infer<typeof RecoverySchema>;
    try {
      recovery = RecoverySchema.parse(await this.options.chainProof.prove(
        saved.value.context, hint ?? saved.value.transactionHint,
      ));
      if (recovery.proof &&
          (!recovery.authorizationUsed ||
           !proofMatches(saved.value.context, recovery.proof))) {
        throw new PaymentError('INVALID_PAYMENT_PROOF');
      }
    } catch {
      // Keep RESERVED intact if no remote attempt has begun.
      return { ...result(saved.value), state: 'pending', code: 'CHAIN_UNAVAILABLE' };
    }
    if (recovery.proof) {
      const paid = await this.updateOrCurrent(saved, {
        phase: 'PAID', proof: recovery.proof,
        transactionHint: recovery.proof.transactionHash, code: null,
      });
      return result(paid.value);
    }
    if (recovery.authorizationUsed) {
      return this.pending(saved, 'AUTHORIZATION_USED_UNPROVEN');
    }
    if (!maySettle || saved.value.phase !== 'RESERVED') {
      return result(saved.value);
    }
    await validateCheckout(saved.value.context, this.options.policy, {
      now: Math.floor(this.now() / 1000),
    });
    let claimed: PaymentSnapshot;
    try {
      claimed = await this.write(saved, { phase: 'VERIFYING', code: null });
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      return result((await this.load(saved.value.paymentId)).value);
    }
    return this.verifyAndSettle(claimed);
  }

  private async verifyAndSettle(claimed: PaymentSnapshot): Promise<PaymentResult> {
    const context = claimed.value.context;
    let verified: z.infer<typeof VerificationSchema>;
    try {
      verified = VerificationSchema.parse(await this.options.facilitator.verify(
        context.payment, context.payment.accepted,
      ));
    } catch {
      // Verification is read-only; retry the same authorization before settlement.
      const retryable = await this.updateOrCurrent(claimed, {
        phase: 'RESERVED', code: 'FACILITATOR_UNAVAILABLE',
      });
      return result(retryable.value);
    }
    if (!verified.isValid ||
        (verified.payer && !sameAddress(verified.payer, context.agreement.buyer))) {
      const rejected = await this.updateOrCurrent(claimed, {
        phase: 'REJECTED', code: 'INVALID_PAYMENT_AUTHORIZATION',
      });
      return result(rejected.value);
    }
    try {
      await validateCheckout(context, this.options.policy, {
        now: Math.floor(this.now() / 1000),
      });
    } catch {
      const rejected = await this.updateOrCurrent(claimed, {
        phase: 'REJECTED', code: 'QUOTE_EXPIRED',
      });
      return result(rejected.value);
    }
    let settling: PaymentSnapshot;
    try {
      // Persist this before the irreversible remote operation.
      settling = await this.write(claimed, { phase: 'SETTLING', code: null });
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      return result((await this.load(claimed.value.paymentId)).value);
    }
    return this.settle(settling);
  }

  private async settle(saved: PaymentSnapshot): Promise<PaymentResult> {
    const context = saved.value.context;
    let response: z.infer<typeof SettlementSchema>;
    try {
      response = SettlementSchema.parse(await this.options.facilitator.settle(
        context.payment, context.payment.accepted,
      ));
    } catch {
      return this.pending(saved, 'FACILITATOR_UNAVAILABLE');
    }
    const parsedHash = HashSchema.safeParse(response.transaction);
    const validResponse = response.success &&
      response.network === BASE_NETWORK && parsedHash.success &&
      (!response.payer || sameAddress(response.payer, context.agreement.buyer));
    const pending = await this.updateOrCurrent(saved, {
      phase: 'PENDING',
      transactionHint: parsedHash.success ? parsedHash.data : null,
      code: validResponse ? 'CONFIRMATION_PENDING' : 'SETTLEMENT_UNCONFIRMED',
    });
    // SDK response is only a hint. Chain proof controls delivery.
    return this.advance(pending, false);
  }
}
