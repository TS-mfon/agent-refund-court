import express from 'express';
import { z } from 'zod';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { PaymentContextSchema, createPaymentRequired, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '../payments/index.js';
import { HashSchema, RUBRIC } from '../domain/schema.js';
import { hashContent } from '../domain/identity.js';
import { sealCourtEvidence } from '../court/evidence.js';
import { WalletAuthentication, AUTH_LIMITS } from './auth.js';
import { authenticated, allowedOrigin, authorizeBuyer, requestLimits, durableWriteLimit, errorResponse } from './security.js';
import { ApiError, type ServerOptions } from './types.js';
import { OrderRepository } from './orders.js';
import { CaseRepository } from './cases.js';
import { submitDecision } from './decisions.js';
import { VisitorActivity } from './activity.js';
export type { ServerOptions } from './types.js';

export function createApp(options: ServerOptions) {
  const app = express(), orders = new OrderRepository(options), cases = new CaseRepository(options.store), walletAuth = new WalletAuthentication(options), activity = new VisitorActivity(options);
  const capabilities = { purchase: Boolean(options.config.canWrite && options.payments), generation: Boolean(options.model) };
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next();
  });
  app.use(requestLimits(options));
  app.use('/api/v1/auth', express.json({ limit: '2kb', strict: true }));
  app.use(express.json({ limit: '20kb', strict: true }));
  app.get('/api/v1/health', (_req, res) => res.json({ success: true, status: 'ok', schemaVersion: 1 }));
  app.get('/api/v1/service', (_req, res) => res.json({ service: {
    id: 'agent-work-v1', services: ['agent-work-v1', 'launch-plan-v1'], priceBaseUnits: options.config.price, symbol: 'USDC', network: options.config.network,
    courtNetwork: options.config.courtNetwork, seller: options.config.seller, receiptSigner: options.config.receiptSigner, courtAddress: options.config.courtAddress, repository: 'https://github.com/TS-mfon/agent-refund-court',
    authentication: { method: 'eip191', walletType: 'eoa', challengePath: '/api/v1/auth/challenge', sessionPath: '/api/v1/auth/session', limits: AUTH_LIMITS },
    capabilities,
  } }));
  app.get('/api/v1/services', (_req, res) => res.json({ services: [
    { id: 'agent-work-v1', title: 'Custom agent work', description: 'A concise plain-text deliverable tailored to your brief, reviewed against relevance, actionability and grounding.' },
    { id: 'launch-plan-v1', title: 'First-week launch plan', description: 'Three practical launch actions and a useful feedback method for a solo builder with five hours and no advertising budget.' },
  ].map(service => ({ ...service, priceBaseUnits: options.config.price, symbol: 'USDC', network: options.config.network,
    rubric: RUBRIC, limits: { briefBytes: 1200, deliveryBytes: 3000, deliveryDeadlineSeconds: 1800, disputeWindowSeconds: 86400 }, capabilities })) }));
  app.get('/api/v1/activity/status', async (_req, res) => res.json(await activity.status()));
  app.post('/api/v1/activity/wake', allowedOrigin(options), async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(await activity.wake());
  });
  app.get('/api/v1/cases', async (_req, res) => res.json({ cases: await cases.list() }));
  app.get('/api/v1/cases/:id', async (req, res) => res.json({ case: (await cases.get(HashSchema.parse(req.params.id))).value }));
  app.get('/api/v1/cases/:id/evidence', async (req, res) => {
    const id = HashSchema.parse(req.params.id), c = (await cases.get(id)).value;
    const saved = await options.store.get('evidence/' + id + '.json');
    if (!saved || !c.evidenceHash) throw new ApiError('EVIDENCE_NOT_PUBLISHED', 404, 'Original dispute evidence is not published yet.');
    const sealed = sealCourtEvidence(saved.value);
    if (sealed.caseId !== c.id || sealed.evidenceHash !== c.evidenceHash) throw new ApiError('EVIDENCE_MISMATCH', 503, 'The published evidence did not match this case.');
    res.json({ evidence: sealed.evidence });
  });
  app.post('/api/v1/auth/challenge', allowedOrigin(options), async (req, res) => {
    if (!options.config.canWrite) throw new ApiError('SERVICE_NOT_CONFIGURED', 503, 'Wallet purchases are not configured.');
    res.status(201).json({ challenge: await walletAuth.challenge(req.body, req.ip ?? req.socket.remoteAddress ?? 'unknown') });
  });
  app.post('/api/v1/auth/session', allowedOrigin(options), async (req, res) => {
    if (!options.config.canWrite) throw new ApiError('SERVICE_NOT_CONFIGURED', 503, 'Wallet purchases are not configured.');
    res.status(201).json({ session: await walletAuth.session(req.body, req.ip ?? req.socket.remoteAddress ?? 'unknown') });
  });
  const auth = authenticated(options), writes = durableWriteLimit(options);
  app.post('/api/v1/orders', auth, writes, async (req, res) => {
    const order = await orders.quote(req.body, res.locals.principal);
    res.status(201).json({ order: { agreement: order.agreement, sellerSignature: order.sellerSignature, mode: order.mode, deliveryMode: order.deliveryMode } });
  });
  app.get('/api/v1/orders/:id', auth, async (req, res) => {
    const saved = await orders.get(HashSchema.parse(req.params.id));
    authorizeBuyer(res.locals.principal, saved.value.agreement.buyer);
    res.json({ order: saved.value, storage: { etag: saved.etag, revision: saved.value.revision, fence: saved.value.fence } });
  });
  app.post('/api/v1/orders/:id/acceptance', auth, writes, async (req, res) => {
    const id = HashSchema.parse(req.params.id), saved = await orders.get(id);
    authorizeBuyer(res.locals.principal, saved.value.agreement.buyer);
    const order = await orders.acceptance(id, req.body);
    res.json({ order: { agreement: order.agreement, sellerSignature: order.sellerSignature, buyerAcceptance: order.buyerAcceptance } });
  });
  app.get('/api/v1/orders/:id/delivery', auth, writes, async (req, res) => {
    const id = HashSchema.parse(req.params.id), order = (await orders.get(id)).value;
    authorizeBuyer(res.locals.principal, order.agreement.buyer);
    if (!order.buyerAcceptance) throw new ApiError('AGREEMENT_NOT_ACCEPTED', 409, 'The buyer must sign the agreement before paying.');
    const paymentHeader = req.get('payment-signature'), checkoutHeader = req.get('x-arc-checkout');
    if (!paymentHeader && !checkoutHeader) {
      const paymentRequired = createPaymentRequired(order.agreement, Math.floor((options.now ?? Date.now)() / 1000));
      res.set('PAYMENT-REQUIRED', encodePaymentRequiredHeader(paymentRequired)).status(402).json({ paymentRequired }); return;
    }
    if (!paymentHeader || !checkoutHeader || checkoutHeader.length > 24576 || paymentHeader.length > 24576 || !/^[A-Za-z0-9+/]+={0,2}$/.test(checkoutHeader))
      throw new ApiError('INVALID_CHECKOUT_HEADER', 400, 'Both original signed checkout headers are required.');
    let context;
    try { context = PaymentContextSchema.parse(JSON.parse(Buffer.from(checkoutHeader, 'base64').toString('utf8'))); }
    catch { throw new ApiError('INVALID_CHECKOUT_HEADER', 400, 'The signed checkout header could not be read.'); }
    let decodedPayment: unknown;
    try { decodedPayment = decodePaymentSignatureHeader(paymentHeader); }
    catch { throw new ApiError('INVALID_PAYMENT_HEADER', 400, 'The original payment header could not be read.'); }
    if (hashContent(decodedPayment) !== hashContent(context.payment))
      throw new ApiError('PAYMENT_HEADER_MISMATCH', 400, 'The payment header must match the original checkout.');
    if (context.agreement.orderId !== id || hashContent(context.agreement) !== hashContent(order.agreement) ||
      context.sellerSignature !== order.sellerSignature || context.buyerAcceptance !== order.buyerAcceptance)
      throw new ApiError('PAYMENT_CONTEXT_CONFLICT', 409, 'Use the original signed agreement and checkout.');
    if (!options.payments) throw new ApiError('SERVICE_NOT_CONFIGURED', 503, 'The payment service is unavailable.');
    const payment = await options.payments.process(context);
    if (payment.state !== 'paid' || !payment.proof?.verified) {
      res.status(payment.state === 'rejected' ? 400 : 202).json({ payment: { state: payment.state, paymentId: payment.paymentId, orderId: payment.orderId, code: payment.code }, case: null }); return;
    }
    await orders.markPaid(id, payment.paymentId, payment.proof);
    const delivery = await orders.deliver(id);
    res.set('PAYMENT-RESPONSE', encodePaymentResponseHeader({ success: true, transaction: payment.proof.transactionHash, network: payment.proof.network, payer: payment.proof.payer }));
    res.json(delivery);
  });
  app.post('/api/v1/orders/:id/decision', auth, writes, async (req, res) => {
    const id = HashSchema.parse(req.params.id), saved = await orders.get(id);
    authorizeBuyer(res.locals.principal, saved.value.agreement.buyer);
    res.json({ case: await submitDecision(id, req.body, options) });
  });
  app.post('/api/v1/cases/:id/process', auth, writes, async (req, res) => {
    z.object({}).strict().parse(req.body);
    const id = HashSchema.parse(req.params.id);
    const saved = await cases.get(id);
    authorizeBuyer(res.locals.principal, saved.value.agreement.buyer, 'CASE_NOT_FOUND');
    if (!options.processCase) throw new ApiError('WORKER_NOT_CONFIGURED', 503, 'The court worker is not configured.');
    res.json({ case: await options.processCase(id) });
  });
  app.use((_req, _res, next) => next(new ApiError('NOT_FOUND', 404, 'This API route does not exist.')));
  app.use(errorResponse);
  return app;
}
