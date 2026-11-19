import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi,
  type Address, type Hex, type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  createAgreement, hashContent, recordTypedData,
} from '../../src/domain/identity.js';
import { SAMPLE_BRIEF, USDC_ADDRESS } from '../../src/domain/schema.js';
import { MemoryStateStore } from '../../src/storage/index.js';
import {
  createPaymentRequired, prepareCheckout, type PaymentContext,
} from '../../src/payments/index.js';
import { BaseUSDCProofVerifier } from '../../src/payments/proof.js';

const TX = ('0x' + '51'.repeat(32)) as Hex;
const BLOCK = ('0x' + '52'.repeat(32)) as Hex;
const OTHER_BLOCK = ('0x' + '53'.repeat(32)) as Hex;
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const events = parseAbi([
  'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const bytesCall = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
]);
const rsvCall = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
]);

async function contextFixture() {
  const buyer = privateKeyToAccount(generatePrivateKey());
  const seller = privateKeyToAccount(generatePrivateKey());
  const agreement = createAgreement({
    buyer: buyer.address, seller: seller.address, receiptSigner: seller.address,
    origin: 'http://127.0.0.1:3001', brief: SAMPLE_BRIEF,
    now: Math.floor(Date.now() / 1000),
  });
  return prepareCheckout({
    agreement,
    sellerSignature: await seller.signTypedData(
      recordTypedData('agreement', hashContent(agreement)),
    ),
    buyerAcceptance: await buyer.signTypedData(
      recordTypedData('acceptance', hashContent(agreement)),
    ),
    required: createPaymentRequired(agreement),
    signer: buyer, store: new MemoryStateStore(),
    policy: {
      seller: seller.address, origin: agreement.origin, amount: agreement.amount,
    },
  });
}

type RpcOptions = {
  chainId?: number;
  authorizationUsed?: boolean;
  missingEvent?: 'AuthorizationUsed' | 'Transfer';
  transferToken?: Address;
  transferRecipient?: Address;
  transferAmount?: bigint;
  callAmount?: bigint;
  canonicalBlockHash?: Hex;
  status?: 'success' | 'reverted';
  confirmations?: number;
  signatureForm?: 'bytes' | 'rsv';
  noRecoveryLogs?: boolean;
};

function rpcFixture(context: PaymentContext, options: RpcOptions = {}) {
  const a = context.payment.payload.authorization;
  const head = 10_000n;
  const minedAt = head - BigInt((options.confirmations ?? 3) - 1);
  const baseTime = BigInt(context.agreement.createdAt + 8) - head * 2n;
  const authorizationEvent = {
    address: USDC_ADDRESS, data: '0x' as Hex,
    topics: encodeEventTopics({
      abi: events, eventName: 'AuthorizationUsed',
      args: { authorizer: a.from as Address, nonce: a.nonce as Hex },
    }),
    transactionHash: TX,
  };
  const transferEvent = {
    address: options.transferToken ?? USDC_ADDRESS,
    topics: encodeEventTopics({
      abi: events, eventName: 'Transfer',
      args: {
        from: a.from as Address,
        to: options.transferRecipient ?? a.to as Address,
      },
    }),
    data: encodeAbiParameters(
      [{ type: 'uint256' }], [options.transferAmount ?? BigInt(a.value)],
    ),
    transactionHash: TX,
  };
  const args = [
    a.from as Address, a.to as Address, options.callAmount ?? BigInt(a.value),
    BigInt(a.validAfter), BigInt(a.validBefore), a.nonce as Hex,
  ] as const;
  const signature = context.payment.payload.signature;
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const input = options.signatureForm === 'rsv' ?
    encodeFunctionData({
      abi: rsvCall, functionName: 'transferWithAuthorization',
      args: [
        ...args, v < 27 ? v + 27 : v,
        ('0x' + signature.slice(2, 66)) as Hex,
        ('0x' + signature.slice(66, 130)) as Hex,
      ],
    }) :
    encodeFunctionData({
      abi: bytesCall, functionName: 'transferWithAuthorization',
      args: [...args, signature],
    });
  const logs = [
    ...(options.missingEvent === 'AuthorizationUsed' ? [] : [authorizationEvent]),
    ...(options.missingEvent === 'Transfer' ? [] : [transferEvent]),
  ];
  const client = {
    async getChainId() { return options.chainId ?? 84532; },
    async getBlockNumber() { return head; },
    async readContract() { return options.authorizationUsed ?? true; },
    async getTransactionReceipt() {
      return {
        transactionHash: TX, blockNumber: minedAt, blockHash: BLOCK,
        status: options.status ?? 'success', logs,
      };
    },
    async getTransaction() {
      return { hash: TX, to: USDC_ADDRESS, blockHash: BLOCK, input };
    },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      return {
        number: blockNumber,
        hash: blockNumber === minedAt ?
          options.canonicalBlockHash ?? BLOCK : OTHER_BLOCK,
        timestamp: baseTime + blockNumber * 2n,
      };
    },
    async getLogs(query: {
      address: Address;
      args: { authorizer: Address; nonce: Hex };
      fromBlock: bigint; toBlock: bigint;
    }) {
      // Model an RPC that rejects unbounded scans and filters indexed topics.
      if (query.toBlock - query.fromBlock + 1n > 1000n) {
        throw new Error('RPC block range exceeded');
      }
      if (options.noRecoveryLogs ||
          query.address !== USDC_ADDRESS ||
          query.args.authorizer !== a.from ||
          query.args.nonce !== a.nonce ||
          minedAt < query.fromBlock || minedAt > query.toBlock) return [];
      return [authorizationEvent];
    },
  } as unknown as PublicClient;
  return new BaseUSDCProofVerifier({ client });
}

