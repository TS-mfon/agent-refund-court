import { decodeInputData } from 'genlayer-js';
import { ExecutionResult, TransactionStatus, transactionsStatusNumberToName } from 'genlayer-js/types';
import { toHex, toRlp, type Address, type Hex } from 'viem';
import { AddressSchema, HashSchema } from '../domain/schema.js';
import { canonicalJSON } from '../domain/identity.js';
export function record(value:unknown):Record<string,unknown> {
  if(value instanceof Map) return Object.fromEntries(value);
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Malformed court RPC record');
  return value as Record<string,unknown>;
}
export function receiptStatus(value:unknown):TransactionStatus {
  const tx=record(value), named=tx.statusName??tx.status_name;
  if(typeof named==='string' && Object.values(TransactionStatus).includes(named as TransactionStatus)) return named as TransactionStatus;
  if(typeof tx.status==='string' && Object.values(TransactionStatus).includes(tx.status as TransactionStatus)) return tx.status as TransactionStatus;
  const mapped=transactionsStatusNumberToName[String(tx.status) as keyof typeof transactionsStatusNumberToName];
  if(!mapped) throw new Error('Unknown court transaction status');
  return mapped;
}
function callData(tx:Record<string,unknown>):Record<string,unknown> {
  if(tx.txDataDecoded) return record(record(tx.txDataDecoded).callData);
  const data=record(tx.data), cd=record(data.calldata);
  if(Array.isArray(cd.raw) && cd.raw.every(n=>Number.isInteger(n)&&n>=0&&n<=255)) {
    const flag=data.leader_only===true?'0x01':'0x';
    const recipient=AddressSchema.parse(tx.to_address??tx.recipient);
    return record(record(decodeInputData(
      toRlp([toHex(Uint8Array.from(cd.raw)),flag]),
      recipient,
    )).callData);
  }
  // Some RPC adapters return already-decoded calldata; never parse Python display strings.
  if(cd.readable && typeof cd.readable==='object') return record(cd.readable);
  throw new Error('Receipt lacks verifiable decoded calldata');
}
export function assertReceiptIdentity(value:unknown,expected:{transactionHash:Hex;contractAddress:Address;registrar?:Address;method:string;args:unknown[]}):Record<string,unknown> {
  const tx=record(value);
  const hash=HashSchema.parse(tx.hash??tx.txId);
  if(hash.toLowerCase()!==expected.transactionHash.toLowerCase()) throw new Error('Court transaction hash mismatch');
  if(AddressSchema.parse(tx.to_address??tx.recipient).toLowerCase()!==expected.contractAddress.toLowerCase()) throw new Error('Court receipt recipient mismatch');
  if(expected.registrar && AddressSchema.parse(tx.from_address??tx.sender).toLowerCase()!==expected.registrar.toLowerCase()) throw new Error('Court receipt registrar mismatch');
  if(tx.data && record(tx.data).leader_only===true) throw new Error('Leader-only adjudication is forbidden');
  if(tx.txDataDecoded && record(tx.txDataDecoded).leaderOnly===true) throw new Error('Leader-only adjudication is forbidden');
  const call=callData(tx);
  if(call.method!==expected.method || canonicalJSON(call.args)!==canonicalJSON(expected.args)) throw new Error('Court receipt call mismatch');
  if(call.kwargs && Object.keys(record(call.kwargs)).length>0) throw new Error('Unexpected court call keyword arguments');
  return tx;
}
export function executionSucceeded(tx:Record<string,unknown>):boolean {
  if(tx.txExecutionResultName!==undefined) return tx.txExecutionResultName===ExecutionResult.FINISHED_WITH_RETURN;
  if(tx.txExecutionResult!==undefined) return tx.txExecutionResult===1;
  if(!tx.consensus_data) return false;
  const receipts=record(tx.consensus_data).leader_receipt;
  const latest=Array.isArray(receipts)?receipts.at(-1):receipts;
  if(!latest) return false;
  const leader=record(latest);
  const execution=leader.execution_result;
  if(execution!=='SUCCESS' && execution!==ExecutionResult.FINISHED_WITH_RETURN) return false;
  const result=leader.result;
  return Boolean(result && typeof result==='object' && record(result).status==='return');
}
export function deploymentAddress(tx:unknown):Address {
  const receipt=record(tx);
  const decoded=receipt.txDataDecoded?record(receipt.txDataDecoded):null;
  return AddressSchema.parse(decoded?.contractAddress??(receipt.data?record(receipt.data).contract_address:undefined));
}
