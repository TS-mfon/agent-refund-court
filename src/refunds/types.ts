import type { Address, Hex } from 'viem';
import type { CourtProof, PaymentProof, RefundProof } from '../domain/schema.js';

export interface RefundPolicy {
  readonly authorizer: string;
  readonly courtNetwork: CourtProof['network'];
  readonly courtContractAddress: string;
  readonly confirmations: number;
  readonly authorizationLifetimeSeconds: number;
  readonly minimumGasBalanceWei: string;
  readonly usdcDomain: { readonly name: string; readonly version: string };
}
export interface RefundContext {
  readonly paymentId: Hex;
  readonly reservationPaymentId: Hex;
  readonly payment: PaymentProof;
  readonly agreementHash: Hex;
  readonly deliveryHash: Hex | null;
  readonly evidenceHash: Hex | null;
  readonly court: CourtProof | null;
  readonly rulingBinding: {
    readonly finalized: boolean; readonly paymentId: Hex; readonly caseId: Hex;
    readonly agreementHash: Hex; readonly deliveryHash: Hex; readonly evidenceHash: Hex;
    readonly transactionHash: Hex;
  } | null;
  readonly operationalApproval: {
    readonly status: 'OPERATIONAL_REFUND_APPROVED'; readonly paymentId: Hex;
    readonly approvedAtSeconds: number; readonly deadlineSeconds: number;
    readonly generationFenceInvalidated: boolean; readonly noCommittedDelivery: boolean;
  } | null;
  readonly alreadyConfirmedRefund: RefundProof | null;
}
export interface EligibleRefund {
  readonly eligible: true;
  readonly paymentId: Hex; readonly reason: RefundProof['reason'];
  readonly from: Address; readonly to: Address; readonly value: string;
  readonly nonce: Hex; readonly bindingHash: Hex; readonly payment: PaymentProof;
}
export type RefundEligibility = EligibleRefund | { readonly eligible: false; readonly code: string };
export interface RefundAuthorization {
  readonly paymentId: Hex; readonly bindingHash: Hex; readonly from: Address; readonly to: Address;
  readonly value: string; readonly nonce: Hex; readonly validAfter: string; readonly validBefore: string;
  readonly domain: { readonly name: string; readonly version: string; readonly chainId: 84532; readonly verifyingContract: Address };
}
export interface SignedRefundAuthorization extends RefundAuthorization { readonly signature: Hex; readonly digest: Hex }
export interface RefundLog {
  readonly address: Address; readonly topics: readonly Hex[]; readonly data: Hex;
  readonly transactionHash: Hex | null; readonly blockNumber: bigint | null;
  readonly blockHash: Hex | null; readonly logIndex: number | null; readonly removed?: boolean;
}
export interface RefundReceipt {
  readonly transactionHash: Hex; readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint; readonly blockHash: Hex; readonly logs: readonly RefundLog[];
}
export interface RefundObservation {
  readonly chainId: number; readonly headBlockNumber: bigint; readonly timestampSeconds: number;
  readonly token: { readonly hasCode: boolean; readonly decimals: number; readonly name: string; readonly version: string };
}
export interface RefundChain {
  observation(): Promise<RefundObservation>;
  balances(authorizer: Address): Promise<{ readonly token: bigint; readonly gas: bigint }>;
  authorizationState(authorizer: Address, nonce: Hex, blockNumber: bigint): Promise<boolean>;
  authorizationHistory(authorizer: Address, nonce: Hex, fromBlock: bigint, toBlock: bigint): Promise<readonly RefundLog[]>;
  receipt(transactionHash: Hex): Promise<RefundReceipt | null>;
  block(blockNumber: bigint): Promise<{ readonly number: bigint; readonly hash: Hex }>;
  broadcast(authorization: SignedRefundAuthorization): Promise<Hex>;
}
export type RefundStatus = 'AUTHORIZATION_PREPARED' | 'BROADCAST' | 'CONFIRMING' | 'REFUND_CONFIRMED'
  | 'RESERVE_SHORTFALL' | 'GAS_SHORTFALL' | 'TX_FAILED' | 'AUTHORIZATION_CANCELED' | 'CHAIN_RECONCILIATION_REQUIRED';
export interface RefundState {
  readonly paymentId: Hex; readonly bindingHash: Hex; readonly reason: RefundProof['reason'];
  readonly authorizer: Address; readonly status: RefundStatus;
  readonly authorization: SignedRefundAuthorization | null; readonly transactionHashes: readonly Hex[];
  readonly proof: RefundProof | null; readonly errorCode: string | null;
}
export interface StoredRefundState { readonly revision: string; readonly state: RefundState }
export interface RefundStore {
  load(paymentId: Hex): Promise<StoredRefundState | null>;
  /** Atomic create-or-CAS; false means the expected revision lost its fence. */
  save(paymentId: Hex, expectedRevision: string | null, state: RefundState): Promise<boolean>;
}
export interface RefundWorkerDependencies {
  readonly policy: RefundPolicy; readonly chain: RefundChain; readonly store: RefundStore;
  /** Must reverify original payment and origin-read court/payment state, not trust request input. */
  readonly loadEligibility: (paymentId: Hex) => Promise<RefundContext>;
  readonly signer: { readonly address: Address; signAuthorization(authorization: RefundAuthorization): Promise<Hex> };
  /** Distributed signer lock is required across processes; Actions must also serialize the signer. */
  readonly withSignerLock: <T>(authorizer: Address, operation: () => Promise<T>) => Promise<T>;
}
export type RefundWorkerResult = { readonly status: 'NOT_ELIGIBLE'; readonly code: string }
  | { readonly status: RefundStatus; readonly state: RefundState };
