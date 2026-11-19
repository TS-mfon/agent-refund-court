import { z } from 'zod';
import { BuyerDecisionSchema, SignatureSchema } from '../domain/schema.js';
import { hashContent, verifyRecord } from '../domain/identity.js';
import { sealCourtEvidence } from '../court/evidence.js';
import { StorageConflict } from '../storage/index.js';
import { ApiError, type ServerOptions } from './types.js';
import { OrderRepository } from './orders.js';
import { CaseRepository } from './cases.js';

export function decisionPayload(caseId: string, agreementHash: string, deliveryHash: string, decision: unknown) {
  return { caseId, agreementHash, deliveryHash, decision: BuyerDecisionSchema.parse(decision) };
}
export async function submitDecision(id: string, input: unknown, options: ServerOptions) {
  const body = z.object({ decision: BuyerDecisionSchema, signature: SignatureSchema }).strict().parse(input);
  if ((body.decision.action === 'accept' && (body.decision.materialFailure || body.decision.criterionIds.length > 0)) ||
    new Set(body.decision.criterionIds).size !== body.decision.criterionIds.length)
    throw new ApiError('INCONSISTENT_DECISION', 400, 'Acceptance must confirm no material failure, and criteria must be unique.');
  const orders = new OrderRepository(options), cases = new CaseRepository(options.store);
  const order = await orders.get(id);
  if (!order.value.caseId || !order.value.delivery || !order.value.payment?.verified)
    throw new ApiError('NO_COMMITTED_DELIVERY', 409, 'A confirmed purchase and committed delivery are required.');
  const saved = await cases.get(order.value.caseId), c = saved.value;
  const payload = decisionPayload(c.id, hashContent(c.agreement), c.delivery!.hash, body.decision);
  const kind = body.decision.action === 'dispute' ? 'dispute' : 'acceptance';
  const decisionHash = hashContent(payload);
  if (!await verifyRecord(kind, decisionHash, body.signature, c.agreement.buyer))
    throw new ApiError('INVALID_BUYER_SIGNATURE', 403, 'The buyer decision signature could not be verified.');
  if (body.decision.quotes.some(quote => !c.delivery!.text.includes(quote)))
    throw new ApiError('INVALID_QUOTE', 400, 'The claim must quote the original delivered answer.');
  if (Math.floor((options.now ?? Date.now)() / 1000) > c.delivery!.committedAt + c.agreement.disputeWindowSeconds)
    throw new ApiError('DISPUTE_WINDOW_CLOSED', 409, 'The agreed dispute window has closed.');
  if (c.buyerClaim) {
    if (hashContent(c.buyerClaim) !== hashContent(body.decision)) throw new ApiError('DECISION_CONFLICT', 409, 'The original buyer decision is already committed.');
    return c;
  }
  if (order.value.buyerDecisionHash && order.value.buyerDecisionHash !== decisionHash)
    throw new ApiError('DECISION_CONFLICT', 409, 'The original buyer decision is already committed.');
  if (!order.value.buyerDecisionHash) await orders.patch(order, { buyerDecisionHash: decisionHash, buyerDecisionSignature: body.signature });
  const timestamp = new Date((options.now ?? Date.now)()).toISOString();
  if (body.decision.action === 'accept') {
    return (await cases.patch(saved, { buyerClaim: body.decision, status: 'accepted', updatedAt: timestamp,
      events: [...c.events, { id: 'buyer-decision', kind: 'acceptance', at: timestamp, label: 'Buyer agent accepted the original answer' }] })).value;
  }
  let defense: string | null = null;
  let defenseFailed = false;
  if (options.model) {
    try { defense = await options.model.defense(c.agreement, c.delivery!, body.decision); }
    catch { defenseFailed = true; }
  }
  const evidenceKey = 'evidence/' + c.id + '.json';
  const existing = await options.store.get(evidenceKey);
  const sealed = existing ? sealCourtEvidence(existing.value) : sealCourtEvidence({
    schemaVersion: 1, caseId: c.id, agreement: c.agreement, agreementHash: hashContent(c.agreement),
    delivery: c.delivery, buyerClaim: body.decision, sellerDefense: defense, payment: c.payment,
  });
  if (hashContent(sealed.evidence.buyerClaim) !== hashContent(body.decision)) throw new ApiError('EVIDENCE_CONFLICT', 409, 'The original claim is already sealed.');
  if (!existing) {
    try { await options.store.create(evidenceKey, sealed.evidence); }
    catch (error) { if (!(error instanceof StorageConflict)) throw error; throw new ApiError('RETRY_REQUEST', 409, 'Evidence was committed by another request. Retry the original signed decision.'); }
  }
  return (await cases.patch(saved, { buyerClaim: body.decision, sellerDefense: sealed.evidence.sellerDefense,
    evidenceHash: sealed.evidenceHash, status: 'disputed', updatedAt: timestamp,
    events: [...c.events, { id: 'buyer-decision', kind: 'dispute', at: timestamp, label: 'Buyer agent identified a material failure' },
      ...(defenseFailed ? [{ id: 'defense-unavailable', kind: 'model_error', at: timestamp, label: 'Seller defense generation unavailable; original answer remains evidence' }] : []),
      { id: 'evidence-sealed', kind: 'evidence', at: timestamp, label: 'Agreement, payment, answer and claim frozen for the court' }] })).value;
}
