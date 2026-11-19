import {
  decodeEventLog, decodeFunctionData, parseAbi, parseAbiItem,
  TransactionReceiptNotFoundError, TransactionNotFoundError,
  type PublicClient, type Hex, type Address,
} from 'viem';
import {
  BASE_CHAIN_ID, BASE_NETWORK, USDC_ADDRESS,
  HashSchema, PaymentProofSchema,
} from '../domain/schema.js';
import { PaymentError, type PaymentContext } from './context.js';
import type { ChainProofVerifier, VerifiedPaymentProof } from './service.js';

const abi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)',
  'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const usedEvent = parseAbiItem(
  'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)',
);
function same(one: unknown, two: string) {
  return typeof one === 'string' && one.toLowerCase() === two.toLowerCase();
}
function matchesCall(data: Hex, context: PaymentContext) {
  try {
    const decoded = decodeFunctionData({ abi, data });
    if (decoded.functionName !== 'transferWithAuthorization') return false;
    const args = decoded.args as readonly unknown[];
    const a = context.payment.payload.authorization;
    if (!same(args[0], a.from) || !same(args[1], a.to) ||
        args[2] !== BigInt(a.value) ||
        args[3] !== BigInt(a.validAfter) ||
        args[4] !== BigInt(a.validBefore) || !same(args[5], a.nonce)) return false;
    const signature = context.payment.payload.signature;
    if (args.length === 7) return same(args[6], signature);
    if (args.length !== 9 || signature.length !== 132) return false;
    const v = Number.parseInt(signature.slice(130, 132), 16);
    return Number(args[6]) === (v < 27 ? v + 27 : v) &&
      same(args[7], '0x' + signature.slice(2, 66)) &&
      same(args[8], '0x' + signature.slice(66, 130));
  } catch {
    return false;
  }
}

/**
 * Supports the direct USDC EIP-3009 transfer used by the exact SDK scheme.
 * An aggregate transaction is not accepted without matching call evidence.
 */
export class BaseUSDCProofVerifier implements ChainProofVerifier {
  private readonly confirmations: bigint;
  private readonly maxScanBlocks: bigint;
  constructor(private readonly options: {
    client: PublicClient;
    minConfirmations?: number;
    maxScanBlocks?: number;
  }) {
    const confirmations = options.minConfirmations ?? 2;
    const maxScanBlocks = options.maxScanBlocks ?? 100_000;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1 ||
        confirmations > 100 || !Number.isSafeInteger(maxScanBlocks) ||
        maxScanBlocks < 1 || maxScanBlocks > 100_000) {
      throw new Error('Invalid chain proof limits');
    }
    this.confirmations = BigInt(confirmations);
    this.maxScanBlocks = BigInt(maxScanBlocks);
  }

  async prove(context: PaymentContext, transactionHint?: string | null) {
    const client = this.options.client;
    if (await client.getChainId() !== BASE_CHAIN_ID) {
      throw new PaymentError('WRONG_CHAIN');
    }
    const a = context.payment.payload.authorization;
    const head = await client.getBlockNumber();
    const authorizationUsed = await client.readContract({
      address: USDC_ADDRESS as Address, abi,
      functionName: 'authorizationState',
      args: [a.from as Address, a.nonce as Hex], blockNumber: head,
    });
    if (!authorizationUsed) return { authorizationUsed: false, proof: null };
    if (transactionHint) {
      const proof = await this.inspect(
        context, HashSchema.parse(transactionHint), head,
      );
      if (proof) return { authorizationUsed: true, proof };
    }
    const hashes = await this.findTransactions(context, head);
    for (const hash of hashes) {
      const proof = await this.inspect(context, hash, head);
      if (proof) return { authorizationUsed: true, proof };
    }
    return { authorizationUsed: true, proof: null };
  }

  private async inspect(
    context: PaymentContext, hash: Hex, head: bigint,
  ): Promise<VerifiedPaymentProof | null> {
    const client = this.options.client;
    let receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>;
    let transaction: Awaited<ReturnType<PublicClient['getTransaction']>>;
    try {
      receipt = await client.getTransactionReceipt({ hash });
      transaction = await client.getTransaction({ hash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError ||
          error instanceof TransactionNotFoundError) return null;
      throw error;
    }
    if (receipt.status !== 'success' ||
        head < receipt.blockNumber ||
        head - receipt.blockNumber + 1n < this.confirmations ||
        !same(transaction.to, USDC_ADDRESS) ||
        transaction.blockHash !== receipt.blockHash ||
        !matchesCall(transaction.input, context)) return null;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const a = context.payment.payload.authorization;
    if (block.hash !== receipt.blockHash ||
        block.timestamp <= BigInt(a.validAfter) ||
        block.timestamp >= BigInt(a.validBefore)) return null;
    const events = receipt.logs
      .filter(log => same(log.address, USDC_ADDRESS))
      .flatMap(log => {
        try {
          return [decodeEventLog({
            abi, data: log.data, topics: log.topics, strict: true,
          })];
        } catch {
          return [];
        }
      });
    const used = events.filter(event =>
      event.eventName === 'AuthorizationUsed' &&
      same(event.args.authorizer, a.from) && same(event.args.nonce, a.nonce),
    );
    const transferred = events.filter(event =>
      event.eventName === 'Transfer' &&
      same(event.args.from, a.from) && same(event.args.to, a.to) &&
      event.args.value === BigInt(a.value),
    );
    if (used.length !== 1 || transferred.length !== 1) return null;
    const usedAtReceipt = await client.readContract({
      address: USDC_ADDRESS as Address, abi,
      functionName: 'authorizationState',
      args: [a.from as Address, a.nonce as Hex],
      blockNumber: receipt.blockNumber,
    });
    if (!usedAtReceipt) return null;
    return PaymentProofSchema.parse({
      chainId: BASE_CHAIN_ID, network: BASE_NETWORK, token: USDC_ADDRESS,
      payer: a.from, seller: a.to, amount: a.value,
      authorizationNonce: a.nonce,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash, verified: true,
    });
  }

  private async firstBlockAtOrAfter(timestamp: bigint, head: bigint) {
    let left = 0n, right = head + 1n;
    while (left < right) {
      const mid = left + (right - left) / 2n;
      const block = await this.options.client.getBlock({ blockNumber: mid });
      if (block.timestamp < timestamp) left = mid + 1n;
      else right = mid;
    }
    return left;
  }

  private async findTransactions(context: PaymentContext, head: bigint) {
    const a = context.payment.payload.authorization;
    // The signed quote narrows recovery without requiring a facilitator tx hash.
    const earliest = BigInt(Math.max(0, context.agreement.createdAt - 600));
    const from = await this.firstBlockAtOrAfter(earliest, head);
    const afterExpiry = await this.firstBlockAtOrAfter(BigInt(a.validBefore), head);
    const to = afterExpiry > head ? head : afterExpiry - 1n;
    if (from > to) return [];
    if (to - from + 1n > this.maxScanBlocks) {
      throw new PaymentError('CHAIN_SCAN_LIMIT');
    }
    let hashes: Hex[] = [];
    for (let start = from; start <= to; start += 1000n) {
      const end = start + 999n > to ? to : start + 999n;
      const logs = await this.options.client.getLogs({
        address: USDC_ADDRESS as Address, event: usedEvent,
        args: { authorizer: a.from as Address, nonce: a.nonce as Hex },
        fromBlock: start, toBlock: end,
      });
      hashes = [
        ...hashes,
        ...logs.flatMap(log => log.transactionHash ? [log.transactionHash] : []),
      ];
    }
    return [...new Set(hashes)];
  }
}
