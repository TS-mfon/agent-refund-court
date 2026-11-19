import { z } from 'zod';
import { hashTypedData, parseAbi, parseSignature, recoverTypedDataAddress, type Hex } from 'viem';
import { AddressSchema, HashSchema, SignatureSchema, PaymentProofSchema, BASE_CHAIN_ID, USDC_ADDRESS } from '../domain/schema.js';
import { paymentIdentity, refundIdentity } from '../domain/identity.js';
import { validateRefundPolicy } from './eligibility.js';
import type { EligibleRefund, RefundAuthorization, RefundPolicy, RefundWorkerDependencies, SignedRefundAuthorization } from './types.js';

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uint = z.string().regex(/^(0|[1-9][0-9]*)$/).max(78).refine(value => BigInt(value) < 2n ** 256n);
const AuthorizationSchema = z.object({
  paymentId: HashSchema, bindingHash: HashSchema, from: AddressSchema, to: AddressSchema,
  value: uint.refine(value => BigInt(value) > 0n), nonce: HashSchema,
  validAfter: uint, validBefore: uint,
  domain: z.object({ name: z.string().min(1), version: z.string().min(1),
    chainId: z.literal(BASE_CHAIN_ID), verifyingContract: z.literal(USDC_ADDRESS) }).strict(),
}).strict().refine(value => BigInt(value.validAfter) < BigInt(value.validBefore));
const authorizationTypes = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const;

function unsigned(authorization: RefundAuthorization): RefundAuthorization {
  const { paymentId, bindingHash, from, to, value, nonce, validAfter, validBefore, domain } = authorization;
  return AuthorizationSchema.parse({ paymentId, bindingHash, from, to, value, nonce, validAfter, validBefore, domain });
}

export function buildRefundAuthorization(eligibility: EligibleRefund, policy: RefundPolicy, timestampSeconds: number): RefundAuthorization {
  validateRefundPolicy(policy);
  const p = PaymentProofSchema.parse(eligibility.payment);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 1
    || !Number.isSafeInteger(timestampSeconds + policy.authorizationLifetimeSeconds)
    || !p.verified || !eq(eligibility.from, policy.authorizer) || !eq(eligibility.from, p.seller)
    || !eq(eligibility.to, p.payer) || eligibility.value !== p.amount
    || !eq(eligibility.paymentId, paymentIdentity({ chainId: p.chainId, token: p.token, payer: p.payer, nonce: p.authorizationNonce }))
    || !eq(eligibility.nonce, refundIdentity(eligibility.paymentId, p.seller))) throw new Error('INVALID_REFUND_AUTHORIZATION');
  return unsigned({ paymentId: eligibility.paymentId, bindingHash: eligibility.bindingHash,
    from: eligibility.from, to: eligibility.to, value: eligibility.value, nonce: eligibility.nonce,
    validAfter: String(timestampSeconds - 1), validBefore: String(timestampSeconds + policy.authorizationLifetimeSeconds),
    domain: { ...policy.usdcDomain, chainId: BASE_CHAIN_ID, verifyingContract: USDC_ADDRESS } });
}

export function refundAuthorizationTypedData(authorization: RefundAuthorization) {
  const a = unsigned(authorization);
  return { domain: a.domain, types: authorizationTypes, primaryType: 'TransferWithAuthorization' as const,
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore), nonce: a.nonce } };
}

export function refundAuthorizationDigest(authorization: RefundAuthorization): Hex {
  return hashTypedData(refundAuthorizationTypedData(authorization));
}

export function assertRefundAuthorization(authorization: RefundAuthorization, eligibility: EligibleRefund, policy: RefundPolicy): void {
  const a = unsigned(authorization);
  if (!eq(a.paymentId, eligibility.paymentId) || !eq(a.bindingHash, eligibility.bindingHash)
    || !eq(a.from, eligibility.from) || !eq(a.from, policy.authorizer) || !eq(a.to, eligibility.to)
    || a.value !== eligibility.value || !eq(a.nonce, eligibility.nonce)
    || a.domain.name !== policy.usdcDomain.name || a.domain.version !== policy.usdcDomain.version)
    throw new Error('AUTHORIZATION_BINDING_MISMATCH');
}

export async function signRefundAuthorization(authorization: RefundAuthorization, signer: RefundWorkerDependencies['signer']): Promise<SignedRefundAuthorization> {
  const a = unsigned(authorization);
  if (!eq(AddressSchema.parse(signer.address), a.from)) throw new Error('SIGNER_MISMATCH');
  const signature = SignatureSchema.parse(await signer.signAuthorization(a));
  const recovered = await recoverTypedDataAddress({ ...refundAuthorizationTypedData(a), signature });
  if (!eq(recovered, a.from)) throw new Error('SIGNATURE_MISMATCH');
  return { ...a, signature, digest: refundAuthorizationDigest(a) };
}

export async function assertSignedRefundAuthorization(authorization: SignedRefundAuthorization, eligibility: EligibleRefund, policy: RefundPolicy): Promise<void> {
  assertRefundAuthorization(authorization, eligibility, policy);
  SignatureSchema.parse(authorization.signature); HashSchema.parse(authorization.digest);
  if (!eq(authorization.digest, refundAuthorizationDigest(authorization))
    || !eq(await recoverTypedDataAddress({ ...refundAuthorizationTypedData(authorization), signature: authorization.signature }), eligibility.from))
    throw new Error('SIGNATURE_MISMATCH');
}

export const REFUND_TOKEN_ABI = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function authorizationState(address authorizer,bytes32 nonce) view returns (bool)',
  'function balanceOf(address account) view returns (uint256)', 'function decimals() view returns (uint8)',
  'function name() view returns (string)', 'function version() view returns (string)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event AuthorizationCanceled(address indexed authorizer,bytes32 indexed nonce)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

export function refundTransferCall(authorization: SignedRefundAuthorization) {
  const a = unsigned(authorization), signature = parseSignature(SignatureSchema.parse(authorization.signature));
  return { address: USDC_ADDRESS, abi: REFUND_TOKEN_ABI, functionName: 'transferWithAuthorization' as const,
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce,
      Number(signature.v ?? BigInt(27 + signature.yParity)), signature.r, signature.s] as const };
}
