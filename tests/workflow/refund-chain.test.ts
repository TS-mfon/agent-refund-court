import test from 'node:test';
import assert from 'node:assert/strict';
import { custom, decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { REFUND_TOKEN_ABI } from '../../src/refunds/authorization.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import { createViemRefundChain, createRefundExecutor } from '../../src/workflow/refund-chain.js';
import { workerFixture } from '../refunds/worker-fixture.js';
const hash = ('0x' + 'ab'.repeat(32)) as Hex;
function rpc(chainId = 84532, options: { gas?: bigint; beforeBalance?: () => Promise<void> } = {}) {
  let logs = 0; let methods: string[] = [];
  const transport = custom({ request: async ({ method, params }: {method:string;params?:unknown}) => {
    methods = [...methods, method];
    const values = params as Array<Record<string,unknown>>;
    if (method === 'eth_chainId') return '0x' + chainId.toString(16);
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_getBalance') { await options.beforeBalance?.(); return '0x' + (options.gas ?? 16n).toString(16); }
    if (method === 'eth_getTransactionReceipt') return null;
    if (method === 'eth_getLogs') { logs += 1; return []; }
    if (method === 'eth_getBlockByNumber') return { number:'0x64',hash,parentHash:hash,timestamp:'0x3e8',transactions:[],nonce:'0x0000000000000000',
      sha3Uncles:hash,logsBloom:'0x'+'00'.repeat(256),miner:'0x'+'11'.repeat(20),difficulty:'0x0',totalDifficulty:'0x0',
      extraData:'0x',size:'0x1',gasLimit:'0x100000',gasUsed:'0x0',baseFeePerGas:'0x1' };
    if (method === 'eth_call') {
      const decoded = decodeFunctionData({ abi: REFUND_TOKEN_ABI, data: values[0].data as Hex });
      if (decoded.functionName === 'name' || decoded.functionName === 'version') return encodeFunctionResult({ abi: REFUND_TOKEN_ABI, functionName:decoded.functionName, result: decoded.functionName === 'name' ? 'USDC' : '2' });
      if (decoded.functionName === 'decimals') return encodeFunctionResult({ abi: REFUND_TOKEN_ABI, functionName:'decimals', result:6 });
      if (decoded.functionName === 'balanceOf') return encodeFunctionResult({ abi: REFUND_TOKEN_ABI, functionName:'balanceOf', result:10000n });
      if (decoded.functionName === 'authorizationState') return encodeFunctionResult({ abi: REFUND_TOKEN_ABI, functionName:'authorizationState', result:false });
    }
    throw new Error('UNEXPECTED_TEST_RPC_' + method);
  } }, { retryCount: 0 });
  return { transport, logs: () => logs, methods: () => methods };
}
test('read-only Base adapter checks token metadata, balances, receipts and fixed nonce history', async () => {
  const mock = rpc(), chain = createViemRefundChain({ transport: mock.transport, fromBlock: 90n });
  const observation = await chain.observation();
  assert.equal(observation.chainId,84532); assert.equal(observation.headBlockNumber,100n);
  assert.deepEqual(observation.token,{hasCode:true,decimals:6,name:'USDC',version:'2'});
  const f = workerFixture();
  assert.deepEqual(await chain.balances(f.eligible.from),{token:10000n,gas:16n});
  assert.equal(await chain.authorizationState(f.eligible.from,f.eligible.nonce,100n),false);
  assert.equal(await chain.receipt(hash),null); assert.deepEqual(await chain.block(100n),{number:100n,hash});
  assert.deepEqual(await chain.authorizationHistory(f.eligible.from,f.eligible.nonce,0n,100n),[]);
  assert.equal(mock.logs(),2);
  await assert.rejects(chain.broadcast({} as never),/READ_ONLY_REFUND_CHAIN/);
});
test('refund history scan cannot escape the payment block or scan without a bound', async () => {
  const f=workerFixture(),mock=rpc(),chain=createViemRefundChain({transport:mock.transport,fromBlock:101n});
  assert.deepEqual(await chain.authorizationHistory(f.eligible.from,f.eligible.nonce,0n,100n),[]);
  await assert.rejects(chain.authorizationHistory(f.eligible.from,f.eligible.nonce,0n,100000n),/REFUND_HISTORY_SCAN_LIMIT/);
  assert.equal(mock.logs(),0);
});
test('runtime executor refuses signer policy mismatch and wrong chain before signing', async () => {
  const privateKey=generatePrivateKey(),account=privateKeyToAccount(privateKey),f=workerFixture(),store=new MemoryStateStore();
  assert.throws(()=>createRefundExecutor({store,privateKey,courtContractAddress:f.deps.policy.courtContractAddress,
    policy:{authorizer:f.eligible.from}}),/REFUND_SIGNER_POLICY_MISMATCH/);
  const executor=createRefundExecutor({store,privateKey,transport:rpc(1).transport,courtContractAddress:f.deps.policy.courtContractAddress});
  const context={...f.context,payment:{...f.context.payment,seller:account.address}};
  const result=await executor(f.paymentId,async()=>context);
  assert.equal(result.status,'CHAIN_RECONCILIATION_REQUIRED');
  assert.equal(result.state.authorization,null);
});

test('an expired signer lease prevents authorization signing', async () => {
  const privateKey=generatePrivateKey(),account=privateKeyToAccount(privateKey),f=workerFixture(),store=new MemoryStateStore();
  const lockKey='locks/refund-'+account.address.toLowerCase()+'.json';
  const mock=rpc(84532,{gas:2000000000000000n,beforeBalance:async()=>{
    const row=await store.get<{owner:string;expiresAt:number}>(lockKey);assert.ok(row);
    await store.compareAndSwap(lockKey,{...row.value,expiresAt:Date.now()+1000},row.etag);
  }});
  const executor=createRefundExecutor({store,privateKey,transport:mock.transport,courtContractAddress:f.deps.policy.courtContractAddress});
  const context={...f.context,payment:{...f.context.payment,seller:account.address}};
  const result=await executor(f.paymentId,async()=>context);
  assert.notEqual(result.status,'NOT_ELIGIBLE');
  if('state' in result)assert.equal(result.state.authorization,null);
  assert.equal(mock.methods().includes('eth_getTransactionCount'),false);
});
test('a lease lost after authorization preparation prevents a gas-wallet broadcast', async () => {
  const privateKey=generatePrivateKey(),account=privateKeyToAccount(privateKey),f=workerFixture(),store=new MemoryStateStore();
  const lockKey='locks/refund-'+account.address.toLowerCase()+'.json',mock=rpc(84532,{gas:2000000000000000n});
  let loads=0;const context={...f.context,payment:{...f.context.payment,seller:account.address}};
  const executor=createRefundExecutor({store,privateKey,transport:mock.transport,courtContractAddress:f.deps.policy.courtContractAddress});
  const result=await executor(f.paymentId,async()=>{
    loads+=1;if(loads===3){const row=await store.get<{owner:string;expiresAt:number}>(lockKey);assert.ok(row);
      await store.compareAndSwap(lockKey,{...row.value,expiresAt:Date.now()+1000},row.etag);}
    return context;
  });
  assert.equal(result.status,'TX_FAILED');
  if('state' in result){assert.ok(result.state.authorization);assert.equal(result.state.transactionHashes.length,0);}
  assert.equal(mock.methods().includes('eth_getTransactionCount'),false);
});
