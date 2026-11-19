import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import {
  TransactionHashVariant,
  TransactionStatus,
  type TransactionHash,
} from 'genlayer-js/types';
import { z } from 'zod';
import { type Hex } from 'viem';
import { AddressSchema, HashSchema } from '../src/domain/schema.js';
import { hashContent } from '../src/domain/identity.js';
import { COURT_RUNNER } from '../src/court/evidence.js';
import {
  deploymentAddress,
  executionSucceeded,
  receiptStatus,
  record,
} from '../src/court/receipt.js';

const STUDIO_RPC = 'https://studio.genlayer.com/api';
const STUDIO_CHAIN_ID = 61999;
const RUBRIC_VERSION = 'launch-plan-v1';
const PrivateKeySchema = z.string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform(value => value as Hex);

const WalletSchema = z.object({
  registrar: z.object({
    privateKey: PrivateKeySchema,
    address: AddressSchema,
  }),
});

function checkedAccount(privateKey: Hex, storedAddress?: string) {
  const account = createAccount(privateKey);
  const expected = process.env.GENLAYER_REGISTRAR_ADDRESS;
  if (
    (storedAddress && account.address.toLowerCase() !== storedAddress.toLowerCase())
    || (expected !== undefined
      && account.address.toLowerCase() !== AddressSchema.parse(expected).toLowerCase())
  ) {
    throw new Error('Registrar identity mismatch');
  }
  return account;
}

async function loadRegistrar() {
  const environmentKey = process.env.GENLAYER_REGISTRAR_PRIVATE_KEY;
  if (environmentKey !== undefined) {
    return checkedAccount(PrivateKeySchema.parse(environmentKey));
  }

  const path = join(
    homedir(),
    '.config',
    'agent-refund-court',
    'wallets.json',
  );
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error('Private wallet file must have restricted permissions');
  }
  const wallet = WalletSchema.parse(
    JSON.parse(await readFile(path, 'utf8')),
  ).registrar;
  return checkedAccount(wallet.privateKey, wallet.address);
}

function reconcileArgument(): Hex | undefined {
  const args = process.argv.slice(2);
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== '--reconcile') {
    throw new Error('Use --reconcile followed by a deployment transaction hash');
  }
  return HashSchema.parse(args[1]);
}

let phase = 'configuration';
let submittedHash: Hex | undefined;

async function main() {
  const reconcileHash = reconcileArgument();
  if (
    process.env.GENLAYER_NETWORK !== undefined
    && process.env.GENLAYER_NETWORK !== 'studionet'
  ) {
    throw new Error('StudioNet required');
  }
  if (
    process.env.GENLAYER_RPC_URL !== undefined
    && process.env.GENLAYER_RPC_URL !== STUDIO_RPC
  ) {
    throw new Error('Configured RPC must be the requested StudioNet endpoint');
  }

  const source = await readFile(
    new URL('../contracts/quality_court.py', import.meta.url),
    'utf8',
  );
  const firstLine = source.split(/\r?\n/, 1)[0];
  if (firstLine !== '# { "Depends": "' + COURT_RUNNER + '" }') {
    throw new Error('Contract must use the fixed concrete runner hash');
  }

  const account = await loadRegistrar();
  const registrar = account.address;
  // Clone RPC metadata: SDK 1.1.8 mutates chain metadata when endpoint is passed.
  const chain = {
    ...studionet,
    rpcUrls: {
      ...studionet.rpcUrls,
      default: { ...studionet.rpcUrls.default, http: [STUDIO_RPC] },
    },
  };
  const client = createClient({ chain, account });

  phase = 'network';
  if (chain.id !== STUDIO_CHAIN_ID || await client.getChainId() !== STUDIO_CHAIN_ID) {
    throw new Error('StudioNet chain identity mismatch');
  }
  // Documented compatibility call; SDK 1.1.8 implements this as a deprecated no-op.
  await client.initializeConsensusSmartContract();

  phase = 'submission';
  submittedHash = reconcileHash ?? HashSchema.parse(
    await client.deployContract({
      code: new TextEncoder().encode(source),
      args: [registrar, RUBRIC_VERSION],
      leaderOnly: false,
    }),
  );
  console.log(JSON.stringify({
    network: 'studionet',
    chainId: STUDIO_CHAIN_ID,
    transactionHash: submittedHash,
    status: 'submitted',
    verified: false,
  }));

  phase = 'finality';
  await client.waitForTransactionReceipt({
    hash: submittedHash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    retries: 120,
    interval: 2000,
  });

  // Fetch the full receipt rather than relying on a simplified polling response.
  const tx = record(await client.getTransaction({
    hash: submittedHash as TransactionHash,
  }));
  if (
    HashSchema.parse(tx.hash ?? tx.txId).toLowerCase() !== submittedHash.toLowerCase()
    || AddressSchema.parse(tx.from_address ?? tx.sender).toLowerCase()
      !== registrar.toLowerCase()
    || receiptStatus(tx) !== TransactionStatus.FINALIZED
    || !executionSucceeded(tx)
  ) {
    throw new Error('Finalized successful registrar deployment required');
  }
  const decoded = tx.txDataDecoded ? record(tx.txDataDecoded) : undefined;
  const data = tx.data ? record(tx.data) : undefined;
  if (decoded?.leaderOnly === true || data?.leader_only === true) {
    throw new Error('Leader-only deployment is forbidden');
  }

  const address = deploymentAddress(tx);
  if (address === '0x0000000000000000000000000000000000000000') {
    throw new Error('Deployment receipt lacks a contract address');
  }

  phase = 'contract-verification';
  const config = record(await client.readContract({
    address,
    functionName: 'get_config',
    args: [],
    jsonSafeReturn: true,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  }));
  if (
    config.schemaVersion !== 1
    || AddressSchema.parse(config.registrar).toLowerCase() !== registrar.toLowerCase()
    || config.rubricVersion !== RUBRIC_VERSION
    || config.network !== 'studionet'
    || config.trust !== 'registrar-admitted payment facts'
  ) {
    throw new Error('Deployed court configuration mismatch');
  }

  const deployedSource = await client.getContractCode(address);
  if (deployedSource !== source) {
    throw new Error('Deployed source mismatch');
  }

  console.log(JSON.stringify({
    network: 'studionet',
    chainId: STUDIO_CHAIN_ID,
    rpc: STUDIO_RPC,
    contractAddress: address,
    transactionHash: submittedHash,
    registrar,
    rubricVersion: RUBRIC_VERSION,
    runner: COURT_RUNNER,
    sourceHash: hashContent(source),
    status: 'finalized',
    verified: true,
  }, null, 2));
}

main().catch(() => {
  // Never serialize SDK errors, account objects, wallet JSON, or environment values.
  console.error(JSON.stringify({
    error: 'DEPLOYMENT_NOT_VERIFIED',
    phase,
    transactionHash: submittedHash ?? null,
    verified: false,
    recovery: submittedHash
      ? 'Run this script with --reconcile and the transaction hash.'
      : 'Resolve configuration or network access before retrying.',
  }));
  process.exitCode = 1;
});
