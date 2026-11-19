import { createHash, randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { z } from 'zod';
import { AddressSchema, SignatureSchema } from '../domain/schema.js';
import { StorageConflict } from '../storage/index.js';
import { ApiError, type Principal, type ServerOptions } from './types.js';

export const AUTH_LIMITS = {
  challengeTtlSeconds: 300, sessionTtlSeconds: 1800,
  challengeIpPerMinute: 20, challengeWalletPerMinute: 5,
  sessionIpPerMinute: 40, sessionWalletPerMinute: 10,
  challengeIpPerDay: 200, challengeWalletPerDay: 50,
  sessionIpPerDay: 400, sessionWalletPerDay: 100,
} as const;
const IdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ChallengeInput = z.object({ address: AddressSchema }).strict();
const SessionInput = z.object({ challengeId: IdSchema, signature: SignatureSchema }).strict();
const BindingSchema = z.object({
  address: AddressSchema, origin: z.string().url(), network: z.literal('eip155:84532'),
  chainId: z.literal(84532), issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
}).strict();
const ChallengeSchema = BindingSchema.extend({ id: IdSchema, consumedAt: z.number().int().nullable() }).strict();
const CounterSchema = z.object({ count: z.number().int().nonnegative() }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidSession = () => new ApiError('UNAUTHORIZED', 401, 'A valid wallet session or operator access token is required.');

function boundMessage(challenge: z.infer<typeof ChallengeSchema>): string {
  return [
    new URL(challenge.origin).host + ' wants you to sign in to Agent Refund Court with your Ethereum account:',
    challenge.address, '', 'Authenticate buyer access only. This signature authorizes no payment or transaction.', '',
    'URI: ' + challenge.origin, 'Version: 1', 'Chain ID: ' + challenge.chainId,
    'Network: ' + challenge.network, 'Nonce: ' + challenge.id,
    'Issued At: ' + new Date(challenge.issuedAt * 1000).toISOString(),
    'Expiration Time: ' + new Date(challenge.expiresAt * 1000).toISOString(),
  ].join('\n');
}

/** Opaque sessions contain no buyer key, payment permission, or operator authority. */
export class WalletAuthentication {
  constructor(private readonly options: ServerOptions) {}
  private now() { return Math.floor((this.options.now ?? Date.now)() / 1000); }
  private bound(record: z.infer<typeof BindingSchema>, ttl: number) {
    return record.origin === this.options.config.origin && record.network === this.options.config.network &&
      record.chainId === this.options.config.chainId && record.issuedAt <= this.now() &&
      record.expiresAt > this.now() && record.expiresAt - record.issuedAt === ttl;
  }
  async challenge(input: unknown, ip: string) {
    const { address } = ChallengeInput.parse(input);
    await this.limit('challenge', address, ip);
    const issuedAt = this.now(), id = randomBytes(32).toString('hex');
    const challenge = ChallengeSchema.parse({ id, address, origin: this.options.config.origin,
      network: this.options.config.network, chainId: this.options.config.chainId,
      issuedAt, expiresAt: issuedAt + AUTH_LIMITS.challengeTtlSeconds, consumedAt: null });
    await this.options.store.create('auth/challenges/' + id + '.json', challenge);
    return { id, address, message: boundMessage(challenge), expiresAt: challenge.expiresAt };
  }
  async session(input: unknown, ip: string) {
    const { challengeId, signature } = SessionInput.parse(input);
    await this.counter('session/ip/minute/' + hash(ip), AUTH_LIMITS.sessionIpPerMinute, 60);
    await this.counter('session/ip/day/' + hash(ip), AUTH_LIMITS.sessionIpPerDay, 86400);
    const key = 'auth/challenges/' + challengeId + '.json', saved = await this.options.store.get(key);
    if (!saved) throw invalidSession();
    const parsed = ChallengeSchema.safeParse(saved.value);
    if (!parsed.success || parsed.data.id !== challengeId) throw invalidSession();
    const challenge = parsed.data;
    await this.counter('session/wallet/minute/' + hash(challenge.address.toLowerCase()), AUTH_LIMITS.sessionWalletPerMinute, 60);
    await this.counter('session/wallet/day/' + hash(challenge.address.toLowerCase()), AUTH_LIMITS.sessionWalletPerDay, 86400);
    if (challenge.consumedAt !== null || !this.bound(challenge, AUTH_LIMITS.challengeTtlSeconds)) throw invalidSession();
    let verified = false;
    try { verified = await verifyMessage({ address: challenge.address, message: boundMessage(challenge), signature }); }
    catch { throw invalidSession(); }
    if (!verified || !this.bound(challenge, AUTH_LIMITS.challengeTtlSeconds)) throw invalidSession();
    try { await this.options.store.compareAndSwap(key, { ...challenge, consumedAt: this.now() }, saved.etag); }
    catch (error) { if (error instanceof StorageConflict) throw invalidSession(); throw error; }
    if (!this.bound(challenge, AUTH_LIMITS.challengeTtlSeconds)) throw invalidSession();
    const issuedAt = this.now(), accessToken = 'arc_' + randomBytes(32).toString('base64url');
    const session = BindingSchema.parse({ address: challenge.address, origin: challenge.origin,
      network: challenge.network, chainId: challenge.chainId, issuedAt, expiresAt: issuedAt + AUTH_LIMITS.sessionTtlSeconds });
    await this.options.store.create('auth/sessions/' + hash(accessToken) + '.json', session);
    return { accessToken, address: session.address, expiresAt: session.expiresAt };
  }
  async authenticate(accessToken: string): Promise<Principal> {
    if (!/^arc_[A-Za-z0-9_-]{43}$/.test(accessToken)) throw invalidSession();
    const saved = await this.options.store.get('auth/sessions/' + hash(accessToken) + '.json');
    const session = BindingSchema.safeParse(saved?.value);
    if (!session.success || !this.bound(session.data, AUTH_LIMITS.sessionTtlSeconds)) throw invalidSession();
    return { role: 'buyer', address: session.data.address };
  }
  private async limit(action: 'challenge', address: string, ip: string) {
    await this.counter(action + '/ip/minute/' + hash(ip), AUTH_LIMITS.challengeIpPerMinute, 60);
    await this.counter(action + '/ip/day/' + hash(ip), AUTH_LIMITS.challengeIpPerDay, 86400);
    await this.counter(action + '/wallet/minute/' + hash(address.toLowerCase()), AUTH_LIMITS.challengeWalletPerMinute, 60);
    await this.counter(action + '/wallet/day/' + hash(address.toLowerCase()), AUTH_LIMITS.challengeWalletPerDay, 86400);
  }
  private async counter(scope: string, limit: number, window: number) {
    const key = 'auth/limits/' + scope + '/' + Math.floor(this.now() / window) + '.json';
    for (let attempt = 0; attempt < 6; attempt++) {
      const saved = await this.options.store.get(key);
      const count = saved ? CounterSchema.parse(saved.value).count : 0;
      if (count >= limit) throw new ApiError('RATE_LIMITED', 429, 'The wallet sign-in limit was reached. Retry after this window.', window - this.now() % window);
      try {
        if (saved) await this.options.store.compareAndSwap(key, { count: count + 1 }, saved.etag);
        else await this.options.store.create(key, { count: 1 });
        return;
      } catch (error) { if (!(error instanceof StorageConflict)) throw error; }
    }
    throw new ApiError('RETRY_REQUEST', 409, 'Another sign-in request is in progress. Retry the request.');
  }
}