test('confirms original USDC authorization and transfer with bytes signature calldata', async () => {
  const context = await contextFixture();
  const result = await rpcFixture(context).prove(context, TX);
  assert.equal(result.authorizationUsed, true);
  assert.deepEqual(result.proof, {
    chainId: 84532, network: 'eip155:84532', token: USDC_ADDRESS,
    payer: context.agreement.buyer, seller: context.agreement.seller,
    amount: context.agreement.amount,
    authorizationNonce: context.payment.payload.authorization.nonce,
    transactionHash: TX, blockNumber: '9998', blockHash: BLOCK, verified: true,
  });
});

test('confirms the original authorization with SDK-compatible v/r/s calldata', async () => {
  const context = await contextFixture();
  const result = await rpcFixture(context, { signatureForm: 'rsv' }).prove(context, TX);
  assert.equal(result.proof?.verified, true);
  assert.equal(result.proof?.transactionHash, TX);
});

test('recovers the same paid authorization without a transaction hint using bounded RPC queries', async () => {
  const context = await contextFixture();
  const result = await rpcFixture(context).prove(context);
  assert.equal(result.proof?.authorizationNonce,
    context.payment.payload.authorization.nonce);
  assert.equal(result.proof?.transactionHash, TX);
});

test('unused authorization cannot be mistaken for confirmed payment', async () => {
  const context = await contextFixture();
  assert.deepEqual(
    await rpcFixture(context, { authorizationUsed: false }).prove(context, TX),
    { authorizationUsed: false, proof: null },
  );
});

test('used authorization without matching transfer evidence remains unresolved', async () => {
  const context = await contextFixture();
  assert.deepEqual(
    await rpcFixture(context, { noRecoveryLogs: true }).prove(context),
    { authorizationUsed: true, proof: null },
  );
});

const invalidEvidence: [string, RpcOptions][] = [
  ['missing authorization-used event', { missingEvent: 'AuthorizationUsed' }],
  ['missing transfer event', { missingEvent: 'Transfer' }],
  ['transfer emitted by another token', { transferToken: OTHER_ADDRESS }],
  ['transfer to another recipient', { transferRecipient: OTHER_ADDRESS }],
  ['wrong transfer amount', { transferAmount: 20_000n }],
  ['changed authorization calldata', { callAmount: 20_000n }],
  ['reverted settlement transaction', { status: 'reverted' }],
  ['receipt from a noncanonical block', { canonicalBlockHash: OTHER_BLOCK }],
  ['insufficient confirmation depth', { confirmations: 1 }],
];
for (const [label, options] of invalidEvidence) {
  test('rejects ' + label, async () => {
    const context = await contextFixture();
    assert.equal((await rpcFixture(context, options).prove(context, TX)).proof, null);
  });
}

test('rejects an RPC connected to the wrong chain', async () => {
  const context = await contextFixture();
  await assert.rejects(
    rpcFixture(context, { chainId: 8453 }).prove(context, TX),
    (error: unknown) => error instanceof Error &&
      'code' in error && error.code === 'WRONG_CHAIN',
  );
});
