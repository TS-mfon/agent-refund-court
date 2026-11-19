import { canonicalJSON } from '../domain/identity.js';
export type Stored<T> = { value:T; etag:string };
export interface StateStore {
  get<T>(key:string):Promise<Stored<T>|null>;
  create<T>(key:string,value:T):Promise<Stored<T>>;
  compareAndSwap<T>(key:string,value:T,etag:string):Promise<Stored<T>>;
  list(prefix:string,limit?:number):Promise<string[]>;
}
export class StorageConflict extends Error {
  constructor(readonly key:string) { super('Storage write conflict'); this.name='StorageConflict'; }
}
export const MAX_STATE_BYTES=65_536;
export function storageKey(key:string, prefix=false):string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 512 ||
    !/^[A-Za-z0-9_./-]+$/.test(key) || key.startsWith('/') ||
    key.includes('//') || key.split('/').some(p=>p==='.'||p==='..') ||
    (!prefix && key.endsWith('/'))) throw new Error('Invalid storage key');
  return key;
}
export function serializeState(value:unknown):string {
  const text=canonicalJSON(value);
  if (Buffer.byteLength(text,'utf8') > MAX_STATE_BYTES) throw new Error('State exceeds byte limit');
  return text;
}
export function listLimit(limit=1000):number {
  if (!Number.isInteger(limit)||limit<1||limit>1000) throw new Error('Invalid storage list limit');
  return limit;
}
