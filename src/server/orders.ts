import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';
import { randomUUID } from 'node:crypto';
import {
  AgreementSchema, AddressSchema, SignatureSchema, HashSchema, DeliverySchema, PaymentProofSchema,
  SAMPLE_BRIEF, type CaseManifest, type Delivery, type PaymentProof,
} from '../domain/schema.js';
import { createAgreement, hashContent, recordTypedData, verifyRecord } from '../domain/identity.js';
import { type Stored, StorageConflict, acquireLease, commitArtifact, type LeaseGrant } from '../storage/index.js';
import { ApiError, type ServerOptions } from './types.js';
import { CaseRepository } from './cases.js';

const LeaseSchema = z.object({ token: z.string(), owner: z.string(), generation: z.number().int(), expiresAt: z.number().int() }).strict();
export const OrderSchema = z.object({
  schemaVersion: z.literal(1), agreement: AgreementSchema, sellerSignature: SignatureSchema,
  buyerAcceptance: SignatureSchema.nullable(), deliverySignature: SignatureSchema.nullable(),
  caseId: HashSchema.nullable(), mode: z.enum(['live', 'fixture']), deliveryMode: z.enum(['live', 'generic', 'good']),
  phase: z.enum(['quoted', 'accepted', 'paid', 'delivered']),
  delivery: DeliverySchema.nullable(), payment: PaymentProofSchema.nullable(),
  buyerDecisionHash: HashSchema.nullable(), buyerDecisionSignature: SignatureSchema.nullable(),
  revision: z.number().int().nonnegative(), fence: z.number().int().nonnegative(),
  lease: LeaseSchema.nullable(), artifactKey: z.string().nullable(), status: z.string(),
}).strict();
export type Order = z.infer<typeof OrderSchema>;
const QuoteInput = z.object({ buyer: AddressSchema, brief: z.string().min(1).max(1200).default(SAMPLE_BRIEF), deliveryMode: z.enum(['live', 'generic', 'good']).default('live') }).strict();
const generic = 'Build awareness and stay consistent. Define your target audience and make sure your message is clear. Create engaging content across social platforms and show how TraceLite solves important problems. Build a community around your product and use feedback to improve your offering.\n\nPost regularly, engage with your audience, and focus on delivering value. Consider partnerships that can help expand your reach. Track your performance and optimize your approach based on what works. Keep your goals realistic and make the most of the resources you have.\n\nFor the first week, focus on visibility, engagement, and momentum. Ask people whether they like your product and what they think you should improve. Stay authentic, remain patient, and continue refining your strategy. A strong launch comes from consistency and a clear understanding of your users.';
const good = 'Use the five hours to show one concrete debugging story and get feedback from backend developers.\n\n1. Spend 90 minutes making a local demonstration. Create a small sample HTTP request log with an intermittent failure. Show how the searchable timeline helps locate that request. Record a 45-second screen capture. Label the sample as synthetic, and show only features already in the prototype.\n\n2. Spend 90 minutes packaging the prototype for a trial. Write a short setup guide, include that sample log, and add a screenshot showing the timeline. Explain that logs stay local. Do not claim performance improvements or integrations you have not tested.\n\n3. Spend two hours reaching out to five backend developers in a community where you already participate. Follow its posting rules, describe the intermittent failure example, and invite them to try the prototype with synthetic or sanitized logs. Avoid broad promotional spam.\n\nAsk each person: Could you identify the failing request? Which setup step was confusing? What did you expect to click next? Would this fit your current debugging workflow? Record responses and observed stumbling points in a short note. At the end of the week, choose one specific improvement from those notes.';
const key = (id: string) => 'orders/' + HashSchema.parse(id) + '.json';

