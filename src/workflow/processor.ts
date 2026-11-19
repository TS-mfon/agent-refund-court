import { z } from 'zod';
import type { Hex } from 'viem';
import { CaseManifestSchema, HashSchema, type CaseManifest, type PaymentProof, type SealedEvidence } from '../domain/schema.js';
import { hashContent, refundIdentity } from '../domain/identity.js';
import { sealCourtEvidence } from '../court/evidence.js';
import type { CourtClient } from '../court/client.js';
import type { PaymentService } from '../payments/service.js';
import type { PaymentContext } from '../payments/context.js';
import { StorageConflict, type StateStore, type Stored } from '../storage/index.js';
import type { RefundContext, RefundWorkerResult } from '../refunds/types.js';
export class WorkflowError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'WorkflowError'; }
}
const JobSchema = z.object({
  schemaVersion: z.literal(1), caseId: HashSchema, evidenceHash: HashSchema,
  phase: z.enum(['new', 'registering', 'registration_sent', 'registered', 'adjudicating', 'adjudication_sent', 'terminal']),
  registrationHash: HashSchema.nullable(), transactionHash: HashSchema.nullable(),
}).strict();
type Job = z.infer<typeof JobSchema>;
export type CaseProcessorOptions = {
  store: StateStore;
  court: Pick<CourtClient, 'contractAddress' | 'registerCase' | 'reconcileRegistration' | 'submitAdjudication' | 'reconcile'>;
  payments: Pick<PaymentService, 'getOrder'>;
  verifyPayment: (context: PaymentContext, transactionHash: string) => Promise<PaymentProof | null>;
  refund?: (caseId: Hex, loadEligibility: (id: Hex) => Promise<RefundContext>) => Promise<RefundWorkerResult>;
  now?: () => number;
};
const caseKey = (id: string) => 'cases/' + HashSchema.parse(id) + '.json';
const jobKey = (id: string) => 'court-jobs/' + HashSchema.parse(id) + '.json';
const evidenceKey = (id: string) => 'evidence/' + HashSchema.parse(id) + '.json';
function originalEvidence(c: CaseManifest): SealedEvidence {
  if (!c.delivery || !c.payment || !c.buyerClaim) throw new WorkflowError('CASE_NOT_DISPUTED');
  return { schemaVersion: 1, caseId: c.id, agreement: c.agreement, agreementHash: hashContent(c.agreement),
    delivery: c.delivery, payment: c.payment, buyerClaim: c.buyerClaim, sellerDefense: c.sellerDefense };
}
export function createCaseProcessor(options: CaseProcessorOptions) {
  const now = options.now ?? Date.now;
  async function loadCase(id: Hex): Promise<Stored<CaseManifest>> {
    const row = await options.store.get(caseKey(id));
    if (!row) throw new WorkflowError('CASE_NOT_FOUND');
    const value = CaseManifestSchema.parse(row.value);
    if (value.id !== id) throw new WorkflowError('CASE_ID_MISMATCH');
    return { value, etag: row.etag };
  }
  async function verify(c: CaseManifest) {
    const paid = await options.payments.getOrder(c.agreement.orderId);
    if (!c.payment || paid?.state !== 'paid' || !paid.proof ||
      hashContent(paid.context.agreement) !== hashContent(c.agreement) ||
      hashContent(paid.proof) !== hashContent(c.payment)) throw new WorkflowError('ORIGINAL_PAYMENT_UNVERIFIED');
    const proof = await options.verifyPayment(paid.context, c.payment.transactionHash);
    if (!proof?.verified || hashContent(proof) !== hashContent(c.payment)) throw new WorkflowError('ORIGINAL_PAYMENT_UNVERIFIED');
    return proof;
  }
  async function admitted(c: CaseManifest) {
    const row = await options.store.get(evidenceKey(c.id));
    if (!row) throw new WorkflowError('SEALED_EVIDENCE_MISSING');
    const sealed = sealCourtEvidence(row.value);
    if (sealed.evidenceHash !== c.evidenceHash || sealed.caseId !== c.id ||
      hashContent(sealed.evidence) !== hashContent(originalEvidence(c)) ||
      c.agreement.courtAddress !== options.court.contractAddress) throw new WorkflowError('EVIDENCE_BINDING_MISMATCH');
    return sealed;
  }
  async function update(id: Hex, evidence: SealedEvidence, patch: Partial<CaseManifest>, event?: { id: string; label: string }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await loadCase(id);
      if (hashContent(originalEvidence(row.value)) !== hashContent(evidence)) throw new WorkflowError('EVIDENCE_BINDING_MISMATCH');
      const at = new Date(now()).toISOString();
      const events = !event || row.value.events.some(item => item.id === event.id) ? row.value.events :
        [...row.value.events.slice(-99), { ...event, kind: 'court', at }];
      const value = CaseManifestSchema.parse({ ...row.value, ...patch, updatedAt: at, events });
      try { return (await options.store.compareAndSwap(caseKey(id), value, row.etag)).value; }
      catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    }
    throw new WorkflowError('CASE_UPDATE_CONFLICT');
  }
  async function saveJob(row: Stored<Job>, patch: Partial<Job>) {
    return options.store.compareAndSwap(jobKey(row.value.caseId), JobSchema.parse({ ...row.value, ...patch }), row.etag);
  }
  async function getJob(id: Hex, evidenceHash: Hex) {
    try { await options.store.create(jobKey(id), { schemaVersion: 1, caseId: id, evidenceHash,
      phase: 'new', registrationHash: null, transactionHash: null }); }
    catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    const row = await options.store.get(jobKey(id));
    if (!row) throw new WorkflowError('COURT_JOB_MISSING');
    const value = JobSchema.parse(row.value);
    if (value.caseId !== id || value.evidenceHash !== evidenceHash) throw new WorkflowError('COURT_JOB_BINDING_MISMATCH');
    return { value, etag: row.etag };
  }
  async function loadEligibility(id: Hex): Promise<RefundContext> {
    const c = (await loadCase(id)).value, payment = await verify(c);
    const sealed = await admitted(c), job = await getJob(id, sealed.evidenceHash);
    if (!job.value.transactionHash) throw new WorkflowError('RULING_TRANSACTION_MISSING');
    const court = await options.court.reconcile({ caseId: id, evidenceHash: sealed.evidenceHash, transactionHash: job.value.transactionHash });
    return { paymentId: id, reservationPaymentId: id, payment, agreementHash: sealed.evidence.agreementHash,
      deliveryHash: sealed.evidence.delivery.hash, evidenceHash: sealed.evidenceHash, court,
      rulingBinding: { finalized: court.verified && court.status === 'finalized', paymentId: id, caseId: id,
        agreementHash: sealed.evidence.agreementHash, deliveryHash: sealed.evidence.delivery.hash,
        evidenceHash: sealed.evidenceHash, transactionHash: job.value.transactionHash },
      operationalApproval: null, alreadyConfirmedRefund: c.refund };
  }
  async function refund(id: Hex, c: CaseManifest, evidence: SealedEvidence) {
    if (!options.refund || !c.payment) return c;
    const result = await options.refund(id, loadEligibility);
    if (result.status === 'NOT_ELIGIBLE') {
      if (result.code === 'ALREADY_CONFIRMED') return c;
      return update(id, evidence, {}, { id: 'refund-' + result.code, label: 'Refund requires attention: ' + result.code });
    }
    const state = result.state, p = c.payment;
    if (state.paymentId !== id || state.reason !== 'quality' || state.authorizer.toLowerCase() !== p.seller.toLowerCase())
      throw new WorkflowError('REFUND_PROOF_BINDING_MISMATCH');
    if (state.proof && (state.proof.reason !== 'quality' || state.proof.authorizer.toLowerCase() !== p.seller.toLowerCase() ||
      state.proof.payer.toLowerCase() !== p.payer.toLowerCase() || state.proof.token !== p.token || state.proof.amount !== p.amount ||
      state.proof.authorizationNonce !== refundIdentity(id, p.seller) ||
      state.proof.transactionHash && !state.transactionHashes.includes(state.proof.transactionHash)))
      throw new WorkflowError('REFUND_PROOF_BINDING_MISMATCH');
    const proof = state.proof ?? { reason: 'quality' as const, status: state.status === 'RESERVE_SHORTFALL' ? 'reserve_shortfall' as const :
      state.status === 'AUTHORIZATION_CANCELED' ? 'canceled' as const :
      ['TX_FAILED', 'GAS_SHORTFALL', 'CHAIN_RECONCILIATION_REQUIRED'].includes(state.status) ? 'failed' as const : 'pending' as const,
      authorizer: c.payment.seller, payer: c.payment.payer, token: c.payment.token, amount: c.payment.amount,
      authorizationNonce: refundIdentity(id, c.payment.seller), transactionHash: state.transactionHashes.at(-1) ?? null,
      blockNumber: null, blockHash: null, verified: false };
    return update(id, evidence, { refund: proof, status: proof.verified && proof.status === 'confirmed' ? 'refunded' : 'refund_pending' },
      { id: 'refund-' + state.status, label: state.status === 'REFUND_CONFIRMED' ? 'Original paid principal returned; transfer confirmed.' : 'Refund: ' + state.status });
  }
  return async function processCase(inputId: string): Promise<CaseManifest> {
    const id = HashSchema.parse(inputId), c = (await loadCase(id)).value;
    if (c.mode === 'simulation' || c.buyerClaim?.action !== 'dispute') return c;
    await verify(c);
    const sealed = await admitted(c), job = await getJob(id, sealed.evidenceHash);
    const pendingCourt = { network: 'studionet' as const, contractAddress: options.court.contractAddress,
      caseId: id, evidenceHash: sealed.evidenceHash, transactionHash: job.value.transactionHash,
      status: 'pending' as const, result: null, verified: false };
    if (job.value.phase === 'new') {
      const claimed = await saveJob(job, { phase: 'registering' });
      const submission = await options.court.registerCase(sealed.evidence);
      await saveJob(claimed, { phase: 'registration_sent', registrationHash: submission.transactionHash });
      return update(id, sealed.evidence, { status: 'court_pending', court: pendingCourt },
        { id: 'court-registration', label: 'Original evidence submitted to Internet Court on GenLayer.' });
    }
    if (job.value.phase === 'registering' || job.value.phase === 'adjudicating') throw new WorkflowError('COURT_SUBMISSION_RECONCILIATION_REQUIRED');
    if (job.value.phase === 'registration_sent') {
      if (!job.value.registrationHash) throw new WorkflowError('REGISTRATION_TRANSACTION_MISSING');
      const registration = await options.court.reconcileRegistration(sealed.evidence, job.value.registrationHash);
      if (registration.status === 'registered') {
        await saveJob(job, { phase: 'registered' });
        return update(id, sealed.evidence, { status: 'court_pending', court: pendingCourt },
          { id: 'court-registered', label: 'Evidence registration finalized; court may now adjudicate.' });
      }
      if (registration.status === 'failed' || registration.status === 'undetermined') {
        await saveJob(job, { phase: 'terminal' });
        return update(id, sealed.evidence, { status: 'unresolved', court: { ...pendingCourt, status: registration.status } },
          { id: 'court-registration-' + registration.status, label: 'Evidence registration did not finalize successfully.' });
      }
      return c;
    }
    if (job.value.phase === 'registered') {
      const claimed = await saveJob(job, { phase: 'adjudicating' });
      const submission = await options.court.submitAdjudication({ caseId: id, evidenceHash: sealed.evidenceHash });
      await saveJob(claimed, { phase: 'adjudication_sent', transactionHash: submission.transactionHash });
      return update(id, sealed.evidence, { status: 'court_pending', court: { ...pendingCourt, transactionHash: submission.transactionHash } },
        { id: 'court-adjudication', label: 'GenLayer validators are judging the agreed quality criteria.' });
    }
    if (!job.value.transactionHash) return c;
    const proof = await options.court.reconcile({ caseId: id, evidenceHash: sealed.evidenceHash, transactionHash: job.value.transactionHash });
    const status = proof.status === 'finalized' ? proof.result?.decision === 'INSUFFICIENT_EVIDENCE' ? 'unresolved' : 'court_finalized' :
      proof.status === 'accepted' ? 'court_provisional' : ['failed', 'undetermined'].includes(proof.status) ? 'unresolved' : 'court_pending';
    if (job.value.phase !== 'terminal' && ['finalized', 'failed', 'undetermined'].includes(proof.status)) await saveJob(job, { phase: 'terminal' });
    const latest = await update(id, sealed.evidence, { court: proof, status: c.refund?.verified && c.refund.status === 'confirmed' ? 'refunded' : status },
      proof.status === 'finalized' ? { id: 'court-finalized', label: 'Independent ruling finalized: ' + proof.result?.decision } : undefined);
    if (job.value.phase === 'terminal' && proof.verified && proof.status === 'finalized' && proof.result?.decision === 'REFUND') return refund(id, latest, sealed.evidence);
    return latest;
  };
}
