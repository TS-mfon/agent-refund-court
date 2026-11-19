import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { AddressSchema, AmountSchema, HashSchema, RefundProofSchema, SignatureSchema, BASE_CHAIN_ID, USDC_ADDRESS } from '../domain/schema.js';
import { type StateStore, StorageConflict } from '../storage/index.js';
import type { RefundState, RefundStore } from '../refunds/types.js';
const AuthorizationSchema = z.object({
  paymentId: HashSchema, bindingHash: HashSchema, from: AddressSchema, to: AddressSchema,
  value: AmountSchema, nonce: HashSchema, validAfter: z.string().regex(/^[0-9]+$/), validBefore: z.string().regex(/^[0-9]+$/),
  domain: z.object({ name: z.string().min(1), version: z.string().min(1), chainId: z.literal(BASE_CHAIN_ID), verifyingContract: z.literal(USDC_ADDRESS) }).strict(),
  signature: SignatureSchema, digest: HashSchema,
}).strict();
const StateSchema = z.object({
  paymentId: HashSchema, bindingHash: HashSchema, reason: z.enum(['quality', 'non_delivery']), authorizer: AddressSchema,
  status: z.enum(['AUTHORIZATION_PREPARED', 'BROADCAST', 'CONFIRMING', 'REFUND_CONFIRMED', 'RESERVE_SHORTFALL',
    'GAS_SHORTFALL', 'TX_FAILED', 'AUTHORIZATION_CANCELED', 'CHAIN_RECONCILIATION_REQUIRED']),
  authorization: AuthorizationSchema.nullable(), transactionHashes: z.array(HashSchema).max(100),
  proof: RefundProofSchema.nullable(), errorCode: z.string().max(100).nullable(),
}).strict();
const keyFor = (id: Hex) => 'refunds/' + HashSchema.parse(id) + '.json';
export function createRefundStore(store: StateStore): RefundStore {
  return {
    async load(id) {
      const row = await store.get(keyFor(id)); if (!row) return null;
      const state = StateSchema.parse(row.value);
      if (state.paymentId !== id) throw new Error('REFUND_STATE_ID_MISMATCH');
      return { revision: row.etag, state };
    },
    async save(id, revision, input: RefundState) {
      const state = StateSchema.parse(input);
      if (state.paymentId !== id) throw new Error('REFUND_STATE_ID_MISMATCH');
      try {
        if (revision === null) await store.create(keyFor(id), state);
        else await store.compareAndSwap(keyFor(id), state, revision);
        return true;
      } catch (error) { if (error instanceof StorageConflict) return false; throw error; }
    },
  };
}
const LockSchema = z.object({ owner: z.string().nullable(), expiresAt: z.number().int().nonnegative() }).strict();
/** Verify the exact lease before financial actions; a lost lease cannot release another owner. */
export type SignerLeaseGuard = () => Promise<void>;
export async function withRefundSignerLock<T>(store: StateStore, authorizer: Address, operation: (guard: SignerLeaseGuard) => Promise<T>): Promise<T> {
  const key = 'locks/refund-' + AddressSchema.parse(authorizer).toLowerCase() + '.json';
  try { await store.create(key, { owner: null, expiresAt: 0 }); }
  catch (error) { if (!(error instanceof StorageConflict)) throw error; }
  const row = await store.get(key); if (!row) throw new Error('SIGNER_LOCK_UNAVAILABLE');
  const current = LockSchema.parse(row.value), now = Date.now();
  if (current.owner && current.expiresAt > now) throw new Error('SIGNER_LOCK_BUSY');
  const lock = { owner: randomUUID(), expiresAt: now + 300000 };
  let grant;
  try { grant = await store.compareAndSwap(key, lock, row.etag); }
  catch (error) { if (error instanceof StorageConflict) throw new Error('SIGNER_LOCK_BUSY'); throw error; }
  const guard: SignerLeaseGuard = async () => {
    const current = await store.get(key);
    if (!current) throw new Error('SIGNER_LEASE_LOST');
    const held = LockSchema.parse(current.value);
    // Reserve time for the wallet's bounded RPC preparation and submission.
    if (held.owner !== lock.owner || held.expiresAt !== grant.value.expiresAt || held.expiresAt <= Date.now() + 90000)
      throw new Error('SIGNER_LEASE_LOST');
  };
  try { await guard(); return await operation(guard); }
  finally {
    const current = await store.get(key);
    if (current && LockSchema.parse(current.value).owner === lock.owner) {
      try { await store.compareAndSwap(key, { owner: null, expiresAt: 0 }, current.etag); }
      catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    }
  }
}