export class OrderRepository {
  private readonly cases: CaseRepository;
  constructor(private readonly options: ServerOptions) { this.cases = new CaseRepository(options.store); }
  now() { return (this.options.now ?? Date.now)(); }
  async get(id: string): Promise<Stored<Order>> {
    const saved = await this.options.store.get(key(id));
    if (!saved) throw new ApiError('ORDER_NOT_FOUND', 404, 'This order could not be found.');
    const value = OrderSchema.parse(saved.value);
    if (value.agreement.orderId.toLowerCase() !== id.toLowerCase())
      throw new ApiError('ORDER_CONTEXT_CONFLICT', 503, 'The saved order did not match its identifier.');
    if (value.delivery && value.delivery.hash !== hashContent(value.delivery.text))
      throw new ApiError('DELIVERY_CONTEXT_CONFLICT', 503, 'The committed answer did not match its receipt.');
    return { value, etag: saved.etag };
  }
  async quote(input: unknown) {
    const data = QuoteInput.parse(input), config = this.options.config;
    if (!config.receiptKey || !config.receiptSigner || !config.seller || !config.courtAddress || !this.options.payments)
      throw new ApiError('SERVICE_NOT_CONFIGURED', 503, 'Live purchases are not configured.');
    if (data.deliveryMode === 'live' && !this.options.model)
      throw new ApiError('MODEL_NOT_CONFIGURED', 503, 'The seller model is not configured. Choose an explicitly labelled fixture.');
    const agreement = createAgreement({ buyer: data.buyer, seller: config.seller, receiptSigner: config.receiptSigner,
      origin: config.origin, brief: data.brief, now: Math.floor(this.now() / 1000), price: config.price, courtAddress: config.courtAddress, courtNetwork: config.courtNetwork });
    const sellerSignature = await privateKeyToAccount(config.receiptKey).signTypedData(recordTypedData('agreement', hashContent(agreement)));
    const order = OrderSchema.parse({ schemaVersion: 1, agreement, sellerSignature, buyerAcceptance: null,
      deliverySignature: null, caseId: null, mode: data.deliveryMode === 'live' ? 'live' : 'fixture', deliveryMode: data.deliveryMode,
      phase: 'quoted', payment: null, delivery: null, buyerDecisionHash: null, buyerDecisionSignature: null,
      revision: 0, fence: 0, lease: null, artifactKey: null, status: 'QUOTED' });
    await this.options.store.create(key(agreement.orderId), order);
    return order;
  }
  async acceptance(id: string, input: unknown) {
    const body = z.object({ buyerAcceptance: SignatureSchema }).strict().parse(input);
    const saved = await this.get(id), order = saved.value;
    if (!await verifyRecord('acceptance', hashContent(order.agreement), body.buyerAcceptance, order.agreement.buyer))
      throw new ApiError('INVALID_BUYER_SIGNATURE', 403, 'The buyer agreement signature could not be verified.');
    if (order.buyerAcceptance) {
      if (order.buyerAcceptance !== body.buyerAcceptance) throw new ApiError('ACCEPTANCE_CONFLICT', 409, 'Use the original buyer acceptance.');
      return order;
    }
    if (order.agreement.expiresAt <= Math.floor(this.now() / 1000)) throw new ApiError('QUOTE_EXPIRED', 400, 'This quote expired. Request a fresh quote before paying.');
    return (await this.patch(saved, { buyerAcceptance: body.buyerAcceptance, phase: 'accepted', status: 'ACCEPTED' })).value;
  }
  async patch(saved: Stored<Order>, patch: Partial<Order>) {
    const next = OrderSchema.parse({ ...saved.value, ...patch, revision: saved.value.revision + 1 });
    try {
      return await this.options.store.compareAndSwap(key(next.agreement.orderId), next, saved.etag);
    } catch (error) {
      if (error instanceof StorageConflict) {
        let observed: Stored<Order> | null = null;
        try { observed = await this.get(next.agreement.orderId); } catch { /* Diagnostic reads cannot replace the original conflict. */ }
        console.error(JSON.stringify({
          event: 'order_compare_and_swap_conflict', orderId: next.agreement.orderId,
          previousPhase: saved.value.phase, nextPhase: next.phase, previousRevision: saved.value.revision,
          expectedETag: saved.etag, currentETag: observed?.etag ?? null,
          currentRevision: observed?.value.revision ?? null, currentPhase: observed?.value.phase ?? null,
          credentialMode: this.options.config.blobToken ? 'explicit-token' : 'store-identity',
        }));
      }
      throw error;
    }
  }
  async markPaid(id: string, paymentId: string, proof: PaymentProof) {
    const saved = await this.get(id);
    if (saved.value.payment) {
      if (saved.value.caseId !== paymentId || hashContent(saved.value.payment) !== hashContent(proof)) throw new ApiError('PAYMENT_CONFLICT', 409, 'The saved payment differs from this order.');
      return saved;
    }
    return this.patch(saved, { caseId: HashSchema.parse(paymentId), payment: proof, phase: 'paid', status: 'PAID' });
  }
  async deliver(id: string): Promise<{ case: CaseManifest; deliverySignature: string }> {
    let saved = await this.get(id);
    if (!saved.value.delivery) {
      let grant: LeaseGrant<Order>;
      try { grant = await acquireLease<Order>(this.options.store, key(id), { owner: randomUUID(), now: this.now(), ttlMs: 30000 }); }
      catch (error) { if (error instanceof StorageConflict) throw new ApiError('DELIVERY_IN_PROGRESS', 409, 'The answer is being committed. Retry the same signed checkout.'); throw error; }
      try {
        const order = grant.value;
        if (!order.payment?.verified || !order.caseId) throw new ApiError('PAYMENT_NOT_CONFIRMED', 409, 'Payment confirmation is required before delivery.');
        const text = order.deliveryMode === 'generic' ? generic : order.deliveryMode === 'good' ? good : await this.options.model!.seller(order.agreement);
        const delivery: Delivery = DeliverySchema.parse({ text, hash: hashContent(text), committedAt: Math.floor(this.now() / 1000) });
        const deliverySignature = await privateKeyToAccount(this.options.config.receiptKey!).signTypedData(
          recordTypedData('delivery', hashContent({ caseId: order.caseId, agreementHash: hashContent(order.agreement), delivery })));
        saved = await commitArtifact(this.options.store, key(id), grant, 'deliveries/' + id + '/' + grant.lease.token + '.json',
          { delivery, deliverySignature }, this.now(), { delivery, deliverySignature, phase: 'delivered', status: 'DELIVERED' });
      } catch (error) {
        const current = await this.get(id);
        if (current.value.lease?.token === grant.lease.token) {
          try { await this.patch(current, { lease: null }); }
          catch (releaseError) { if (!(releaseError instanceof StorageConflict)) throw releaseError; }
        }
        throw error;
      }
    }
    const order = saved.value;
    if (!order.caseId || !order.delivery || !order.payment || !order.deliverySignature) throw new ApiError('DELIVERY_UNAVAILABLE', 503, 'The committed delivery is unavailable.');
    const timestamp = new Date(this.now()).toISOString();
    const manifest = await this.cases.create({
      schemaVersion: 1, id: order.caseId, mode: order.mode, createdAt: timestamp, updatedAt: timestamp,
      status: 'delivered', agreement: order.agreement, delivery: order.delivery, buyerClaim: null, sellerDefense: null,
      payment: order.payment, court: null, refund: null, evidenceHash: null,
      events: [{ id: 'payment', kind: 'payment', at: timestamp, label: 'USDC payment verified on Base Sepolia' },
        { id: 'delivery', kind: 'delivery', at: timestamp, label: 'Original answer committed and signed' }],
      provenance: { source: 'live', fixtureLabel: order.mode === 'fixture' ? order.deliveryMode + ' delivery fixture' : null,
        disclosure: order.mode === 'fixture' ? 'The delivered answer is an explicitly selected fixture. Payment, buyer evaluation, court adjudication and any refund use real integrations.' :
          'Seller generation, payment, court adjudication and any refund use live integrations. The product brief describes fictional TraceLite.' },
    });
    return { case: manifest, deliverySignature: order.deliverySignature };
  }
}
