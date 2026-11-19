import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { loadMcpConfig } from '../../src/mcp/config.js';
async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'arc-mcp-config-')), key=generatePrivateKey(),buyer=privateKeyToAccount(key);
  const mandatePath=join(directory,'mandate.json'),walletPath=join(directory,'buyer.json');
  await writeFile(mandatePath,JSON.stringify({allowedOrigins:['https://seller.example'],maxPerPurchaseBaseUnits:'10000',dailyBudgetBaseUnits:'20000'}),{mode:0o600});
  await writeFile(walletPath,JSON.stringify({privateKey:key,address:buyer.address}),{mode:0o600});
  return {directory,key,buyer,mandatePath,walletPath,env:{ARC_MANDATE_FILE:mandatePath,ARC_BUYER_WALLET_FILE:walletPath,ARC_STATE_DIRECTORY:join(directory,'state')}};
}
test('local MCP loads only an explicit buyer source; unrelated merchant keys are ignored',async()=>{
  const f=await fixture();
  try{
    const loaded=await loadMcpConfig({...f.env,SELLER_PRIVATE_KEY:generatePrivateKey(),GENLAYER_REGISTRAR_PRIVATE_KEY:generatePrivateKey()});
    assert.equal(loaded.signer.address,f.buyer.address);
    assert.equal(loaded.directory,f.env.ARC_STATE_DIRECTORY);
    const {ARC_BUYER_WALLET_FILE,...withoutFile}=f.env;
    assert.equal((await loadMcpConfig({...withoutFile,ARC_BUYER_PRIVATE_KEY:f.key})).signer.address,f.buyer.address);
    await assert.rejects(loadMcpConfig({...f.env,ARC_BUYER_PRIVATE_KEY:f.key}),/CONFIGURE_ONE_BUYER_WALLET_SOURCE/);
    await assert.rejects(loadMcpConfig(withoutFile),/ARC_BUYER_WALLET_REQUIRED/);
    await assert.rejects(loadMcpConfig({ARC_BUYER_PRIVATE_KEY:f.key}),/ARC_MANDATE_FILE_REQUIRED/);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
test('shared wallet bundles, public file permissions, relative state and changed wallet address fail closed',async()=>{
  const f=await fixture();
  try{
    await chmod(f.walletPath,0o644);await assert.rejects(loadMcpConfig(f.env),/PRIVATE_CONFIG_PERMISSIONS_REQUIRED/);
    await chmod(f.walletPath,0o600);
    await writeFile(f.walletPath,JSON.stringify({privateKey:f.key,address:privateKeyToAccount(generatePrivateKey()).address}));
    await assert.rejects(loadMcpConfig(f.env),/BUYER_WALLET_INTEGRITY_FAILED/);
    await writeFile(f.walletPath,JSON.stringify({buyer:{privateKey:f.key,address:f.buyer.address},seller:{privateKey:generatePrivateKey()}}));
    await assert.rejects(loadMcpConfig(f.env));
    await writeFile(f.walletPath,JSON.stringify({privateKey:f.key,address:f.buyer.address}));
    await assert.rejects(loadMcpConfig({...f.env,ARC_STATE_DIRECTORY:'relative-state'}),/ARC_STATE_DIRECTORY_MUST_BE_ABSOLUTE/);
    await assert.rejects(loadMcpConfig({...f.env,ARC_MANDATE_FILE:'relative.json'}),/PRIVATE_CONFIG_PATH_MUST_BE_ABSOLUTE/);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
