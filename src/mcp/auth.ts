import { z } from 'zod';
import type { Hex } from 'viem';
import { AddressSchema, SignatureSchema } from '../domain/schema.js';
import { apiRequest, publicApiRequest, responseJSON, demoOrigin, DemoHttpError } from '../workflow/http.js';
export type WalletAuthenticator = { address: string; signMessage: (input: { message: string }) => Promise<Hex> };
const ChallengeSchema = z.object({ challenge: z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), address: AddressSchema, message: z.string().min(1).max(2000),
  expiresAt: z.number().int().positive(),
}).strict() });
const SessionSchema = z.object({ session: z.object({
  accessToken: z.string().regex(/^arc_[A-Za-z0-9_-]{43}$/), address: AddressSchema, expiresAt: z.number().int().positive(),
}).strict() });
export function createWalletSession(options: {
  origin: string; signer: WalletAuthenticator; fetcher?: typeof fetch; now?: () => number; accessToken?: string;
}) {
  const origin = demoOrigin(options.origin), address = AddressSchema.parse(options.signer.address), now = options.now ?? Date.now;
  let cached: z.infer<typeof SessionSchema>['session'] | null = null;
  let signingIn: Promise<string> | null = null;
  async function signIn() {
    const challenge = ChallengeSchema.parse(await responseJSON(await publicApiRequest(origin, '/api/v1/auth/challenge',
      { method: 'POST', body: JSON.stringify({ address }) }, options.fetcher))).challenge;
    const issued = challenge.message.match(/\nIssued At: ([^\n]+)\n/);
    const issuedAt = issued?.[1] ?? '', issuedTime = Date.parse(issuedAt), time = Math.floor(now() / 1000);
    const expected = `${new URL(origin).host} wants you to sign in to Agent Refund Court with your Ethereum account:
${address}

Authenticate buyer access only. This signature authorizes no payment or transaction.

URI: ${origin}
Version: 1
Chain ID: 84532
Network: eip155:84532
Nonce: ${challenge.id}
Issued At: ${issuedAt}
Expiration Time: ${new Date(challenge.expiresAt * 1000).toISOString()}`;
    if (challenge.address !== address || challenge.expiresAt <= time || challenge.expiresAt > time + 300 ||
      !Number.isFinite(issuedTime) || issuedTime > now() + 30000 || issuedTime < now() - 300000 ||
      challenge.message !== expected) throw new DemoHttpError('INVALID_AUTH_CHALLENGE');
    const signature = SignatureSchema.parse(await options.signer.signMessage({ message: challenge.message }));
    const session = SessionSchema.parse(await responseJSON(await publicApiRequest(origin, '/api/v1/auth/session',
      { method: 'POST', body: JSON.stringify({ challengeId: challenge.id, signature }) }, options.fetcher))).session;
    const sessionTime = Math.floor(now() / 1000);
    if (session.address !== address || session.expiresAt <= sessionTime || session.expiresAt > sessionTime + 1800)
      throw new DemoHttpError('INVALID_AUTH_SESSION');
    cached = session;
    return session.accessToken;
  }
  async function token() {
    if (options.accessToken) return options.accessToken;
    if (cached && cached.expiresAt > Math.floor(now() / 1000) + 30) return cached.accessToken;
    if (!signingIn) signingIn = signIn().finally(() => { signingIn = null; });
    return signingIn;
  }
  return {
    token,
    async request(path: string, init?: RequestInit) {
      try { return await apiRequest(origin, await token(), path, init, options.fetcher); }
      catch (error) {
        if (options.accessToken || !(error instanceof DemoHttpError) || error.code !== 'HTTP_401') throw error;
        cached = null;
        return apiRequest(origin, await token(), path, init, options.fetcher);
      }
    },
  };
}
