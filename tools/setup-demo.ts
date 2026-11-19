import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const directory = join(homedir(), '.config', 'agent-refund-court');
const pathname = join(directory, 'wallets.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
let wallets: Record<string, { privateKey: `0x${string}`; address: `0x${string}` }>;
try { wallets = JSON.parse(await readFile(pathname, 'utf8')); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  wallets = Object.fromEntries(['buyer', 'seller', 'registrar', 'receiptSigner'].map(role => {
    const privateKey = generatePrivateKey();
    return [role, { privateKey, address: privateKeyToAccount(privateKey).address }];
  }));
  await writeFile(pathname, JSON.stringify(wallets, null, 2), { flag: 'wx', mode: 0o600 });
}
for (const [role, wallet] of Object.entries(wallets)) {
  if (privateKeyToAccount(wallet.privateKey).address !== wallet.address) throw new Error('Wallet integrity check failed');
}
console.log(JSON.stringify({ privateFile: pathname, addresses: Object.fromEntries(Object.entries(wallets).map(([role,w])=>[role,w.address])), funding: { buyer: 'Base Sepolia USDC for purchases', seller: 'Base Sepolia ETH for refund gas', registrar: 'GenLayer testnet native funds if required by the selected network' } },null,2));
