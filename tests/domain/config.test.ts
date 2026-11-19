import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { privateKeyToAccount } from 'viem/accounts';
const secret = ('0x' + '11'.repeat(32)) as `0x${string}`;
test('server wallets are configured and must match the intended seller', () => {
  const address=privateKeyToAccount(secret).address;
  const c=loadConfig({SELLER_ADDRESS:address,SELLER_PRIVATE_KEY:secret,GENLAYER_REGISTRAR_PRIVATE_KEY:secret});
  assert.equal(c.sellerKey,secret);assert.equal(c.registrarKey,secret);
  assert.throws(()=>loadConfig({SELLER_ADDRESS:'0x'+'22'.repeat(20),SELLER_PRIVATE_KEY:secret}));
});
test('origins, model and remote RPCs are constrained at startup',()=>{
  assert.equal(loadConfig({}).model,'gemini-3.1-flash-lite');
  for(const origin of ['https://user:password@example.com','https://example.com/path','https://example.com?x=1','http://external.example'])
    assert.throws(()=>loadConfig({SERVICE_ORIGIN:origin}));
  assert.throws(()=>loadConfig({MODEL_ID:'gemini-pro'}));
  assert.throws(()=>loadConfig({BASE_RPC_URL:'file:///etc/passwd'}));
  assert.equal(loadConfig({SERVICE_ORIGIN:'https://example.com/'}).origin,'https://example.com');
});

test('public wallet purchases do not depend on an optional operator access token', () => {
  const seller = privateKeyToAccount(secret).address;
  const config = loadConfig({ SELLER_ADDRESS: seller, SELLER_PRIVATE_KEY: secret,
    RECEIPT_SIGNER_PRIVATE_KEY: secret, GENLAYER_REGISTRAR_PRIVATE_KEY: secret,
    GENLAYER_CONTRACT: '0x' + '22'.repeat(20), BLOB_READ_WRITE_TOKEN: 'unit-test-store' });
  assert.equal(config.accessToken, null);
  assert.equal(config.canWrite, true);
});
