import { readFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { AddressSchema } from '../domain/schema.js';
import { DemoHttpError } from '../workflow/http.js';
import { MandateSchema } from './mandate.js';
const KeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const WalletSchema = z.object({ privateKey: KeySchema, address: AddressSchema }).strict();
async function privateJSON(path: string) {
  if (!isAbsolute(path)) throw new DemoHttpError('PRIVATE_CONFIG_PATH_MUST_BE_ABSOLUTE');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > 8192 ||
    process.getuid && info.uid !== process.getuid()) throw new DemoHttpError('PRIVATE_CONFIG_PERMISSIONS_REQUIRED');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
/** This loader never reads merchant, registrar, demo, or shared multi-wallet credentials. */
export async function loadMcpConfig(environment: NodeJS.ProcessEnv = process.env) {
  const mandatePath = environment.ARC_MANDATE_FILE;
  if (!mandatePath) throw new DemoHttpError('ARC_MANDATE_FILE_REQUIRED');
  const mandate = MandateSchema.parse(await privateJSON(mandatePath));
  const key = environment.ARC_BUYER_PRIVATE_KEY, walletPath = environment.ARC_BUYER_WALLET_FILE;
  if (key && walletPath) throw new DemoHttpError('CONFIGURE_ONE_BUYER_WALLET_SOURCE');
  if (!key && !walletPath) throw new DemoHttpError('ARC_BUYER_WALLET_REQUIRED');
  const wallet = walletPath ? WalletSchema.parse(await privateJSON(walletPath)) : null;
  const signer = privateKeyToAccount(KeySchema.parse(key ?? wallet?.privateKey) as `0x${string}`);
  if (wallet && signer.address !== wallet.address) throw new DemoHttpError('BUYER_WALLET_INTEGRITY_FAILED');
  const directory = environment.ARC_STATE_DIRECTORY ?? join(homedir(), '.config', 'agent-refund-court', 'mcp-state');
  if (!isAbsolute(directory)) throw new DemoHttpError('ARC_STATE_DIRECTORY_MUST_BE_ABSOLUTE');
  return { signer, mandate, directory };
}
