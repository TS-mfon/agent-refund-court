import { z } from 'zod';
import {
  AgreementSchema, SignatureSchema, CaseManifestSchema, BuyerDecisionSchema, AddressSchema, HashSchema, SAMPLE_BRIEF, bounded,
  type Agreement, type BuyerDecision, type Delivery, type CaseManifest,
} from '../domain/schema.js';
import { hashContent, paymentIdentity, recordTypedData, verifyRecord } from '../domain/identity.js';
import {
  prepareCheckout, checkoutHeaders, decodeRequiredHeader, assertAgreementPolicy, PaymentContextSchema, validateCheckout,
  type PaymentContext, type PaymentSigner,
} from '../payments/index.js';
import { StorageConflict, type StateStore } from '../storage/index.js';
import { apiRequest, demoOrigin, DemoHttpError, responseJSON, sleep } from './http.js';
const QuoteSchema = z.object({ order: z.object({ agreement: AgreementSchema, sellerSignature: SignatureSchema }) });
const CaseSchema = z.object({ case: CaseManifestSchema });
const DeliveryResultSchema = z.object({ case: CaseManifestSchema, deliverySignature: SignatureSchema });
const PurchaseSchema = z.object({
  scenario: z.enum(['bad', 'good', 'live']).default('live'), resume: HashSchema.optional(),
  serviceId: z.enum(['launch-plan-v1', 'agent-work-v1']).default('launch-plan-v1'), brief: bounded(1200).default(SAMPLE_BRIEF),
}).strict();
export type BuyerWorkflowOptions = {
  origin: string; token?: string; signer: PaymentSigner; store: StateStore; expectedSeller?: string;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
  model?: { buyer: (agreement: Agreement, delivery: Delivery) => Promise<BuyerDecision> };
  fetcher?: typeof fetch; report?: (value: { orderId?: string; caseId?: string; status: string }) => void;
  maxDeliveryAttempts?: number; wait?: (ms: number) => Promise<void>;
  beforePayment?: (agreement: Agreement) => Promise<void>;
  onQuote?: (agreement: Agreement) => Promise<void>;
  beforeQuote?: () => Promise<void>;
};
export function createBuyerClient(options: BuyerWorkflowOptions) {
  const origin = demoOrigin(options.origin);
  const request = options.request ?? ((path: string, init?: RequestInit) => apiRequest(origin, options.token ?? '', path, init, options.fetcher));
  const post = (path: string, body: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) });
  const report = options.report ?? (() => {});
  async function validateOriginal(c: CaseManifest, original: CaseManifest) {
    if (c.id !== original.id || c.agreement.buyer.toLowerCase() !== options.signer.address.toLowerCase() ||
      hashContent(c.agreement) !== hashContent(original.agreement) || hashContent(c.delivery) !== hashContent(original.delivery) ||
      hashContent(c.payment) !== hashContent(original.payment)) throw new DemoHttpError('ORIGINAL_CASE_MISMATCH');
    return c;
  }
  async function remember(c: CaseManifest) {
    const key = 'buyer/cases/' + c.id + '.json', saved = await options.store.get<CaseManifest>(key);
    if (saved) { await validateOriginal(c, CaseManifestSchema.parse(saved.value)); return; }
    try { await options.store.create(key, c); }
    catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      const original = await options.store.get<CaseManifest>(key);
      if (!original) throw new DemoHttpError('LOCAL_CASE_MISSING');
      await validateOriginal(c, CaseManifestSchema.parse(original.value));
    }
  }
  async function getCase(caseId: string) {
    const id = HashSchema.parse(caseId), saved = await options.store.get<CaseManifest>('buyer/cases/' + id + '.json');
    if (!saved) throw new DemoHttpError('LOCAL_CASE_MISSING');
    const c = CaseSchema.parse(await responseJSON(await request('/api/v1/cases/' + id))).case;
    return validateOriginal(c, CaseManifestSchema.parse(saved.value));
  }
  async function review(c: CaseManifest, input: unknown) {
    await remember(c);
    if (!c.delivery || !c.payment?.verified) throw new DemoHttpError('NO_COMMITTED_DELIVERY');
    const decision = BuyerDecisionSchema.parse(input);
    if (decision.action === 'accept' && (decision.materialFailure || decision.criterionIds.length) ||
      new Set(decision.criterionIds).size !== decision.criterionIds.length ||
      decision.criterionIds.some(id => !c.agreement.rubric.some(criterion => criterion.id === id)))
      throw new DemoHttpError('INCONSISTENT_DECISION');
    if (decision.quotes.some(quote => !c.delivery!.text.includes(quote))) throw new DemoHttpError('INVALID_BUYER_QUOTE');
    if (c.buyerClaim) {
      if (hashContent(c.buyerClaim) !== hashContent(decision)) throw new DemoHttpError('DECISION_CONFLICT');
      return c;
    }
    const decisionKey = 'buyer/decisions/' + c.id + '.json', saved = await options.store.get<BuyerDecision>(decisionKey);
    if (saved && hashContent(saved.value) !== hashContent(decision)) throw new DemoHttpError('DECISION_CONFLICT');
    if (!saved) {
      try { await options.store.create(decisionKey, decision); }
      catch (error) { if (error instanceof StorageConflict) throw new DemoHttpError('REVIEW_IN_PROGRESS'); throw error; }
    }
    const payload = { caseId: c.id, agreementHash: hashContent(c.agreement), deliveryHash: c.delivery.hash, decision };
    const signature = await options.signer.signTypedData(recordTypedData(decision.action === 'dispute' ? 'dispute' : 'acceptance', hashContent(payload)));
    const final = CaseSchema.parse(await responseJSON(await post('/api/v1/orders/' + c.agreement.orderId + '/decision', { decision, signature }))).case;
    await validateOriginal(final, c);
    if (!final.buyerClaim || hashContent(final.buyerClaim) !== hashContent(decision)) throw new DemoHttpError('INVALID_COMMITTED_REVIEW');
    report({ orderId: c.agreement.orderId, caseId: c.id, status: final.status });
    return final;
  }
  async function purchase(raw: { scenario?: 'bad' | 'good' | 'live'; resume?: string; serviceId?: 'launch-plan-v1' | 'agent-work-v1'; brief?: string }) {
    const input = PurchaseSchema.parse(raw);
    const service = z.object({ service: z.object({
      seller: AddressSchema, priceBaseUnits: z.string().regex(/^[1-9][0-9]{0,77}$/),
      receiptSigner: AddressSchema.optional(), services: z.array(z.string().max(100)).max(20).optional(),
    }) }).parse(await responseJSON(await request('/api/v1/service'))).service;
    const seller = options.expectedSeller ? AddressSchema.parse(options.expectedSeller) : service.seller;
    if (seller !== service.seller || service.services && !service.services.includes(input.serviceId)) throw new DemoHttpError('SERVICE_POLICY_MISMATCH');
    let order: z.infer<typeof QuoteSchema>['order'];
    if (input.resume) {
      const row = await options.store.get('buyer/quotes/' + input.resume + '.json');
      if (!row) throw new DemoHttpError('LOCAL_QUOTE_MISSING');
      order = QuoteSchema.parse({ order: row.value }).order;
    } else {
      await options.beforeQuote?.();
      order = QuoteSchema.parse(await responseJSON(await post('/api/v1/orders', { buyer: options.signer.address, brief: input.brief,
        ...(input.serviceId === 'agent-work-v1' ? { serviceId: input.serviceId } : {}),
        deliveryMode: input.scenario === 'bad' ? 'generic' : input.scenario === 'good' ? 'good' : 'live' }))).order;
      await options.store.create('buyer/quotes/' + order.agreement.orderId + '.json', order);
    }
    const agreement = order.agreement, orderId = agreement.orderId;
    const policy = { seller, origin, amount: service.priceBaseUnits };
    assertAgreementPolicy(agreement, policy);
    if (agreement.buyer.toLowerCase() !== options.signer.address.toLowerCase() ||
      !input.resume && (agreement.brief !== input.brief || agreement.serviceId !== input.serviceId) ||
      service.receiptSigner && agreement.receiptSigner !== service.receiptSigner ||
      !await verifyRecord('agreement', hashContent(agreement), order.sellerSignature, agreement.receiptSigner))
      throw new DemoHttpError('INVALID_SELLER_QUOTE');
    await options.onQuote?.(agreement);
    report({ orderId, status: 'quoted' });
    await options.beforePayment?.(agreement);
    const acceptanceKey = 'buyer/acceptances/' + orderId + '.json', savedAcceptance = await options.store.get<string>(acceptanceKey);
    const buyerAcceptance = SignatureSchema.parse(savedAcceptance?.value ?? await options.signer.signTypedData(recordTypedData('acceptance', hashContent(agreement))));
    if (!savedAcceptance) await options.store.create(acceptanceKey, buyerAcceptance);
    await post('/api/v1/orders/' + orderId + '/acceptance', { buyerAcceptance });
    const deliveryPath = '/api/v1/orders/' + orderId + '/delivery';
    const previous = await options.store.get<{ status: string; context: unknown }>('buyer/orders/' + orderId + '.json');
    let context: PaymentContext;
    if (previous) {
      if (previous.value.status !== 'READY' || !previous.value.context) throw new DemoHttpError('CHECKOUT_PREPARING');
      context = PaymentContextSchema.parse(previous.value.context);
      await validateCheckout(context, policy, { allowExpired: true });
      if (hashContent(context.agreement) !== hashContent(agreement)) throw new DemoHttpError('ORIGINAL_CHECKOUT_MISMATCH');
    } else {
      const initial = await request(deliveryPath);
      if (initial.status !== 402) throw new DemoHttpError('EXPECTED_X402_CHALLENGE');
      const header = initial.headers.get('PAYMENT-REQUIRED');
      if (!header) throw new DemoHttpError('MISSING_X402_CHALLENGE');
      context = await prepareCheckout({ agreement, sellerSignature: order.sellerSignature, buyerAcceptance,
        required: decodeRequiredHeader(header), signer: options.signer, store: options.store, policy });
    }
    const maxAttempts = options.maxDeliveryAttempts ?? 8;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 30) throw new DemoHttpError('INVALID_DELIVERY_ATTEMPTS');
    let delivered: z.infer<typeof DeliveryResultSchema> | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await request(deliveryPath, { headers: checkoutHeaders(context) });
      if (response.status === 200) { delivered = DeliveryResultSchema.parse(await responseJSON(response)); break; }
      if (response.status !== 202) throw new DemoHttpError('DELIVERY_UNAVAILABLE');
      report({ orderId, status: 'payment_pending' });
      if (attempt + 1 < maxAttempts) await (options.wait ?? sleep)(2000);
    }
    if (!delivered) throw new DemoHttpError('PAYMENT_CONFIRMATION_PENDING_USE_RESUME');
    const c = delivered.case, id = paymentIdentity({ chainId: agreement.chainId, token: agreement.token,
      payer: agreement.buyer, nonce: context.payment.payload.authorization.nonce });
    if (c.id !== id || hashContent(c.agreement) !== hashContent(agreement) || !c.delivery || !c.payment?.verified ||
      c.payment.payer.toLowerCase() !== agreement.buyer.toLowerCase() || c.payment.seller !== seller ||
      c.payment.amount !== agreement.amount || c.payment.authorizationNonce !== context.payment.payload.authorization.nonce ||
      c.delivery.hash !== hashContent(c.delivery.text) ||
      !await verifyRecord('delivery', hashContent({ caseId: c.id, agreementHash: hashContent(agreement), delivery: c.delivery }),
        delivered.deliverySignature, agreement.receiptSigner)) throw new DemoHttpError('INVALID_ORIGINAL_DELIVERY');
    await remember(c);
    report({ orderId, caseId: c.id, status: c.status });
    return c;
  }
  return { purchase, review, getCase };
}
export function createBuyerWorkflow(options: BuyerWorkflowOptions) {
  const client = createBuyerClient(options);
  return async (input: Parameters<typeof client.purchase>[0]) => {
    const c = await client.purchase(input);
    if (c.buyerClaim) return c;
    if (!c.delivery || !options.model) throw new DemoHttpError('BUYER_MODEL_REQUIRED');
    const saved = await options.store.get<BuyerDecision>('buyer/decisions/' + c.id + '.json');
    const decision = saved?.value ?? await options.model.buyer(c.agreement, c.delivery);
    return client.review(c, decision);
  };
}
