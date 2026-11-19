import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CaseRepository } from './cases.js';
import { ApiError, type ServerOptions } from './types.js';
import { HashSchema, type CaseManifest } from '../domain/schema.js';
import { StorageConflict, type Stored } from '../storage/index.js';

const STATE_KEY = 'activity/visitor-wake.json';
const COOLDOWN_MS = 60000;
const LEASE_MS = 120000;
const CASE_LIMIT = 100;
const StateSchema = z.object({
  schemaVersion: z.literal(1), status: z.enum(['idle', 'running', 'processed', 'failed']),
  runId: z.string().uuid().nullable(), leaseExpiresAt: z.number().int().nonnegative().nullable(),
  nextWakeAt: z.number().int().nonnegative(), lastWakeAt: z.number().int().nonnegative().nullable(),
  lastRunAt: z.number().int().nonnegative().nullable(), lastCaseId: HashSchema.nullable(),
  errorCode: z.literal('WORKER_STEP_FAILED').nullable(),
}).strict();
type ActivityState = z.infer<typeof StateSchema>;
const initial: ActivityState = { schemaVersion: 1, status: 'idle', runId: null, leaseExpiresAt: null,
  nextWakeAt: 0, lastWakeAt: null, lastRunAt: null, lastCaseId: null, errorCode: null };
function pending(c: CaseManifest) {
  if (c.mode === 'simulation' || !c.payment?.verified || !c.evidenceHash || c.buyerClaim?.action !== 'dispute' ||
      !c.agreement.courtAddress || c.agreement.courtNetwork !== 'studionet' ||
      c.refund?.verified && c.refund.status === 'confirmed') return false;
  if (c.status === 'court_finalized') return c.court?.verified && c.court.result?.decision === 'REFUND';
  return ['disputed', 'court_pending', 'court_provisional', 'refund_pending'].includes(c.status);
}
/** Every public wake awaits one existing job step; durable jobs retain transaction and refund identity. */
export class VisitorActivity {
  private readonly cases: CaseRepository;
  constructor(private readonly options: ServerOptions) { this.cases = new CaseRepository(options.store); }
  private now() { return (this.options.now ?? Date.now)(); }
  private enabled() { return Boolean(this.options.config.canWrite && this.options.processCase); }
  private async saved(): Promise<Stored<ActivityState> | null> {
    const row = await this.options.store.get(STATE_KEY);
    if (!row) return null;
    const value = StateSchema.safeParse(row.value);
    if (!value.success) throw new ApiError('ACTIVITY_STATE_UNAVAILABLE', 503, 'Automation state could not be verified.');
    return { value: value.data, etag: row.etag };
  }
  private async candidates() { return (await this.cases.list()).filter(pending).sort((a, b) => a.id.localeCompare(b.id)); }
  private metadata(state: ActivityState, count: number, override?: string) {
    const interrupted = state.status === 'running' && (state.leaseExpiresAt ?? 0) <= this.now();
    return {
      schemaVersion: 1, status: override ?? (!this.enabled() ? 'disabled' : interrupted ? 'interrupted' : state.status),
      automation: { enabled: this.enabled(), mechanism: 'visitor-wake', cooldownSeconds: COOLDOWN_MS / 1000,
        leaseSeconds: LEASE_MS / 1000, maxCasesPerWake: 1, caseScanLimit: CASE_LIMIT, startsPurchases: false },
      lastWakeAt: state.lastWakeAt === null ? null : new Date(state.lastWakeAt).toISOString(),
      lastRunAt: state.lastRunAt === null ? null : new Date(state.lastRunAt).toISOString(),
      pendingCases: count, caseId: state.lastCaseId, errorCode: state.errorCode,
      retryAfterSeconds: Math.max(0, Math.ceil((Math.max(state.nextWakeAt, state.leaseExpiresAt ?? 0) - this.now()) / 1000)),
    };
  }
  async status() {
    const [state, candidates] = await Promise.all([this.saved(), this.candidates()]);
    return this.metadata(state?.value ?? initial, candidates.length);
  }
  async wake() {
    if (!this.enabled()) throw new ApiError('WORKER_NOT_CONFIGURED', 503, 'Visitor automation is not configured.');
    let row = await this.saved();
    if (!row) {
      try { row = await this.options.store.create(STATE_KEY, initial); }
      catch (error) { if (!(error instanceof StorageConflict)) throw error; row = await this.saved(); }
    }
    if (!row) throw new ApiError('ACTIVITY_STATE_UNAVAILABLE', 503, 'Automation state could not be recorded.');
    const now = this.now();
    if (Math.max(row.value.nextWakeAt, row.value.leaseExpiresAt ?? 0) > now)
      return this.metadata(row.value, (await this.candidates()).length, 'cooldown');
    let claim: Stored<ActivityState>;
    try {
      claim = await this.options.store.compareAndSwap(STATE_KEY, { ...row.value, status: 'running',
        runId: randomUUID(), leaseExpiresAt: now + LEASE_MS, nextWakeAt: now + COOLDOWN_MS, lastWakeAt: now, errorCode: null }, row.etag);
    } catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      const latest = await this.saved();
      if (!latest) throw new ApiError('ACTIVITY_STATE_UNAVAILABLE', 503, 'Automation state could not be read.');
      return this.metadata(latest.value, (await this.candidates()).length, 'cooldown');
    }
    let selected: CaseManifest | undefined, count = 0;
    try {
      const candidates = await this.candidates();
      count = candidates.length;
      selected = candidates.find(c => !claim.value.lastCaseId || c.id > claim.value.lastCaseId) ?? candidates[0];
      if (selected) {
        const processed = await this.options.processCase!(selected.id);
        if (processed.id !== selected.id) throw new Error('Activity case identity mismatch');
        if (!pending(processed)) count -= 1;
      }
      const next: ActivityState = { ...claim.value, status: selected ? 'processed' : 'idle', runId: null,
        leaseExpiresAt: null, lastRunAt: selected ? this.now() : claim.value.lastRunAt,
        lastCaseId: selected?.id ?? claim.value.lastCaseId, errorCode: null };
      await this.options.store.compareAndSwap(STATE_KEY, next, claim.etag);
      return this.metadata(next, count);
    } catch (error) {
      if (error instanceof StorageConflict) {
        const latest = await this.saved();
        if (!latest) throw new ApiError('ACTIVITY_STATE_UNAVAILABLE', 503, 'Automation state could not be read.');
        return this.metadata(latest.value, count, 'interrupted');
      }
      const next: ActivityState = { ...claim.value, status: 'failed', runId: null, leaseExpiresAt: null,
        lastRunAt: this.now(), lastCaseId: selected?.id ?? claim.value.lastCaseId, errorCode: 'WORKER_STEP_FAILED' };
      await this.options.store.compareAndSwap(STATE_KEY, next, claim.etag);
      console.error(JSON.stringify({ event: 'activity_worker_failed', caseId: selected?.id ?? null, code: 'WORKER_STEP_FAILED' }));
      return this.metadata(next, count);
    }
  }
}
