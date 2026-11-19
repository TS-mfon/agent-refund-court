import { randomUUID } from 'node:crypto';
import { type StateStore,type Stored,StorageConflict,storageKey,serializeState,listLimit } from './store.js';
/** Deterministic semantics for tests; each read/write returns an independent JSON value. */
export class MemoryStateStore implements StateStore {
  private readonly rows=new Map<string,{text:string;etag:string}>();
  async get<T>(key:string):Promise<Stored<T>|null> {
    const row=this.rows.get(storageKey(key));
    return row?{value:JSON.parse(row.text) as T,etag:row.etag}:null;
  }
  async create<T>(key:string,value:T):Promise<Stored<T>> {
    storageKey(key);
    const text=serializeState(value);
    if(this.rows.has(key)) throw new StorageConflict(key);
    const row={text,etag:randomUUID()}; this.rows.set(key,row);
    return {value:JSON.parse(text) as T,etag:row.etag};
  }
  async compareAndSwap<T>(key:string,value:T,etag:string):Promise<Stored<T>> {
    storageKey(key);
    const text=serializeState(value), current=this.rows.get(key);
    if(!current||!etag||current.etag!==etag) throw new StorageConflict(key);
    const row={text,etag:randomUUID()}; this.rows.set(key,row);
    return {value:JSON.parse(text) as T,etag:row.etag};
  }
  async list(prefix:string,limit=1000):Promise<string[]> {
    storageKey(prefix,true); listLimit(limit);
    return [...this.rows.keys()].filter(k=>k.startsWith(prefix)).sort().slice(0,limit);
  }
}
