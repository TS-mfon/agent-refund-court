import { encodeAbiParameters, keccak256, sha256, stringToHex, type Hex } from 'viem';
import { AddressSchema, HashSchema, BASE_CHAIN_ID, USDC_ADDRESS } from './schema.js';
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (typeof value === 'object' && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string,unknown>;
    return '{' + Object.keys(record).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(record[k])).join(',') + '}';
  }
  throw new Error('Unsupported canonical value');
}
export function hashContent(value: unknown): Hex {
  return sha256(stringToHex(typeof value === 'string' ? value : canonicalJSON(value)));
}
export function paymentIdentity(input: {chainId:number;token:string;payer:string;nonce:string}): Hex {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error('Invalid chain');
  return keccak256(encodeAbiParameters([{type:'string'},{type:'uint256'},{type:'address'},{type:'address'},{type:'bytes32'}], ['ARC_PAYMENT_V1',BigInt(input.chainId),AddressSchema.parse(input.token),AddressSchema.parse(input.payer),HashSchema.parse(input.nonce)]));
}
export function refundIdentity(paymentId: string, seller: string): Hex {
  return keccak256(encodeAbiParameters([{type:'string'},{type:'uint256'},{type:'address'},{type:'address'},{type:'bytes32'}], ['ARC_REFUND_V1',BigInt(BASE_CHAIN_ID),USDC_ADDRESS,AddressSchema.parse(seller),HashSchema.parse(paymentId)]));
}
export function parseUSDC(value: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new Error('Invalid USDC decimal');
  const [whole,fraction=''] = value.split('.');
  return (BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))).toString();
}
export function formatUSDC(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid token units');
  const n=BigInt(value), remainder=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
  return (n/1000000n).toString()+(remainder?'.'+remainder:'');
}

export { createAgreement } from './factory.js';
export { checkoutTypedData, verifyCheckout, recordTypedData, verifyRecord } from './signatures.js';
