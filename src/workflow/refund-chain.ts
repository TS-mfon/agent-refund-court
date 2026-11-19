import { createPublicClient, createWalletClient, http, parseAbiItem, TransactionReceiptNotFoundError, type Hex, type Log, type Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { USDC_ADDRESS } from '../domain/schema.js';
import { REFUND_TOKEN_ABI, refundAuthorizationTypedData, refundTransferCall } from '../refunds/authorization.js';
import { runRefundWorker } from '../refunds/worker.js';
import type { RefundChain, RefundContext, RefundLog, RefundPolicy, RefundWorkerResult } from '../refunds/types.js';
import type { StateStore } from '../storage/index.js';
import { createRefundStore, withRefundSignerLock, type SignerLeaseGuard } from './refund-store.js';
const usedEvent = parseAbiItem('event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)');
const canceledEvent = parseAbiItem('event AuthorizationCanceled(address indexed authorizer,bytes32 indexed nonce)');
export function chainLog(log: Log): RefundLog {
  return { address: log.address, topics: [...log.topics], data: log.data, transactionHash: log.transactionHash,
    blockNumber: log.blockNumber, blockHash: log.blockHash, logIndex: log.logIndex, removed: log.removed };
}
export function createViemRefundChain(options: { privateKey?: Hex; rpcUrl?: string; fromBlock: bigint; transport?: Transport }): RefundChain {
  const transport = options.transport ?? http(options.rpcUrl ?? 'https://sepolia.base.org', { timeout: 10000, retryCount: 0 });
  const account = options.privateKey ? privateKeyToAccount(options.privateKey) : undefined;
  const client = createPublicClient({ chain: baseSepolia, transport, cacheTime: 0 });
  const wallet = account ? createWalletClient({ chain: baseSepolia, transport, account }) : undefined;
  return {
    async observation() {
      const [chainId, headBlockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      const [block, code, decimals, name, version] = await Promise.all([
        client.getBlock({ blockNumber: headBlockNumber }), client.getCode({ address: USDC_ADDRESS }),
        client.readContract({ address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'decimals' }),
        client.readContract({ address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'name' }),
        client.readContract({ address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'version' }),
      ]);
      return { chainId, headBlockNumber, timestampSeconds: Number(block.timestamp),
        token: { hasCode: !!code && code !== '0x', decimals, name, version } };
    },
    async balances(authorizer) {
      const [token, gas] = await Promise.all([
        client.readContract({ address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'balanceOf', args: [authorizer] }),
        client.getBalance({ address: authorizer }),
      ]);
      return { token, gas };
    },
    authorizationState: (authorizer, nonce, blockNumber) =>
      client.readContract({ address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'authorizationState', args: [authorizer, nonce], blockNumber }),
    async authorizationHistory(authorizer, nonce, _fromBlock, toBlock) {
      const from = options.fromBlock;
      if (from > toBlock) return [];
      if (toBlock - from > 50000n) throw new Error('REFUND_HISTORY_SCAN_LIMIT');
      let logs: RefundLog[] = [];
      for (let start = from; start <= toBlock; start += 1000n) {
        const end = start + 999n > toBlock ? toBlock : start + 999n;
        const batches = await Promise.all([usedEvent, canceledEvent].map(event =>
          client.getLogs({ address: USDC_ADDRESS, event, args: { authorizer, nonce }, fromBlock: start, toBlock: end })));
        logs = [...logs, ...batches.flat().map(chainLog)];
      }
      return logs;
    },
    async receipt(transactionHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: transactionHash });
        return { transactionHash: receipt.transactionHash, status: receipt.status, blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash, logs: receipt.logs.map(chainLog) };
      } catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; }
    },
    async block(blockNumber) {
      const block = await client.getBlock({ blockNumber }); if (!block.hash || block.number === null) throw new Error('REFUND_BLOCK_UNAVAILABLE');
      return { number: block.number, hash: block.hash };
    },
    broadcast: async authorization => { if (!wallet) throw new Error('READ_ONLY_REFUND_CHAIN'); return wallet.writeContract(refundTransferCall(authorization)); },
  };
}
export function createRefundExecutor(options: {
  store: StateStore; privateKey: Hex; rpcUrl?: string; transport?: Transport; courtContractAddress: string; policy?: Partial<RefundPolicy>;
}) {
  const account = privateKeyToAccount(options.privateKey);
  const policy: RefundPolicy = { authorizer: account.address, courtNetwork: 'studionet', courtContractAddress: options.courtContractAddress,
    confirmations: 2, authorizationLifetimeSeconds: 300, minimumGasBalanceWei: '1000000000000',
    usdcDomain: { name: 'USDC', version: '2' }, ...options.policy };
  if (policy.authorizer.toLowerCase() !== account.address.toLowerCase()) throw new Error('REFUND_SIGNER_POLICY_MISMATCH');
  return async function execute(caseId: Hex, loadEligibility: (id: Hex) => Promise<RefundContext>): Promise<RefundWorkerResult> {
    const context = await loadEligibility(caseId);
    const chain = createViemRefundChain({ privateKey: options.privateKey, rpcUrl: options.rpcUrl, transport: options.transport, fromBlock: BigInt(context.payment.blockNumber) });
    let leaseGuard: SignerLeaseGuard | null = null;
    const assertHeld = async () => { if (!leaseGuard) throw new Error('SIGNER_LOCK_NOT_HELD'); await leaseGuard(); };
    const protectedChain: RefundChain = { ...chain, broadcast: async authorization => { await assertHeld(); return chain.broadcast(authorization); } };
    return runRefundWorker(caseId, { policy, chain: protectedChain, store: createRefundStore(options.store), loadEligibility,
      signer: { address: account.address, signAuthorization: async authorization => {
        await assertHeld(); return account.signTypedData(refundAuthorizationTypedData(authorization));
      } },
      withSignerLock: (authorizer, operation) => withRefundSignerLock(options.store, authorizer, async guard => {
        leaseGuard = guard;
        try { return await operation(); } finally { leaseGuard = null; }
      }) });
  };
}
