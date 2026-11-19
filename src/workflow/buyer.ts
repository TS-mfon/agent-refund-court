import { z } from 'zod';
import { AgreementSchema, SignatureSchema, CaseManifestSchema, BuyerDecisionSchema, AddressSchema, SAMPLE_BRIEF, type Agreement, type BuyerDecision, type Delivery } from '../domain/schema.js';
import { hashContent, paymentIdentity, recordTypedData, verifyRecord } from '../domain/identity.js';
import { prepareCheckout, checkoutHeaders, decodeRequiredHeader, assertAgreementPolicy, PaymentContextSchema, validateCheckout, type PaymentContext, type PaymentSigner } from '../payments/index.js';
import type { StateStore } from '../storage/index.js';
import { apiRequest, demoOrigin, DemoHttpError, sleep } from './http.js';
const QuoteSchema = z.object({ order: z.object({ agreement: AgreementSchema, sellerSignature: SignatureSchema }) });
const CaseSchema = z.object({ case: CaseManifestSchema });
const DeliveryResultSchema = z.object({ case: CaseManifestSchema, deliverySignature: SignatureSchema });
export type BuyerWorkflowOptions = {
  origin: string; token: string; signer: PaymentSigner; store: StateStore; expectedSeller?: string;
  model: { buyer: (agreement: Agreement, delivery: Delivery) => Promise<BuyerDecision> };
  fetcher?: typeof fetch; report?: (value: { orderId?: string; caseId?: string; status: string }) => void;
  maxDeliveryAttempts?: number;
};
async function json(response: Response) {
  const text = await response.text(); if (Buffer.byteLength(text) > 65536) throw new DemoHttpError('RESPONSE_TOO_LARGE');
  try { return JSON.parse(text) as unknown; } catch { throw new DemoHttpError('INVALID_API_JSON'); }
}
export function createBuyerWorkflow(options: BuyerWorkflowOptions) {
  const origin = demoOrigin(options.origin), request = (path: string, init?: RequestInit) => apiRequest(origin, options.token, path, init, options.fetcher);
  const post = (path: string, body: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) });
  const report = options.report ?? (() => {});
  return async function purchase(input: { scenario: 'bad'|'good'|'live'; resume?: string }) {
    const seller = options.expectedSeller ?? z.object({ service: z.object({ seller: AddressSchema, priceBaseUnits: z.literal('10000') }) })
      .parse(await json(await request('/api/v1/service'))).service.seller;
    let order: z.infer<typeof QuoteSchema>['order'];
    if (input.resume) {
      const row = await options.store.get<z.infer<typeof QuoteSchema>['order']>('buyer/quotes/' + input.resume + '.json');
      if (!row) throw new DemoHttpError('LOCAL_QUOTE_MISSING');
      order = QuoteSchema.parse({ order: row.value }).order;
    } else {
      order = QuoteSchema.parse(await json(await post('/api/v1/orders', { buyer: options.signer.address, brief: SAMPLE_BRIEF,
        deliveryMode: input.scenario === 'bad' ? 'generic' : input.scenario === 'good' ? 'good' : 'live' }))).order;
      await options.store.create('buyer/quotes/' + order.agreement.orderId + '.json', order);
    }
    const agreement = order.agreement, orderId = agreement.orderId;
    report({ orderId, status: 'quoted' });
    const policy = { seller: AddressSchema.parse(seller), origin, amount: '10000' };
    assertAgreementPolicy(agreement, policy);
    if (agreement.buyer.toLowerCase() !== options.signer.address.toLowerCase() ||
      !await verifyRecord('agreement', hashContent(agreement), order.sellerSignature, agreement.receiptSigner)) throw new DemoHttpError('INVALID_SELLER_QUOTE');
    const buyerAcceptance = await options.signer.signTypedData(recordTypedData('acceptance', hashContent(agreement)));
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
      const header = initial.headers.get('PAYMENT-REQUIRED'); if (!header) throw new DemoHttpError('MISSING_X402_CHALLENGE');
      context = await prepareCheckout({ agreement, sellerSignature: order.sellerSignature, buyerAcceptance,
        required: decodeRequiredHeader(header), signer: options.signer, store: options.store, policy });
    }
    const maxAttempts = options.maxDeliveryAttempts ?? 8;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 30) throw new DemoHttpError('INVALID_DELIVERY_ATTEMPTS');
    let delivered: z.infer<typeof DeliveryResultSchema> | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await request(deliveryPath, { headers: checkoutHeaders(context) });
      if (response.status === 200) { delivered = DeliveryResultSchema.parse(await json(response)); break; }
      if (response.status !== 202) throw new DemoHttpError('DELIVERY_UNAVAILABLE');
      report({ orderId, status: 'payment_pending' }); await sleep(2000);
    }
    if (!delivered) throw new DemoHttpError('PAYMENT_CONFIRMATION_PENDING_USE_RESUME');
    const c = delivered.case, id = paymentIdentity({ chainId: agreement.chainId, token: agreement.token,
      payer: agreement.buyer, nonce: context.payment.payload.authorization.nonce });
    if (c.id !== id || hashContent(c.agreement) !== hashContent(agreement) || !c.delivery || !c.payment?.verified ||
      c.payment.payer.toLowerCase() !== agreement.buyer.toLowerCase() || c.payment.seller.toLowerCase() !== seller.toLowerCase() ||
      c.payment.amount !== agreement.amount || c.payment.authorizationNonce !== context.payment.payload.authorization.nonce ||
      c.delivery.hash !== hashContent(c.delivery.text) ||
      !await verifyRecord('delivery', hashContent({ caseId: c.id, agreementHash: hashContent(agreement), delivery: c.delivery }),
        delivered.deliverySignature, agreement.receiptSigner)) throw new DemoHttpError('INVALID_ORIGINAL_DELIVERY');
    report({ orderId, caseId: c.id, status: c.status });
    if (c.buyerClaim) return c;
    const decisionKey = 'buyer/decisions/' + id + '.json', saved = await options.store.get<BuyerDecision>(decisionKey);
    const decision = BuyerDecisionSchema.parse(saved?.value ?? await options.model.buyer(agreement, c.delivery));
    if (decision.quotes.some(quote => !c.delivery!.text.includes(quote))) throw new DemoHttpError('INVALID_BUYER_QUOTE');
    if (!saved) await options.store.create(decisionKey, decision);
    const payload = { caseId: id, agreementHash: hashContent(agreement), deliveryHash: c.delivery.hash, decision };
    const signature = await options.signer.signTypedData(recordTypedData(decision.action === 'dispute' ? 'dispute' : 'acceptance', hashContent(payload)));
    const final = CaseSchema.parse(await json(await post('/api/v1/orders/' + orderId + '/decision', { decision, signature }))).case;
    report({ orderId, caseId: id, status: final.status }); return final;
  };
}
