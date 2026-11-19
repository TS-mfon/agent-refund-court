import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletSession } from '../../src/mcp/auth.js';
const origin = 'https://seller.example', now = 1800000000000;
function fixture(fault?: string) {
  const wallet = privateKeyToAccount(generatePrivateKey()), id = 'ab'.repeat(32);
  const message = `seller.example wants you to sign in to Agent Refund Court with your Ethereum account:
${wallet.address}

Authenticate buyer access only. This signature authorizes no payment or transaction.

URI: ${origin}
Version: 1
Chain ID: 84532
Network: eip155:84532
Nonce: ${id}
Issued At: ${new Date(now).toISOString()}
Expiration Time: ${new Date(now + 300000).toISOString()}`;
  let calls = 0, signatures = 0, clock = now;
  const signer = { address: wallet.address, async signMessage(input: {message:string}) { signatures += 1; if (fault === "delay" || fault === "sessionExpiredAfterDelay" || fault === "sessionTooLong") clock += 1500; return wallet.signMessage(input); } };
  const fetcher: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    if (String(url).endsWith('/challenge')) return Response.json({ challenge: { id, address: wallet.address,
      message: fault === 'origin' ? message.replace(origin, 'https://evil.example') : fault === 'payment' ? message.replace('Authenticate buyer access only.', 'Transfer funds now.') : message,
      expiresAt: fault === 'expiry' ? Math.floor(now/1000)-1 : Math.floor(now/1000)+300 } });
    if (fault === "delay" || fault === "sessionExpiredAfterDelay" || fault === "sessionTooLong") clock += 500;
    return Response.json({ session: { accessToken: 'arc_' + 'a'.repeat(43), address: fault === 'wallet' ? privateKeyToAccount(generatePrivateKey()).address : wallet.address,
      expiresAt: Math.floor(clock/1000) + (fault === "sessionExpiredAfterDelay" ? 0 : fault === "sessionTooLong" ? 1801 : 1800) } });
  };
  return { session: createWalletSession({ origin, signer, fetcher, now: () => clock }), counts: () => ({calls,signatures}) };
}
test('wallet signs a bound expiring access challenge once, with no operator secret', async () => {
  const f = fixture();
  assert.match(await f.session.token(), /^arc_/);
  await f.session.token();
  assert.deepEqual(f.counts(), {calls:2,signatures:1});
});
test('concurrent calls share a single sign-in without disclosing bearer tokens to another origin', async () => {
  const f = fixture();
  assert.equal(new Set(await Promise.all([f.session.token(), f.session.token(), f.session.token()])).size, 1);
  assert.deepEqual(f.counts(), {calls:2,signatures:1});
});
test('changed challenge authority, stale challenges, and different session wallets fail closed', async () => {
  for (const fault of ['origin', 'payment', 'expiry', 'wallet']) {
    const f = fixture(fault); await assert.rejects(f.session.token());
    assert.equal(f.counts().signatures, fault === 'wallet' ? 1 : 0);
  }
});

test("a valid session survives signing and request latency across second boundaries", async () => {
  const f = fixture("delay");
  assert.match(await f.session.token(),/^arc_/);
  assert.deepEqual(f.counts(),{calls:2,signatures:1});
  await f.session.token();
  assert.deepEqual(f.counts(),{calls:2,signatures:1});
});
test("expired and excessive session TTLs remain rejected after delayed signing", async () => {
  for (const fault of ["sessionExpiredAfterDelay","sessionTooLong"]) {
    const f = fixture(fault);
    await assert.rejects(f.session.token(),/INVALID_AUTH_SESSION/);
    assert.deepEqual(f.counts(),{calls:2,signatures:1});
  }
});
