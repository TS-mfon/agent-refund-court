import { createClient, type createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, TransactionHashVariant, type CalldataEncodable, type TransactionHash } from 'genlayer-js/types';
import { type Address, type Hex } from 'viem';
import { AddressSchema, HashSchema, CourtDecisionSchema, type CourtProof, type SealedEvidence } from '../domain/schema.js';
import { sealCourtEvidence, type CourtEvidence } from './evidence.js';
import { assertReceiptIdentity, executionSucceeded, receiptStatus, record } from './receipt.js';
export type CourtRpc = {
  readContract(args:{address:Address;functionName:string;args:CalldataEncodable[];jsonSafeReturn:boolean;transactionHashVariant:TransactionHashVariant}):Promise<unknown>;
  writeContract(args:{address:Address;functionName:string;args:CalldataEncodable[];value:bigint;leaderOnly:boolean}):Promise<unknown>;
  getTransaction(args:{hash:TransactionHash}):Promise<unknown>;
  waitForTransactionReceipt(args:{hash:TransactionHash;status:TransactionStatus;retries:number;interval:number}):Promise<unknown>;
};
export type CourtIdentity={caseId:Hex;evidenceHash:Hex};
export type CourtTransaction=CourtIdentity&{transactionHash:Hex};
export type CourtRegistration=CourtTransaction&{status:'registered'|'pending'|'failed'|'undetermined'};
type Config={contractAddress:string;registrar?:string;account?:ReturnType<typeof createAccount>;rpc?:CourtRpc;endpoint?:string};
export class CourtClient {
  readonly contractAddress:Address; readonly registrar?:Address; private readonly rpc:CourtRpc;
  constructor(config:Config) {
    this.contractAddress=AddressSchema.parse(config.contractAddress);
    this.registrar=config.registrar?AddressSchema.parse(config.registrar):config.account?.address;
    const endpoint=config.endpoint??'https://studio.genlayer.com/api';
    const chain={...studionet,rpcUrls:{...studionet.rpcUrls,default:{...studionet.rpcUrls.default,http:[endpoint]}}};
    this.rpc=config.rpc??createClient({chain,account:config.account});
  }
  private async state(identity:CourtIdentity,final:boolean):Promise<Record<string,unknown>> {
    const value=await this.rpc.readContract({address:this.contractAddress,functionName:'get_case',args:[identity.caseId],jsonSafeReturn:true,transactionHashVariant:final?TransactionHashVariant.LATEST_FINAL:TransactionHashVariant.LATEST_NONFINAL});
    return this.assertState(value,identity);
  }
  private assertState(value:unknown,identity:CourtIdentity):Record<string,unknown> {
    const state=record(value);
    if(state.schemaVersion!==1 || AddressSchema.parse(state.contractAddress)!==this.contractAddress || state.caseId!==identity.caseId || state.paymentId!==identity.caseId || state.evidenceHash!==identity.evidenceHash) throw new Error('Court state identity mismatch');
    if(typeof state.canonicalEvidence!=='string') throw new Error('Court state evidence missing');
    const sealed=sealCourtEvidence(JSON.parse(state.canonicalEvidence));
    if(sealed.canonicalEvidence!==state.canonicalEvidence || sealed.evidenceHash!==identity.evidenceHash || sealed.caseId!==identity.caseId || sealed.evidence.agreement.courtAddress!==this.contractAddress) throw new Error('Court state evidence mismatch');
    if(state.status!=='REGISTERED' && state.status!=='DECIDED') throw new Error('Invalid court state');
    return state;
  }
  private receipt(value:unknown,identity:CourtTransaction,method:string,args:unknown[]):Record<string,unknown> {
    return assertReceiptIdentity(value,{transactionHash:identity.transactionHash,contractAddress:this.contractAddress,registrar:this.registrar,method,args});
  }
  async registerCase(evidence:SealedEvidence):Promise<CourtTransaction&{status:'submitted'}> {
    const sealed=sealCourtEvidence(evidence);
    if(sealed.evidence.agreement.courtAddress!==this.contractAddress) throw new Error('Agreement court mismatch');
    const transactionHash=HashSchema.parse(await this.rpc.writeContract({address:this.contractAddress,functionName:'register_case',args:[sealed.caseId,sealed.canonicalEvidence,sealed.evidenceHash],value:0n,leaderOnly:false}));
    return {caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash,status:'submitted'};
  }
  async reconcileRegistration(evidence:SealedEvidence,transactionHash:Hex):Promise<CourtRegistration> {
    const sealed=sealCourtEvidence(evidence), identity={caseId:sealed.caseId,evidenceHash:sealed.evidenceHash,transactionHash:HashSchema.parse(transactionHash)};
    const tx=this.receipt(await this.rpc.getTransaction({hash:identity.transactionHash as TransactionHash}),identity,'register_case',[sealed.caseId,sealed.canonicalEvidence,sealed.evidenceHash]);
    const status=receiptStatus(tx);
    if(status===TransactionStatus.UNDETERMINED) return {...identity,status:'undetermined'};
    if(status===TransactionStatus.CANCELED) return {...identity,status:'failed'};
    if(status!==TransactionStatus.FINALIZED) return {...identity,status:'pending'};
    if(!executionSucceeded(tx)) return {...identity,status:'failed'};
    await this.state(identity,true);
    return {...identity,status:'registered'};
  }
  async submitAdjudication(input:CourtIdentity):Promise<CourtTransaction> {
    const identity={caseId:HashSchema.parse(input.caseId),evidenceHash:HashSchema.parse(input.evidenceHash)};
    const state=await this.state(identity,true);
    if(state.status!=='REGISTERED' || state.result!==null) throw new Error('Only finalized registered evidence can be adjudicated');
    const transactionHash=HashSchema.parse(await this.rpc.writeContract({address:this.contractAddress,functionName:'adjudicate',args:[identity.caseId],value:0n,leaderOnly:false}));
    return {...identity,transactionHash};
  }
  async reconcile(input:CourtTransaction):Promise<CourtProof> {
    const identity={caseId:HashSchema.parse(input.caseId),evidenceHash:HashSchema.parse(input.evidenceHash),transactionHash:HashSchema.parse(input.transactionHash)};
    const tx=this.receipt(await this.rpc.getTransaction({hash:identity.transactionHash as TransactionHash}),identity,'adjudicate',[identity.caseId]);
    const status=receiptStatus(tx), base:CourtProof={network:'studionet',contractAddress:this.contractAddress,...identity,status:'pending',result:null,verified:false};
    if(status===TransactionStatus.UNDETERMINED) return {...base,status:'undetermined'};
    if(status===TransactionStatus.CANCELED) return {...base,status:'failed'};
    if(status!==TransactionStatus.FINALIZED && status!==TransactionStatus.ACCEPTED) return base;
    if(!executionSucceeded(tx)) return {...base,status:'failed'};
    const state=await this.state(identity,status===TransactionStatus.FINALIZED);
    if(state.status!=='DECIDED') throw new Error('Successful adjudication lacks a terminal case');
    const result=CourtDecisionSchema.parse(state.result);
    if((result.decision==='REFUND')!==result.materialFailure || (result.decision!=='REFUND' && result.failedCriteria.length>0) || new Set(result.failedCriteria).size!==result.failedCriteria.length) throw new Error('Inconsistent court decision');
    return {...base,status:status===TransactionStatus.FINALIZED?'finalized':'accepted',result,verified:status===TransactionStatus.FINALIZED};
  }
  async waitForFinality(identity:CourtTransaction):Promise<CourtProof> {
    try {
      await this.rpc.waitForTransactionReceipt({hash:HashSchema.parse(identity.transactionHash) as TransactionHash,status:TransactionStatus.FINALIZED,retries:5,interval:2000});
    } catch(error) {
      if(!(error instanceof Error) || !error.message.startsWith('Timed out')) throw error;
    }
    return this.reconcile(identity);
  }
}
export function createCourtClient(config:Config):CourtClient {return new CourtClient(config);}
export function registrationArgs(sealed:CourtEvidence):[Hex,string,Hex] {return [sealed.caseId,sealed.canonicalEvidence,sealed.evidenceHash];}
