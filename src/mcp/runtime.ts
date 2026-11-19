import { z } from 'zod';
import { AddressSchema, HashSchema, BuyerDecisionSchema, CaseManifestSchema, bounded, type CaseManifest } from '../domain/schema.js';
import { hashContent } from '../domain/identity.js';
import type { PaymentSigner } from '../payments/index.js';
import { StorageConflict, type StateStore } from '../storage/index.js';
import { createBuyerClient } from '../workflow/buyer.js';
import { publicApiRequest, responseJSON, DemoHttpError } from '../workflow/http.js';
import { createWalletSession, type WalletAuthenticator } from './auth.js';
import { allowedOrigin, createBudget, type Mandate } from './mandate.js';
import { buyerStore, merchantStore } from './store.js';
export const ServiceIdSchema = z.enum(['agent-work-v1', 'launch-plan-v1']);
export const PurchaseInputSchema = z.object({
  origin: z.string().min(1).max(300), serviceId: ServiceIdSchema, brief: bounded(1200).refine(value => value.trim().length > 0),
}).strict();
export const ReviewInputSchema = z.object({ caseId: HashSchema, ...BuyerDecisionSchema.shape }).strict();
const IntentSchema = z.object({
  purchaseId: HashSchema, origin: z.string().max(300), serviceId: ServiceIdSchema, brief: bounded(1200),
  orderId: HashSchema.nullable(), caseId: HashSchema.nullable(), phase: z.enum(['new','quoting','quoted','delivered']),
}).strict();
type Intent = z.infer<typeof IntentSchema>;
export type PurchaseRecovery = { purchaseId: string; orderId: string | null; caseId: string | null };
/** Safe identifiers let the caller resume without exposing signing or checkout state. */
export class PurchaseFailure extends DemoHttpError {
  constructor(code: string, readonly recovery: PurchaseRecovery) { super(code); }
}
export const ServiceSchema = z.object({
  service: z.object({
    id: ServiceIdSchema, services: z.array(ServiceIdSchema).min(1).max(2).optional(),
    seller: AddressSchema, receiptSigner: AddressSchema, priceBaseUnits: z.string().regex(/^[1-9][0-9]{0,77}$/),
    network: z.literal('eip155:84532'), symbol: z.literal('USDC'),
    capabilities: z.object({ purchase: z.boolean(), generation: z.boolean() }),
  }),
});
export function createAgentRuntime(options: {
  signer: PaymentSigner & WalletAuthenticator; store: StateStore; mandate: Mandate; fetcher?: typeof fetch; now?: () => number;
  accessToken?: string; maxDeliveryAttempts?: number;
}) {
  const store = buyerStore(options.store, options.signer.address), budget = createBudget(store, options.mandate, options.now);
  const active = new Set<string>();
  const sessions = new Map<string, ReturnType<typeof createWalletSession>>();
  function session(origin: string) {
    let existing = sessions.get(origin);
    if (!existing) {
      existing = createWalletSession({ ...options, origin });
      sessions.set(origin, existing);
    }
    return existing;
  }
  const key = (id: string) => 'purchases/' + HashSchema.parse(id) + '.json';
  async function savedIntent(id: string) {
    const row = await store.get(key(id));
    if (!row) throw new DemoHttpError('LOCAL_PURCHASE_MISSING');
    return { ...row, value: IntentSchema.parse(row.value) };
  }
  async function patch(id: string, fields: Partial<Intent>) {
    const row = await savedIntent(id), value = IntentSchema.parse({ ...row.value, ...fields });
    return store.compareAndSwap(key(id), value, row.etag);
  }
  function client(intent: Intent) {
    const origin = allowedOrigin(options.mandate, intent.origin);
    return createBuyerClient({
      origin, signer: options.signer, store: merchantStore(store, origin), request: session(origin).request,
      maxDeliveryAttempts: options.maxDeliveryAttempts ?? 2,
      beforeQuote: async () => {
        const row = await savedIntent(intent.purchaseId);
        if (row.value.phase !== 'new' || row.value.orderId) throw new DemoHttpError('PURCHASE_IN_PROGRESS');
        try { await store.compareAndSwap(key(intent.purchaseId), { ...row.value, phase: 'quoting' }, row.etag); }
        catch (error) { if (error instanceof StorageConflict) throw new DemoHttpError('PURCHASE_IN_PROGRESS'); throw error; }
      },
      onQuote: async agreement => {
        if (agreement.brief !== intent.brief || agreement.serviceId !== intent.serviceId) throw new DemoHttpError('REQUEST_QUOTE_MISMATCH');
        const current = (await savedIntent(intent.purchaseId)).value;
        if (current.orderId && current.orderId !== agreement.orderId) throw new DemoHttpError('ORIGINAL_ORDER_MISMATCH');
        if (!current.orderId) await patch(intent.purchaseId, { orderId: agreement.orderId, phase: 'quoted' });
      },
      beforePayment: agreement => budget.reserve(intent.purchaseId.slice(2), agreement.amount),
    });
  }
  async function execute(intent: Intent) {
    if (active.has(intent.purchaseId)) throw new PurchaseFailure('PURCHASE_IN_PROGRESS', {
      purchaseId: intent.purchaseId, orderId: intent.orderId, caseId: intent.caseId,
    });
    active.add(intent.purchaseId);
    try {
      const current = (await savedIntent(intent.purchaseId)).value;
      if (current.phase === 'quoting' && !current.orderId) throw new DemoHttpError('QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL');
      const buyer = client(current);
      if (current.caseId) return { purchaseId: current.purchaseId, case: await buyer.getCase(current.caseId) };
      const c = await buyer.purchase({ serviceId: current.serviceId, brief: current.brief, scenario: 'live',
        ...(current.orderId ? { resume: current.orderId } : {}) });
      await patch(current.purchaseId, { caseId: c.id, phase: 'delivered' });
      await store.create('cases/' + c.id + '.json', { purchaseId: current.purchaseId, origin: current.origin });
      return { purchaseId: current.purchaseId, case: c };
    } catch (error) {
      let recovery: PurchaseRecovery = { purchaseId: intent.purchaseId, orderId: intent.orderId, caseId: intent.caseId };
      try {
        const latest = (await savedIntent(intent.purchaseId)).value;
        recovery = { purchaseId: latest.purchaseId, orderId: latest.orderId, caseId: latest.caseId };
      } catch { /* A failed diagnostic read cannot replace the recoverable operation error. */ }
      throw new PurchaseFailure(error instanceof DemoHttpError ? error.code : 'PURCHASE_OPERATION_FAILED', recovery);
    } finally { active.delete(intent.purchaseId); }
  }
  async function caseIntent(caseId: string) {
    const id = HashSchema.parse(caseId);
    const locator = await store.get<{ purchaseId: string; origin: string }>('cases/' + id + '.json');
    if (!locator) {
      const intents = await store.list('purchases/', 1000);
      for (const path of intents) {
        const candidate = await store.get(path), intent = IntentSchema.parse(candidate?.value);
        if (intent.caseId === id) return intent;
      }
      throw new DemoHttpError('LOCAL_CASE_MISSING');
    }
    const intent = (await savedIntent(locator.value.purchaseId)).value;
    if (intent.caseId !== id || intent.origin !== locator.value.origin) throw new DemoHttpError('LOCAL_CASE_MISMATCH');
    return intent;
  }
  return {
    async discover(input: { origin: string }) {
      const origin = allowedOrigin(options.mandate, z.object({ origin: z.string().max(300) }).strict().parse(input).origin);
      const service = ServiceSchema.parse(await responseJSON(await publicApiRequest(origin, '/api/v1/service', undefined, options.fetcher))).service;
      return { origin, service, mandate: { maxPerPurchaseBaseUnits: options.mandate.maxPerPurchaseBaseUnits, dailyBudgetBaseUnits: options.mandate.dailyBudgetBaseUnits } };
    },
    async purchase(raw: z.input<typeof PurchaseInputSchema>) {
      const input = PurchaseInputSchema.parse(raw), origin = allowedOrigin(options.mandate, input.origin);
      const purchaseId = hashContent({ wallet: options.signer.address.toLowerCase(), origin, serviceId: input.serviceId, brief: input.brief });
      const row = await store.get(key(purchaseId));
      if (row) return execute(IntentSchema.parse(row.value));
      const intent: Intent = { purchaseId, origin, serviceId: input.serviceId, brief: input.brief, orderId: null, caseId: null, phase: 'new' };
      try { await store.create(key(purchaseId), intent); }
      catch (error) { if (error instanceof StorageConflict) throw new DemoHttpError('PURCHASE_IN_PROGRESS'); throw error; }
      return execute(intent);
    },
    async resume(purchaseId: string) { return execute((await savedIntent(purchaseId)).value); },
    async getCase(caseId: string): Promise<CaseManifest> {
      const intent = await caseIntent(caseId);
      return CaseManifestSchema.parse(await client(intent).getCase(caseId));
    },
    async review(raw: z.input<typeof ReviewInputSchema>) {
      const input = ReviewInputSchema.parse(raw), intent = await caseIntent(input.caseId);
      const { caseId, ...decision } = input, buyer = client(intent);
      return buyer.review(await buyer.getCase(caseId), BuyerDecisionSchema.parse(decision));
    },
  };
}
export type AgentRuntime = ReturnType<typeof createAgentRuntime>;
